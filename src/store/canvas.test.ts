// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { boxCenter, toCanvas } from '../lib/canvas'
import { emptyHistory } from '../lib/history'
import { DUPLICATE_OFFSET, useCanvasStore } from './canvas'
import type { LibraryComponent } from './library'

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
  useCanvasStore.setState({ objects: [], selectedId: null, history: emptyHistory(), gesture: null })
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
