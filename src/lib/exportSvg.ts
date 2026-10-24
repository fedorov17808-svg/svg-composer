import { canvasParts, objectTransform, type CanvasObject, type Size } from './canvas'
import { allElements, ownRefs, prefixIds } from './extract'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
export interface ExportComponent {
  markup: string
  defs: string
  width: number
  height: number
  sourceId: string
}

export interface ExportInput {
  size: Size
  /** Bottom to top, as on the canvas. */
  objects: CanvasObject[]
  components: Map<string, ExportComponent>
  /** The component as this object draws it (library objects in the color scheme); as stored by default. */
  paint?: (obj: CanvasObject, component: ExportComponent) => ExportComponent
  /** Fill of the background; white by default. */
  background?: string
}

/** A readable, valid XML id from an object name: "Гофер с фонарём" → "гофер-с-фонарём". */
export function slugId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) return 'object'
  return /^\p{L}/u.test(slug) ? slug : `object-${slug}`
}

/**
 * The composition as a standalone SVG: a white background, one `<defs>` with the definitions the
 * visible objects actually use (each once), then every visible object as
 * `<g id data-source transform>` with its component inside. No canvas UI.
 */
export function exportSvg({ size, objects, components, paint = (_, c) => c, background: fill = '#fff' }: ExportInput): string {
  const visible = objects.filter((o) => !o.hidden && components.has(o.componentId))
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" viewBox="0 0 ${size.width} ${size.height}" ` +
      `width="${size.width}" height="${size.height}"><defs/></svg>`,
    'image/svg+xml',
  )
  const root = doc.documentElement
  const defs = root.firstElementChild!

  const parse = (markup: string) =>
    [
      ...new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">${markup}</svg>`, 'image/svg+xml')
        .documentElement.children,
    ].map((el) => doc.importNode(el, true))

  // Definitions of every used component once; the same id twice keeps the first.
  const defIds = new Set<string>()
  for (const componentId of new Set(visible.map((o) => o.componentId))) {
    for (const el of parse(canvasParts(components.get(componentId)!).defs)) {
      const id = el.getAttribute('id')
      if (id && defIds.has(id)) continue
      if (id) defIds.add(id)
      defs.append(el)
    }
  }

  const background = doc.createElementNS(SVG_NS, 'rect')
  background.setAttribute('id', 'background')
  background.setAttribute('width', String(size.width))
  background.setAttribute('height', String(size.height))
  background.setAttribute('fill', fill)
  root.append(background)

  const taken = new Set(['background', ...[...defs.querySelectorAll('[id]')].map((el) => el.getAttribute('id')!)])
  const unique = (base: string) => {
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    taken.add(id)
    return id
  }

  const instances = new Map<string, number>()
  for (const obj of visible) {
    const component = paint(obj, components.get(obj.componentId)!)
    const g = doc.createElementNS(SVG_NS, 'g')
    g.setAttribute('id', unique(slugId(obj.name)))
    g.setAttribute('data-source', component.sourceId)
    g.setAttribute('transform', objectTransform(obj, component))
    g.append(...parse(canvasParts(component).markup))
    // Ids left in the markup are referenced from it; repeat instances get their own copies.
    const count = instances.get(obj.componentId) ?? 0
    instances.set(obj.componentId, count + 1)
    if (count > 0) prefixIds([...g.children], `${g.getAttribute('id')}-`)
    for (const el of g.querySelectorAll('[id]')) taken.add(el.getAttribute('id')!)
    root.append(g)
  }

  // Keep only definitions reachable from the drawn content.
  const byId = new Map(allElements(defs).filter((el) => el.hasAttribute('id')).map((el) => [el.getAttribute('id')!, el]))
  const used = new Set<string>()
  const queue = [...root.children].filter((el) => el !== defs).flatMap(allElements).flatMap(ownRefs)
  while (queue.length) {
    const id = queue.pop()!
    if (used.has(id) || !byId.has(id)) continue
    used.add(id)
    queue.push(...allElements(byId.get(id)!).flatMap(ownRefs))
  }
  for (const el of [...defs.children]) {
    if (!allElements(el).some((e) => used.has(e.getAttribute('id') ?? ''))) el.remove()
  }
  if (!defs.children.length) defs.remove()

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc)
}

/** "composition-2026-10-17.svg", in local time. */
export function exportFileName(ext: 'svg' | 'png' | 'json', date = new Date(), base = 'composition') {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${base}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${ext}`
}
