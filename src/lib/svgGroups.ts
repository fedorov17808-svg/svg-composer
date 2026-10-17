export interface GroupNode {
  /** `id` attribute of the `<g>`, if any. */
  id: string | null
  /** Index of the parent selectable group, or -1 for top-level groups. */
  parent: number
  children: number[]
  depth: number
  /** Number of nested elements (shapes and groups) inside the group. */
  elementCount: number
  groupCount: number
  /** Position in document order among all groups and leaves; siblings compare by it. */
  order?: number
  /** Axis-aligned bounds in source viewBox units. */
  x: number
  y: number
  width: number
  height: number
}

/** A drawable element that is not a group: path, circle, rect, text, use, … */
export interface LeafNode {
  /** Index of the nearest selectable group, or -1 if the leaf sits right under the scene root. */
  parent: number
  tag: string
  /** Position in document order among all groups and leaves. */
  order?: number
  /** Visible axis-aligned bounds in source viewBox units; a straight line may have zero width. */
  x: number
  y: number
  width: number
  height: number
  /** False when a clip path hides the leaf completely: it cannot be picked by a marquee. */
  visible: boolean
}

const NON_RENDERED = new Set(['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'marker'])

/** Transparent full-canvas rect that Affinity Designer puts into every export. */
const isBackground = (el: Element) =>
  el.tagName === 'path' && el.getAttribute('fill') === 'none' && /^M0 0h/.test(el.getAttribute('d') ?? '')

/**
 * Skips service wrappers: while a container holds exactly one `<g>` (ignoring the background
 * rect and non-rendered elements), that `<g>` is a wrapper and the scene starts inside it.
 */
function findContentRoot(svg: SVGSVGElement): Element {
  let container: Element = svg
  for (;;) {
    const kids = [...container.children].filter((el) => !isBackground(el) && !NON_RENDERED.has(el.tagName))
    if (kids.length !== 1 || kids[0].tagName !== 'g') return container
    container = kids[0]
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const EMPTY: Rect = { x: 0, y: 0, width: 0, height: 0 }
const isEmpty = (r: Rect) => r.width <= 0 || r.height <= 0

function union(a: Rect, b: Rect): Rect {
  if (isEmpty(a)) return b
  if (isEmpty(b)) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x
  const height = Math.min(a.y + a.height, b.y + b.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : EMPTY
}

/** Like `intersect`, but keeps zero-width/height results (straight lines); null when disjoint. */
function intersectLoose(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x
  const height = Math.min(a.y + a.height, b.y + b.height) - y
  return width >= 0 && height >= 0 ? { x, y, width, height } : null
}

function transformRect(box: DOMRect, m: DOMMatrix): Rect {
  const corners = [
    new DOMPoint(box.x, box.y),
    new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x, box.y + box.height),
    new DOMPoint(box.x + box.width, box.y + box.height),
  ].map((p) => p.matrixTransform(m))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** Bounds of a `clip-path` (userSpaceOnUse) in root units, or null if the element is not clipped. */
function clipBounds(el: SVGGraphicsElement, toRoot: DOMMatrix): Rect | null {
  const ref = /url\(#([^)]+)\)/.exec(el.getAttribute('clip-path') ?? '')
  const clip = ref && el.ownerDocument.getElementById(ref[1])
  if (!clip) return null
  const m = toRoot.multiply(el.getCTM() ?? new DOMMatrix())
  let rect = EMPTY
  for (const shape of clip.children) {
    if (!(shape instanceof SVGGraphicsElement)) continue
    const local = shape.transform.baseVal.consolidate()?.matrix ?? new DOMMatrix()
    rect = union(rect, transformRect(shape.getBBox(), m.multiply(DOMMatrix.fromMatrix(local))))
  }
  return rect
}

/**
 * Collects selectable groups of a mounted inline SVG in document order. Reads only; the source
 * DOM is not modified.
 */
export function collectGroups(svg: SVGSVGElement): {
  nodes: GroupNode[]
  elements: SVGGElement[]
  leaves: LeafNode[]
  leafElements: SVGGraphicsElement[]
  viewBox: Rect
} {
  // getCTM() maps to the <svg> viewport (CSS pixels); undo the viewBox scaling to get source units.
  const vb = svg.viewBox.baseVal
  const scale = svg.getBoundingClientRect().width / (vb.width || 1)
  const toRoot = new DOMMatrix().translate(vb.x, vb.y).scale(1 / scale)

  const nodes: GroupNode[] = []
  const elements: SVGGElement[] = []
  const leaves: LeafNode[] = []
  const leafElements: SVGGraphicsElement[] = []
  let order = 0
  // Returns the visible bounds of the container's content: getBBox() of each shape mapped through
  // getCTM(), cut by its own and inherited clip-paths, since getBBox() of a group ignores clipping.
  const walk = (container: Element, parent: number, depth: number, inheritedClip: Rect): Rect => {
    let content = EMPTY
    for (const el of container.children) {
      if (NON_RENDERED.has(el.tagName) || !(el instanceof SVGGraphicsElement)) continue
      const ownClip = clipBounds(el, toRoot)
      const clip = ownClip ? intersect(inheritedClip, ownClip) : inheritedClip
      let rect: Rect
      if (el instanceof SVGGElement) {
        const index = nodes.length
        nodes.push({
          id: el.getAttribute('id'),
          parent,
          children: [],
          depth,
          order: order++,
          elementCount: el.querySelectorAll('*').length,
          groupCount: el.querySelectorAll('g').length,
          ...EMPTY,
        })
        elements.push(el)
        if (parent >= 0) nodes[parent].children.push(index)
        rect = walk(el, index, depth + 1, clip)
        Object.assign(nodes[index], rect)
      } else {
        const raw = transformRect(el.getBBox(), toRoot.multiply(el.getCTM() ?? new DOMMatrix()))
        const visible = intersectLoose(raw, clip)
        leaves.push({ parent, tag: el.tagName, order: order++, ...(visible ?? raw), visible: visible !== null })
        leafElements.push(el)
        rect = intersect(raw, clip)
      }
      content = union(content, rect)
    }
    return content
  }
  const viewBox = { x: vb.x, y: vb.y, width: vb.width, height: vb.height }
  walk(findContentRoot(svg), -1, 0, viewBox)
  return { nodes, elements, leaves, leafElements, viewBox }
}
