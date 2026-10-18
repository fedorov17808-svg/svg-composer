import { describe, expect, it } from 'vitest'
import { selectionUnits, useEditorStore, wholeMarkName } from '../store/editor'
import { applyOverrides, fitsTree, markIndex, type MarkedObject } from './marks'
import type { GroupNode, LeafNode } from './svgGroups'
import { padZeroSide } from './svgGroups'

// shop(0) > [awning(1), sign(2)], gopher(3); leaves: 0 wall in 0, 1 stripe in 1, 2 letter in 2,
// 3 paw drawn with the shop (in 0), 4 loose dot at the root.
const tree = { groupParent: [-1, 0, 0, -1], leafParent: [0, 1, 2, 0, -1] }
const obj = (name: string, groups: number[], leaves: number[] = []): MarkedObject => ({ name, groups, leaves })

describe('applyOverrides', () => {
  it('names, merges and drops by generated index', () => {
    const out = applyOverrides([obj('A', [1]), obj('B', [2]), obj('C', [3])], tree, [
      { op: 'merge', objects: [0, 1], name: 'Магазин' },
      { op: 'name', object: 2, name: 'Гофер' },
    ])
    expect(out).toEqual([obj('Магазин', [1, 2]), obj('Гофер', [3])])
    expect(applyOverrides([obj('A', [1]), obj('B', [2])], tree, [{ op: 'drop', object: 0 }])).toEqual([obj('B', [2])])
  })

  it('adding a shape inside a member group of another object splits that group', () => {
    const out = applyOverrides([obj('Магазин', [0]), obj('Гофер', [3])], tree, [{ op: 'add', object: 1, leaves: [3] }])
    expect(out).toEqual([obj('Магазин', [1, 2], [0]), obj('Гофер', [3], [3])])
  })

  it('remove takes a node out, split makes a new object of it', () => {
    expect(applyOverrides([obj('A', [0])], tree, [{ op: 'remove', object: 0, groups: [2] }])).toEqual([obj('A', [1], [0, 3])])
    expect(applyOverrides([obj('A', [0])], tree, [{ op: 'split', object: 0, name: 'Вывеска', groups: [2] }])).toEqual([
      obj('A', [1], [0, 3]),
      obj('Вывеска', [2]),
    ])
  })

  it('rest adds what no object holds, free groups whole', () => {
    expect(applyOverrides([obj('A', [1])], tree, [{ op: 'rest', object: 0 }])).toEqual([obj('A', [1, 2, 3], [0, 3, 4])])
    expect(applyOverrides([obj('A', [0, 3])], tree, [{ op: 'rest', name: 'Точка' }])).toEqual([obj('A', [0, 3]), obj('Точка', [], [4])])
  })

  it('refuses an unknown object', () => {
    expect(() => applyOverrides([], tree, [{ op: 'name', object: 0, name: 'x' }])).toThrow()
  })
})

describe('markIndex', () => {
  it('a member brings its content; the innermost member wins', () => {
    const { groupMark, leafMark } = markIndex([obj('Магазин', [0]), obj('Вывеска', [2]), obj('Гофер', [3], [3])], tree)
    expect(groupMark).toEqual([0, 0, 1, 2])
    expect(leafMark).toEqual([0, 0, 1, 2, -1])
  })

  it('markup with a missing node does not fit', () => {
    expect(fitsTree([obj('A', [3], [4])], tree)).toBe(true)
    expect(fitsTree([obj('A', [4])], tree)).toBe(false)
  })
})

describe('padZeroSide', () => {
  it('widens a zero side to the stroke width, centered', () => {
    expect(padZeroSide({ x: 10, y: 0, width: 0, height: 20 }, 2)).toEqual({ x: 9, y: 0, width: 2, height: 20 })
    expect(padZeroSide({ x: 0, y: 5, width: 8, height: 0 }, 1)).toEqual({ x: 0, y: 4.5, width: 8, height: 1 })
    expect(padZeroSide({ x: 1, y: 1, width: 3, height: 4 }, 2)).toEqual({ x: 1, y: 1, width: 3, height: 4 })
    expect(padZeroSide({ x: 1, y: 1, width: 0, height: 4 }, 0)).toEqual({ x: 1, y: 1, width: 0, height: 4 })
  })
})

const group = (box: [number, number, number, number], parent: number, children: number[], depth = 0): GroupNode => ({
  id: null,
  parent,
  children,
  depth,
  elementCount: 3,
  groupCount: 0,
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
})
const leaf = (box: [number, number, number, number], parent: number): LeafNode => ({
  parent,
  tag: 'path',
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
  visible: true,
})

describe('click over the markup', () => {
  const nodes = [
    group([0, 0, 100, 100], -1, [1, 2]),
    group([0, 0, 100, 30], 0, [], 1),
    group([10, 40, 50, 20], 0, [], 1),
    group([110, 20, 60, 80], -1, []),
  ]
  const leaves = [leaf([0, 30, 100, 70], 0), leaf([0, 0, 100, 30], 1), leaf([10, 40, 50, 20], 2), leaf([95, 60, 20, 10], 0), leaf([200, 0, 5, 5], -1)]
  const marks = [obj('Магазин', [1, 2], [0]), obj('Гофер', [3], [3])]
  const index = { nodes, elements: [], leaves, leafElements: [], viewBox: { x: 0, y: 0, width: 300, height: 120 } }
  const selected = () => {
    const s = useEditorStore.getState()
    return { groups: s.selection.map((item) => item.node).sort(), leaves: [...s.selectedLeaves].sort() }
  }

  it('selects the whole marked-up object as one unit; ↓ narrows to the clicked part, ↑ widens back', () => {
    useEditorStore.getState().setNodes(index, marks)
    useEditorStore.getState().select(1, false)
    expect(selected()).toEqual({ groups: [1, 2], leaves: [0] })
    expect(selectionUnits(useEditorStore.getState())).toHaveLength(1)
    expect(wholeMarkName(useEditorStore.getState())).toBe('Магазин')
    useEditorStore.getState().levelDown()
    expect(selected()).toEqual({ groups: [1], leaves: [] })
    useEditorStore.getState().levelUp()
    expect(selected()).toEqual({ groups: [1, 2], leaves: [0] })
  })

  it('a shape drawn inside another group selects its own object', () => {
    useEditorStore.getState().setNodes(index, marks)
    useEditorStore.getState().selectLeaf(3, false)
    expect(selected()).toEqual({ groups: [3], leaves: [3] })
    expect(useEditorStore.getState().markBoxes[1]).toEqual({ x: 95, y: 20, width: 75, height: 80 })
  })

  it('stale markup is ignored', () => {
    useEditorStore.getState().setNodes(index, [obj('?', [9])])
    expect(useEditorStore.getState().marks).toEqual([])
  })
})
