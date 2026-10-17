const SVG_NS = 'http://www.w3.org/2000/svg'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 2D affine matrix [a, b, c, d, e, f], as in SVG `matrix()`. */
type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const isIdentity = (m: Matrix) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12)

/** Parses an SVG `transform` attribute into a single matrix. */
export function parseTransform(value: string | null): Matrix {
  let result = IDENTITY
  if (!value) return result
  for (const [, fn, rawArgs] of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = rawArgs.split(/[\s,]+/).filter(Boolean).map(Number)
    let m: Matrix
    switch (fn) {
      case 'matrix':
        m = a.length === 6 ? (a as Matrix) : IDENTITY
        break
      case 'translate':
        m = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
        break
      case 'scale':
        m = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
        break
      case 'rotate': {
        const rad = ((a[0] ?? 0) * Math.PI) / 180
        const [cos, sin] = [Math.cos(rad), Math.sin(rad)]
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0]
        m = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy])
        break
      }
      case 'skewX':
        m = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
        break
      case 'skewY':
        m = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
        break
      default:
        m = IDENTITY
    }
    result = multiply(result, m)
  }
  return result
}

const num = (n: number) => String(+n.toFixed(6))
const formatMatrix = (m: Matrix) => `matrix(${m.map(num).join(' ')})`

/** Presentation attributes that descendants inherit (SVG 1.1 / SVG 2). */
const INHERITED = [
  'clip-rule', 'color', 'color-interpolation', 'color-interpolation-filters', 'color-rendering', 'cursor',
  'direction', 'fill', 'fill-opacity', 'fill-rule', 'font', 'font-family', 'font-size', 'font-size-adjust',
  'font-stretch', 'font-style', 'font-variant', 'font-weight', 'image-rendering', 'letter-spacing', 'marker',
  'marker-end', 'marker-mid', 'marker-start', 'paint-order', 'shape-rendering', 'stroke', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity',
  'stroke-width', 'text-anchor', 'text-rendering', 'visibility', 'word-spacing', 'writing-mode',
]

/** Non-inherited attributes of a group that still change how its content looks. */
const EFFECTS = ['clip-path', 'mask', 'filter', 'opacity']

const styleDeclarations = (el: Element) =>
  new Map(
    (el.getAttribute('style') ?? '')
      .split(';')
      .map((decl) => decl.split(':').map((s) => s.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== '' && pair[1] !== ''),
  )

/** Attribute or inline-style value; inline style wins, as in CSS. */
const presentation = (el: Element, name: string) => styleDeclarations(el).get(name) ?? el.getAttribute(name)

/**
 * Copies inherited presentation values from the original's ancestors onto the clone, unless the
 * clone sets them itself, so the clone renders the same outside its original tree.
 */
export function bakeInherited(clone: Element, original: Element) {
  for (const name of INHERITED) {
    if (presentation(clone, name) !== null) continue
    for (let el = original.parentElement; el; el = el.parentElement) {
      const value = presentation(el, name)
      if (value !== null) {
        clone.setAttribute(name, value)
        break
      }
    }
  }
}

const URL_REF = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g
const HREF_ATTRS = ['href', 'xlink:href']

/** Ids an element refers to via `url(#…)` in any attribute or `href="#…"`, not including descendants. */
function ownRefs(el: Element): string[] {
  const ids: string[] = []
  for (const attr of el.attributes) {
    for (const [, id] of attr.value.matchAll(URL_REF)) ids.push(id)
    if (HREF_ATTRS.includes(attr.name) && attr.value.startsWith('#')) ids.push(attr.value.slice(1))
  }
  return ids
}

const allElements = (root: Element) => [root, ...root.querySelectorAll('*')]

/**
 * Finds every element the given subtrees depend on: `url(#…)` and `href="#…"` references, followed
 * recursively (a gradient inheriting another gradient, a clip path with a clipped child, …).
 * Elements already inside the subtrees are not returned. Result is in document order.
 */
export function collectDefs(roots: Element[], byId: Map<string, Element>): Element[] {
  const inside = new Set(roots.flatMap(allElements))
  const found = new Set<Element>()
  const queue = roots.flatMap(allElements)
  while (queue.length > 0) {
    for (const id of ownRefs(queue.pop()!)) {
      const target = byId.get(id)
      if (!target || inside.has(target) || found.has(target)) continue
      // A referenced element brings its whole subtree; skip refs to nodes nested in one we already copy.
      if ([...found].some((el) => el.contains(target))) continue
      for (const el of [...found]) if (target.contains(el)) found.delete(el)
      found.add(target)
      queue.push(...allElements(target))
    }
  }
  return [...found].sort(documentOrder)
}

function documentOrder(a: Node, b: Node) {
  const pos = a.compareDocumentPosition(b)
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
  return 0
}

/**
 * Gives every `id` in the subtrees a prefix and rewrites `url(#…)` / `href="#…"` references to
 * those ids. References to ids outside the subtrees are left untouched.
 */
export function prefixIds(roots: Element[], prefix: string) {
  const elements = roots.flatMap(allElements)
  const renamed = new Map<string, string>()
  for (const el of elements) {
    const id = el.getAttribute('id')
    if (id) {
      renamed.set(id, prefix + id)
      el.setAttribute('id', prefix + id)
    }
  }
  for (const el of elements) {
    for (const attr of [...el.attributes]) {
      if (attr.name === 'id') continue
      let value = attr.value.replace(URL_REF, (match, id: string) =>
        renamed.has(id) ? `url(#${renamed.get(id)})` : match,
      )
      if (HREF_ATTRS.includes(attr.name) && value.startsWith('#') && renamed.has(value.slice(1))) {
        value = '#' + renamed.get(value.slice(1))
      }
      if (value !== attr.value) el.setAttributeNS(attr.namespaceURI, attr.name, value)
    }
  }
}

export interface ExtractInput {
  /** Selected elements of one source SVG, in any order. */
  elements: Element[]
  /** Visible bounds of each element in root (viewBox) units, same order as `elements`. */
  bounds: Rect[]
  /** Prefix for all ids, e.g. "c1a2b3-". */
  prefix: string
}

export interface ExtractResult {
  /** A single `<g>` with the content moved to the origin. */
  markup: string
  /** Serialized elements for `<defs>`, without the `<defs>` wrapper. */
  defs: string
  width: number
  height: number
}

export function unionRects(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  }
}

const serialize = (el: Element) =>
  new XMLSerializer().serializeToString(el).replaceAll(` xmlns="${SVG_NS}"`, '')

/**
 * Turns selected elements of a source SVG into a self-contained component. The source DOM is only
 * read. Elements keep the source paint order; parent transforms are folded into each clone, while
 * parents with clip-path/mask/filter/opacity become wrapper groups so the result looks the same.
 */
export function extract({ elements, bounds, prefix }: ExtractInput): ExtractResult {
  if (elements.length === 0) throw new Error('Nothing selected')
  const svg: Element | null = elements[0].closest('svg')
  if (!svg) throw new Error('Elements are not inside an <svg>')
  const doc = svg.ownerDocument

  const box = unionRects(bounds)
  const root = doc.createElementNS(SVG_NS, 'g')
  root.setAttribute('transform', `translate(${num(-box.x)} ${num(-box.y)})`)

  const wrapperOf = new WeakMap<Element, Element>()
  const sorted = [...elements].sort(documentOrder)
  for (const el of sorted) {
    const chain: Element[] = []
    for (let p = el.parentElement; p && p !== svg; p = p.parentElement) chain.unshift(p)

    let container: Element = root
    let acc = IDENTITY
    for (const ancestor of chain) {
      acc = multiply(acc, parseTransform(ancestor.getAttribute('transform')))
      if (!EFFECTS.some((name) => presentation(ancestor, name) !== null)) continue
      // Reuse the wrapper only while it is still the last thing drawn, to keep paint order.
      const last = container.lastElementChild
      let wrapper = last && wrapperOf.get(last) === ancestor ? last : null
      if (!wrapper) {
        wrapper = doc.createElementNS(SVG_NS, 'g')
        if (!isIdentity(acc)) wrapper.setAttribute('transform', formatMatrix(acc))
        for (const name of EFFECTS) {
          const value = presentation(ancestor, name)
          if (value !== null) wrapper.setAttribute(name, value)
        }
        wrapperOf.set(wrapper, ancestor)
        container.appendChild(wrapper)
      }
      container = wrapper
      acc = IDENTITY
    }

    const clone = el.cloneNode(true) as Element
    const own = multiply(acc, parseTransform(el.getAttribute('transform')))
    if (isIdentity(own)) clone.removeAttribute('transform')
    else clone.setAttribute('transform', formatMatrix(own))
    bakeInherited(clone, el)
    container.appendChild(clone)
  }

  const byId = new Map([...svg.querySelectorAll('[id]')].map((el) => [el.getAttribute('id')!, el]))
  // Refs are followed on the clones but resolve to originals; skip those already cloned with the selection.
  const defs = collectDefs([root], byId)
    .filter((original) => !sorted.some((el) => el.contains(original)))
    .map((original) => {
      const clone = original.cloneNode(true) as Element
      bakeInherited(clone, original)
      return clone
    })

  prefixIds([root, ...defs], prefix)

  return {
    markup: serialize(root),
    defs: defs.map(serialize).join(''),
    width: +box.width.toFixed(3),
    height: +box.height.toFixed(3),
  }
}

/** Standalone SVG document for previews and export. */
export const componentSvg = (c: { markup: string; defs: string; width: number; height: number }) =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 ${c.width} ${c.height}" width="${c.width}" height="${c.height}">` +
  (c.defs ? `<defs>${c.defs}</defs>` : '') +
  c.markup +
  '</svg>'
