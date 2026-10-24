// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { boxCenter, toCanvas } from '../lib/canvas'
import { emptyHistory } from '../lib/history'
import { DUPLICATE_OFFSET, useCanvasStore } from './canvas'
import manifest from '../../public/library/manifest.json'
import { useLibraryStore, type LibraryComponent } from './library'
import { buildComposition, needsRecompose } from './compose'
import { useObjectLibraryStore, type LibraryObject } from './objectLibrary'

const component = (id: string): LibraryComponent => ({
  id,
  name: id,
  sourceId: 's01',
  markup: '<g/>',
  defs: '',
  width: 100,
  height: 50,
  createdAt: 0,
})

const store = () => useCanvasStore.getState()
const order = () => store().objects.map((o) => o.name).join(' ')

beforeEach(() => {
  useCanvasStore.setState({ objects: [], selectedId: null, history: emptyHistory(), gesture: null, paletteId: 'lilac', size: { width: 1200, height: 800 }, format: 'custom', objectSize: 'L' })
})

const version = (id: string, width: number, height: number): LibraryComponent => ({ ...component(id), sourceId: 'library', width, height })

describe('library objects', () => {
  it('come in the proportions of the sheet; an S object as large as its L one', () => {
    store().add(version('lib-L-main-book', 1445.9, 976.67), { x: 600, y: 400 })
    store().add(version('lib-L-main-coin', 286.68, 146.42), { x: 600, y: 400 })
    store().add(version('lib-S-main-book', 722.96, 488.35), { x: 600, y: 400 })
    const [book, coin, small] = store().objects
    expect(book.scale).toBeCloseTo(0.4)
    expect(coin.scale).toBe(book.scale)
    expect(small.scale).toBeCloseTo(0.8)
    // Gopher pieces keep the old rule: the longer side is 35 % of the canvas height.
    store().add(component('g'), { x: 0, y: 0 })
    expect(store().objects[3].scale).toBeCloseTo((800 * 0.35) / 100)
  })

  it('swap main and background around the same center, as one undo step', () => {
    const main = version('lib-L-main-lamp', 945.96, 1129)
    const bg = version('lib-L-bg-lamp', 945.96, 1128.99)
    store().add(main, { x: 500, y: 300 })
    const id = store().selectedId!
    store().update(id, { rotation: 30, flipX: true, scale: 0.7, variant: 2 })
    const before = store().objects[0]
    store().swapComponent(id, main, bg)
    const after = store().objects[0]
    expect(after).toMatchObject({ componentId: bg.id, rotation: 30, flipX: true, scale: 0.7, variant: 2 })
    expect(after.x + (bg.width * after.scale) / 2).toBeCloseTo(before.x + (main.width * before.scale) / 2, 6)
    expect(after.y + (bg.height * after.scale) / 2).toBeCloseTo(before.y + (main.height * before.scale) / 2, 6)
    store().undo()
    expect(store().objects[0]).toEqual(before)
  })

  it('the color scheme is a composition change: undo brings it back', () => {
    store().setPalette('mint')
    expect(store().paletteId).toBe('mint')
    store().setPalette('mint')
    expect(store().history.past).toHaveLength(1)
    store().undo()
    expect(store().paletteId).toBe('lilac')
    store().redo()
    expect(store().paletteId).toBe('mint')
  })
})

describe('format and object size', () => {
  const versions = [
    version('lib-L-main-book', 1445.9, 976.67),
    version('lib-S-main-book', 722.96, 488.35),
    version('lib-L-bg-coin', 286.68, 146.42),
    version('lib-S-bg-coin', 152.41, 77.83),
  ]
  beforeEach(() => useLibraryStore.setState({ components: versions }))

  it('a preset resizes the canvas, lays the objects out again as one undo step', () => {
    store().add(versions[0], { x: 300, y: 200 })
    store().add(versions[2], { x: 900, y: 600 })
    const before = store().objects
    store().setFormat('square')
    expect(store()).toMatchObject({ format: 'square', size: { width: 1000, height: 1000 } })
    const [book, coin] = store().objects
    // Centers at the same share of the frame, one scale factor for all.
    expect(boxCenter(book, versions[0])).toEqual({ x: expect.closeTo(250), y: expect.closeTo(250) })
    expect(boxCenter(coin, versions[2])).toEqual({ x: expect.closeTo(750), y: expect.closeTo(750) })
    expect(coin.scale / before[1].scale).toBeCloseTo(book.scale / before[0].scale, 9)
    store().setFormat('tall')
    store().undo()
    expect(store().format).toBe('square')
    store().undo()
    expect(store()).toMatchObject({ format: 'custom', size: { width: 1200, height: 800 }, objects: before })
  })

  it('«custom» keeps the size; the size fields lay the objects out too', () => {
    store().setFormat('wide')
    store().add(versions[0], { x: 1000, y: 500 })
    store().setFormat('custom')
    expect(store()).toMatchObject({ format: 'custom', size: { width: 2000, height: 1000 } })
    store().setSize({ width: 500, height: 250 })
    expect(boxCenter(store().objects[0], versions[0])).toEqual({ x: expect.closeTo(250), y: expect.closeTo(125) })
  })

  it('L ↔ S swaps every library object in one undo step and keeps its transforms', () => {
    store().add(versions[0], { x: 300, y: 200 })
    store().add(versions[2], { x: 900, y: 600 })
    store().update(store().objects[0].id, { rotation: 45, flipX: true, variant: 4 })
    const before = store().objects
    store().setObjectSize('S')
    expect(store().objectSize).toBe('S')
    const after = store().objects
    expect(after.map((o) => o.componentId)).toEqual(['lib-S-main-book', 'lib-S-bg-coin'])
    expect(after[0]).toMatchObject({ rotation: 45, flipX: true, variant: 4 })
    expect(boxCenter(after[0], versions[1])).toEqual({ x: expect.closeTo(300), y: expect.closeTo(200) })
    expect(versions[1].width * after[0].scale).toBeCloseTo(versions[0].width * before[0].scale, 1)
    store().undo()
    expect(store()).toMatchObject({ objectSize: 'L', objects: before })
  })

  it('an opened project without settings gets the format from its size and L/S from its objects', () => {
    store().replace({ width: 1000, height: 1500 }, [{ id: 'x', componentId: 'lib-S-bg-coin', name: 'Монета', x: 0, y: 0, scale: 1, rotation: 0, flipX: false }])
    expect(store()).toMatchObject({ format: 'tall', objectSize: 'S', paletteId: 'lilac' })
    store().replace({ width: 1000, height: 1500 }, [], { format: 'custom', objectSize: 'S', paletteId: 'mint' })
    expect(store()).toMatchObject({ format: 'custom', objectSize: 'S', paletteId: 'mint' })
  })
})

describe('automatic composition', () => {
  beforeEach(() => {
    useObjectLibraryStore.setState({ status: 'ready', objects: manifest as LibraryObject[] })
    useLibraryStore.setState({ components: [] })
  })

  it('replaces the objects in one undo step; the same seed rebuilds the same layout for a new format', () => {
    store().add(component('hand'), { x: 10, y: 10 })
    store().setFormat('wide')
    const before = store().objects
    expect(buildComposition({ objectIds: ['book', 'lamp'], background: 'few', seed: 3 })).toBe(true)
    const first = store().objects
    expect(first.map((o) => o.componentId).slice(-2).sort()).toEqual(['lib-L-main-book', 'lib-L-main-lamp'])
    expect(store().auto).toEqual({ objectIds: ['book', 'lamp'], background: 'few', seed: 3, size: { width: 2000, height: 1000 } })
    expect(needsRecompose(store())).toBe(false)

    store().setFormat('tall')
    expect(needsRecompose(store())).toBe(true)
    buildComposition(store().auto!)
    expect(needsRecompose(store())).toBe(false)
    const tall = store().objects
    store().setFormat('wide')
    buildComposition(store().auto!)
    const strip = (objects: typeof first) => objects.map(({ id: _id, ...o }) => o)
    expect(strip(store().objects)).toEqual(strip(first))
    expect(strip(tall)).not.toEqual(strip(first))

    store().undo() // rebuild
    store().undo() // format
    store().undo() // rebuild for tall
    store().undo() // format
    store().undo() // build
    expect(store().objects).toEqual(before)
    expect(store().auto).toBeNull()
  })

  it('does nothing without objects', () => {
    expect(buildComposition({ objectIds: [], background: 'few', seed: 1 })).toBe(false)
    expect(store().history.past).toHaveLength(0)
  })
})

describe('canvas editing with undo', () => {
  it('records every action and walks back to an empty canvas', () => {
    store().add(component('a'), { x: 100, y: 100 })
    store().add(component('b'), { x: 300, y: 100 })
    const b = store().selectedId!
    store().duplicate()
    store().reorder(store().selectedId!, 'back')
    store().remove(b)
    expect(order()).toBe('b a')
    expect(store().history.past).toHaveLength(5)

    store().undo()
    expect(order()).toBe('b a b')
    store().undo()
    expect(order()).toBe('a b b')
    store().undo()
    store().undo()
    store().undo()
    expect(store().objects).toEqual([])
    store().undo()
    expect(store().objects).toEqual([])

    for (let i = 0; i < 5; i++) store().redo()
    expect(order()).toBe('b a')
  })

  it('duplicates right above the original with an offset and selects the copy', () => {
    store().add(component('a'), { x: 100, y: 100 })
    store().add(component('b'), { x: 300, y: 100 })
    store().select(store().objects[0].id)
    store().duplicate()
    const [orig, copy] = store().objects
    expect(order()).toBe('a a b')
    expect(store().selectedId).toBe(copy.id)
    expect(copy.id).not.toBe(orig.id)
    expect(copy.x - orig.x).toBe(DUPLICATE_OFFSET)
    expect(copy.y - orig.y).toBe(DUPLICATE_OFFSET)
  })

  it('a drag is one undo step however many moves it has', () => {
    store().add(component('a'), { x: 100, y: 100 })
    const id = store().selectedId!
    const start = store().objects[0]
    store().beginGesture()
    for (let i = 1; i <= 30; i++) store().update(id, { x: start.x + i, rotation: i })
    store().endGesture()
    expect(store().history.past).toHaveLength(2)
    store().undo()
    expect(store().objects[0]).toEqual(start)
    store().redo()
    expect(store().objects[0].x).toBe(start.x + 30)
  })

  it('a click without movement records nothing', () => {
    store().add(component('a'))
    store().beginGesture()
    store().endGesture()
    expect(store().history.past).toHaveLength(1)
  })

  it('no-op reorder and selection are not undo steps', () => {
    store().add(component('a'))
    store().reorder(store().selectedId!, 'front')
    store().select(null)
    expect(store().history.past).toHaveLength(1)
  })

  it('flips around the box center, also when rotated', () => {
    const size = { width: 100, height: 50 }
    store().add(component('a'), { x: 200, y: 200 })
    const id = store().selectedId!
    store().update(id, { rotation: 30 })
    const before = store().objects[0]
    store().flip(id)
    const after = store().objects[0]
    expect(boxCenter(after, size)).toEqual(boxCenter(before, size))
    // Every point lands on its mirror image across the vertical line through the center.
    const cx = boxCenter(before, size).x
    for (const [u, v] of [[0, 0], [100, 0], [30, 40]]) {
      const p = toCanvas(before, size, u, v)
      const q = toCanvas(after, size, u, v)
      expect(q.x).toBeCloseTo(2 * cx - p.x)
      expect(q.y).toBeCloseTo(p.y)
    }
  })

  it('locked objects do not flip', () => {
    store().add(component('a'))
    const id = store().selectedId!
    store().update(id, { locked: true })
    store().flip(id)
    expect(store().objects[0].flipX).toBe(false)
  })

  it('merges quick arrow nudges into one step', () => {
    store().add(component('a'), { x: 100, y: 100 })
    const id = store().selectedId!
    for (let i = 0; i < 5; i++) store().update(id, { x: store().objects[0].x + 1 }, `nudge:${id}`)
    expect(store().history.past).toHaveLength(2)
  })

  it('deleting a component forgets its instances in history too', () => {
    store().add(component('a'))
    store().add(component('b'))
    store().removeComponent('a')
    expect(order()).toBe('b')
    store().undo()
    expect(order()).toBe('')
  })
})
