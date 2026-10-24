import { bakeInherited } from './extract'

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface Point {
  x: number
  y: number
}

export interface CanvasObject {
  id: string
  componentId: string
  name: string
  /** Top-left corner of the unrotated box, in canvas units. */
  x: number
  y: number
  scale: number
  /** Degrees, clockwise, around the box center. */
  rotation: number
  flipX: boolean
  hidden?: boolean
  /** Locked objects can be selected but not moved, scaled, rotated or flipped. */
  locked?: boolean
  /** Order of the accent colors of a library object (index in `VARIANTS`); 0 or missing — as drawn. */
  variant?: number
}

export interface Size {
  width: number
  height: number
}

/** Maps a point in component units (0…width, 0…height) to canvas units. */
export function toCanvas(obj: CanvasObject, size: Size, u: number, v: number): Point {
  const rad = (obj.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)]
  const du = (u - size.width / 2) * obj.scale * (obj.flipX ? -1 : 1)
  const dv = (v - size.height / 2) * obj.scale
  const center = boxCenter(obj, size)
  return { x: center.x + du * cos - dv * sin, y: center.y + du * sin + dv * cos }
}

/** Inverse of `toCanvas`. */
export function toLocal(obj: CanvasObject, size: Size, p: Point): Point {
  const rad = (obj.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)]
  const center = boxCenter(obj, size)
  const [dx, dy] = [p.x - center.x, p.y - center.y]
  const du = (dx * cos + dy * sin) / obj.scale / (obj.flipX ? -1 : 1)
  const dv = (-dx * sin + dy * cos) / obj.scale
  return { x: du + size.width / 2, y: dv + size.height / 2 }
}

export const boxCenter = (obj: CanvasObject, size: Size): Point => ({
  x: obj.x + (size.width * obj.scale) / 2,
  y: obj.y + (size.height * obj.scale) / 2,
})

const num = (n: number) => String(+n.toFixed(4))

export function objectTransform(obj: CanvasObject, size: Size) {
  const c = boxCenter(obj, size)
  const parts = [`translate(${num(c.x)} ${num(c.y)})`]
  if (obj.rotation) parts.push(`rotate(${num(obj.rotation)})`)
  parts.push(`scale(${num(obj.scale * (obj.flipX ? -1 : 1))} ${num(obj.scale)})`)
  parts.push(`translate(${num(-size.width / 2)} ${num(-size.height / 2)})`)
  return parts.join(' ')
}

/** Normalizes an angle to (-180, 180]. */
export const normalizeAngle = (deg: number) => {
  const a = ((deg % 360) + 360) % 360
  return a > 180 ? a - 360 : a
}

/**
 * Mirror image across the vertical line through the box center, as seen on the canvas: the center
 * stays put, and a rotated object turns the other way.
 */
export const flippedX = (obj: CanvasObject): Pick<CanvasObject, 'flipX' | 'rotation'> => ({
  flipX: !obj.flipX,
  rotation: normalizeAngle(-obj.rotation),
})

/** Elements that only render through a reference and can live in a shared `<defs>`. */
const DEF_TAGS = 'clipPath, mask, linearGradient, radialGradient, pattern, filter, marker, symbol'
const URL_REF = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)|href="#([^"]+)"/g

const serialize = (el: Element) =>
  new XMLSerializer().serializeToString(el).replaceAll(` xmlns="${SVG_NS}"`, '')

export interface CanvasParts {
  /** Component markup without definitions, safe to repeat for every instance. */
  markup: string
  /** Definitions, rendered once per component. */
  defs: string
}

const partsCache = new WeakMap<object, CanvasParts>()

/**
 * Splits a component for the canvas: definitions nested in the markup (gophers keep `clipPath`
 * inline) move to the shared `<defs>`, and ids nothing refers to are dropped, so placing the same
 * component twice does not repeat ids. Content of a moved definition keeps the values it inherited.
 */
export function canvasParts(component: { markup: string; defs: string }): CanvasParts {
  const cached = partsCache.get(component)
  if (cached) return cached
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}"><defs>${component.defs}</defs>${component.markup}</svg>`,
    'image/svg+xml',
  )
  const root = doc.documentElement
  const ownDefs = root.firstElementChild!
  const hoisted = [...root.querySelectorAll(DEF_TAGS)].filter(
    (el) => !ownDefs.contains(el) && !el.parentElement?.closest(DEF_TAGS),
  )
  for (const el of hoisted) {
    bakeInherited(el, el)
    el.remove()
  }
  ownDefs.remove()
  // The same definition can come both from the component defs and from inside its markup.
  const seen = new Set<string>()
  const defs = [...ownDefs.children, ...hoisted]
    .filter((el) => {
      const id = el.getAttribute('id')
      if (!id) return true
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map(serialize)
    .join('')
  const markupText = [...root.children].map(serialize).join('')
  const referenced = new Set([...(defs + markupText).matchAll(URL_REF)].map((m) => m[1] ?? m[2]))
  for (const el of root.querySelectorAll('[id]')) {
    if (!referenced.has(el.getAttribute('id')!)) el.removeAttribute('id')
  }
  const parts = { markup: [...root.children].map(serialize).join(''), defs }
  partsCache.set(component, parts)
  return parts
}
