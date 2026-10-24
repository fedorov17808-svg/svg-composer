import { boxCenter, type CanvasObject, type Size } from './canvas'
import { parseVersionId, versionId, type ObjectSize } from './libraryObjects'

export type FormatId = 'square' | 'wide' | 'tall' | 'custom'

/**
 * Canvas formats of the art director's examples. The short side is 1000, as the 1000×1000
 * background samples of the sheet.
 */
export const FORMATS: { id: Exclude<FormatId, 'custom'>; label: string; size: Size }[] = [
  { id: 'square', label: 'Квадрат 1:1', size: { width: 1000, height: 1000 } },
  { id: 'wide', label: 'Широкий 2:1', size: { width: 2000, height: 1000 } },
  { id: 'tall', label: 'Вертикальный 2:3', size: { width: 1000, height: 1500 } },
]
export const FORMAT_IDS: FormatId[] = [...FORMATS.map((f) => f.id), 'custom']
export const DEFAULT_FORMAT = FORMATS[1]

/** The preset with exactly this size, or 'custom'. */
export const formatOf = (size: Size): FormatId =>
  FORMATS.find((f) => f.size.width === size.width && f.size.height === size.height)?.id ?? 'custom'

/** Below this longer side the L details get too fine: the canvas suggests S. */
export const SMALL_CANVAS = 600
export const isSmallCanvas = (size: Size) => Math.max(size.width, size.height) < SMALL_CANVAS

/**
 * The same composition on a canvas of another size: every object center keeps its place relative
 * to the frame (x as a share of the width, y of the height), and every object is scaled by one
 * factor, the square root of the area ratio, so its proportions stay and a round trip comes back.
 * Objects whose component is unknown only move.
 */
export function relayout(objects: CanvasObject[], sizeOf: (componentId: string) => Size | undefined, from: Size, to: Size): CanvasObject[] {
  const kx = to.width / from.width
  const ky = to.height / from.height
  const k = Math.sqrt(kx * ky)
  return objects.map((obj) => {
    const box = sizeOf(obj.componentId)
    if (!box) return { ...obj, x: obj.x * kx, y: obj.y * ky }
    const center = boxCenter(obj, box)
    const scale = obj.scale * k
    return { ...obj, scale, x: center.x * kx - (box.width * scale) / 2, y: center.y * ky - (box.height * scale) / 2 }
  })
}

/** Scale that gives a component of size `to` the same box area as `from` at `scale` (same center). */
export function matchedScale(scale: number, from: Size, to: Size) {
  return scale * Math.sqrt((from.width * from.height) / (to.width * to.height))
}

/**
 * Every library object in the other size: the same object and state, center, rotation, mirroring
 * and color variant; the scale keeps its box on screen (L and S differ in detail, and the S sheet
 * draws them smaller). Objects with no version of that size stay as they are.
 */
export function swapSize(objects: CanvasObject[], sizeOf: (componentId: string) => Size | undefined, size: ObjectSize): CanvasObject[] {
  return objects.map((obj) => {
    const version = parseVersionId(obj.componentId)
    if (!version || version.size === size) return obj
    const componentId = versionId(version.objectId, size, version.state)
    const [from, to] = [sizeOf(obj.componentId), sizeOf(componentId)]
    if (!from || !to) return obj
    const center = boxCenter(obj, from)
    const scale = matchedScale(obj.scale, from, to)
    return { ...obj, componentId, scale, x: center.x - (to.width * scale) / 2, y: center.y - (to.height * scale) / 2 }
  })
}

/** Size of the library objects of a composition: of the first one, L if there are none. */
export const objectSizeOf = (objects: CanvasObject[]): ObjectSize =>
  objects.map((o) => parseVersionId(o.componentId)?.size).find((s) => s !== undefined) ?? 'L'
