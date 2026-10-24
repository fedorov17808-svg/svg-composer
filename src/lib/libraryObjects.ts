export type ObjectSize = 'L' | 'S'
export type ObjectState = 'main' | 'bg'

/** Id of the library component of one version of an object. */
export const versionId = (objectId: string, size: ObjectSize, state: ObjectState) => `lib-${size}-${state}-${objectId}`

/** `lib-L-main-book` → its parts; null for other components (the gophers of v1). */
export function parseVersionId(id: string): { objectId: string; size: ObjectSize; state: ObjectState } | null {
  const m = /^lib-(L|S)-(main|bg)-(.+)$/.exec(id)
  return m ? { size: m[1] as ObjectSize, state: m[2] as ObjectState, objectId: m[3] } : null
}

/**
 * Sheet units per canvas unit, by size. The S sheet draws objects at about half the size of L (the
 * versions differ in detail, not in size), so an S object is shown twice as large to match its L one.
 */
const SHEET_SCALE: Record<ObjectSize, number> = { L: 1, S: 2 }
/**
 * Sheet units of L per side of a square with the canvas area: on a 1200×800 canvas the L book is 578
 * wide, the coin 115. By area, not height, so a format change (which scales objects by the root of the
 * area ratio) and a newly placed object agree.
 */
const SHEET_PER_SIDE = 2000 * Math.sqrt(1200 / 800)

/**
 * Scale of a new library object: every object in the proportions of the Figma sheet (a small coin,
 * a big book), not all to the same height. Null for components that are not library versions.
 */
export function nativeScale(componentId: string, canvas: { width: number; height: number }): number | null {
  const version = parseVersionId(componentId)
  return version ? (Math.sqrt(canvas.width * canvas.height) / SHEET_PER_SIDE) * SHEET_SCALE[version.size] : null
}
