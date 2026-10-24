import { describe, expect, it } from 'vitest'
import manifest from '../../public/library/manifest.json'
import { boxCenter, toCanvas, type CanvasObject, type Size } from './canvas'
import { FORMATS, formatOf, isSmallCanvas, objectSizeOf, relayout, swapSize } from './formats'
import { versionId, type ObjectSize, type ObjectState } from './libraryObjects'

/** Real sizes of all 40 versions, as the library store has them. */
const SIZES = new Map<string, Size>(
  manifest.flatMap((o) =>
    (['L', 'S'] as ObjectSize[]).flatMap((size) =>
      (['main', 'bg'] as ObjectState[]).map((state) => [versionId(o.id, size, state), o.versions[size][state]] as const),
    ),
  ),
)
const sizeOf = (id: string) => SIZES.get(id)

const obj = (componentId: string, patch: Partial<CanvasObject> = {}): CanvasObject => ({
  id: componentId,
  componentId,
  name: componentId,
  x: 100,
  y: 200,
  scale: 0.5,
  rotation: 0,
  flipX: false,
  ...patch,
})

/** Width over height of the object as drawn: the distances between its corners on the canvas. */
function drawnRatio(o: CanvasObject) {
  const box = sizeOf(o.componentId)!
  const [a, b, c] = [toCanvas(o, box, 0, 0), toCanvas(o, box, box.width, 0), toCanvas(o, box, 0, box.height)]
  return Math.hypot(b.x - a.x, b.y - a.y) / Math.hypot(c.x - a.x, c.y - a.y)
}

const OBJECTS = [
  obj('lib-L-main-book', { x: -300, y: 100, rotation: 30 }),
  obj('lib-L-bg-lamp', { x: 1500, y: 600, scale: 0.8, flipX: true, rotation: -15 }),
  obj('lib-L-main-coin', { x: 900, y: 450, scale: 1.2, variant: 3 }),
]

describe('formats', () => {
  it('match the examples: 1:1, 2:1, 2:3', () => {
    expect(FORMATS.map((f) => [f.id, f.size.width / f.size.height])).toEqual([
      ['square', 1],
      ['wide', 2],
      ['tall', 2 / 3],
    ])
    expect(formatOf({ width: 2000, height: 1000 })).toBe('wide')
    expect(formatOf({ width: 2000, height: 1001 })).toBe('custom')
  })

  it('call a canvas small below 600 on the longer side', () => {
    expect(isSmallCanvas({ width: 599, height: 300 })).toBe(true)
    expect(isSmallCanvas({ width: 400, height: 600 })).toBe(false)
  })
})

describe('relayout', () => {
  const wide = FORMATS[1].size
  const tall = FORMATS[2].size

  it('keeps the proportions of every object and its place relative to the frame', () => {
    const moved = relayout(OBJECTS, sizeOf, wide, tall)
    moved.forEach((after, i) => {
      const before = OBJECTS[i]
      const box = sizeOf(before.componentId)!
      expect(drawnRatio(after)).toBeCloseTo(drawnRatio(before), 9)
      expect(drawnRatio(after)).toBeCloseTo(box.width / box.height, 9)
      // One factor for both axes: the root of the area ratio.
      expect(after.scale / before.scale).toBeCloseTo(Math.sqrt((tall.width * tall.height) / (wide.width * wide.height)), 9)
      const [c0, c1] = [boxCenter(before, box), boxCenter(after, box)]
      expect(c1.x / tall.width).toBeCloseTo(c0.x / wide.width, 9)
      expect(c1.y / tall.height).toBeCloseTo(c0.y / wide.height, 9)
      // Nothing else changes.
      expect({ ...after, x: 0, y: 0, scale: 0 }).toEqual({ ...before, x: 0, y: 0, scale: 0 })
    })
  })

  it('comes back after a round trip', () => {
    const back = relayout(relayout(OBJECTS, sizeOf, wide, tall), sizeOf, tall, wide)
    back.forEach((o, i) => {
      for (const key of ['x', 'y', 'scale'] as const) expect(o[key]).toBeCloseTo(OBJECTS[i][key], 9)
    })
  })
})

describe('swapSize', () => {
  it('puts every object in S keeping center, box, rotation, mirroring, state and variant', () => {
    const small = swapSize(OBJECTS, sizeOf, 'S')
    expect(small.map((o) => o.componentId)).toEqual(['lib-S-main-book', 'lib-S-bg-lamp', 'lib-S-main-coin'])
    small.forEach((after, i) => {
      const before = OBJECTS[i]
      const [from, to] = [sizeOf(before.componentId)!, sizeOf(after.componentId)!]
      const [c0, c1] = [boxCenter(before, from), boxCenter(after, to)]
      expect(c1.x).toBeCloseTo(c0.x, 9)
      expect(c1.y).toBeCloseTo(c0.y, 9)
      // The visible box stays (to 0.05 px: the sizes in the manifest are rounded to 0.01), L and S
      // have the same proportions, the S sheet is drawn smaller.
      expect(to.width * after.scale).toBeCloseTo(from.width * before.scale, 1)
      expect(to.height * after.scale).toBeCloseTo(from.height * before.scale, 1)
      const kept = (o: CanvasObject) => [o.id, o.name, o.rotation, o.flipX, o.variant]
      expect(kept(after)).toEqual(kept(before))
    })
    // S and back gives the L objects again.
    swapSize(small, sizeOf, 'L').forEach((o, i) => {
      expect(o.componentId).toBe(OBJECTS[i].componentId)
      for (const key of ['x', 'y', 'scale'] as const) expect(o[key]).toBeCloseTo(OBJECTS[i][key], 9)
    })
  })

  it('keeps the box of every object of the library in both directions', () => {
    for (const o of manifest) {
      for (const state of ['main', 'bg'] as ObjectState[]) {
        const [s] = swapSize([obj(versionId(o.id, 'L', state))], sizeOf, 'S')
        const [from, to] = [o.versions.L[state], o.versions.S[state]]
        expect(to.width * s.scale, `${o.id} ${state}`).toBeCloseTo(from.width * 0.5, 1)
        expect(to.height * s.scale, `${o.id} ${state}`).toBeCloseTo(from.height * 0.5, 1)
      }
    }
  })

  it('leaves alone the objects already in that size and the components that are not library versions', () => {
    const gopher = obj('c-123')
    const [same, other] = swapSize([OBJECTS[0], gopher], sizeOf, 'L')
    expect(same).toBe(OBJECTS[0])
    expect(other).toBe(gopher)
    expect(objectSizeOf([gopher, obj('lib-S-bg-pen')])).toBe('S')
    expect(objectSizeOf([gopher])).toBe('L')
  })
})
