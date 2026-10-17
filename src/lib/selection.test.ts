import { describe, expect, it } from 'vitest'
import { collapse, leavesInRect, pickInRect } from './selection'
import type { GroupNode, LeafNode } from './svgGroups'

const group = (parent: number): GroupNode => ({
  id: null,
  parent,
  children: [],
  depth: 0,
  elementCount: 0,
  groupCount: 0,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
})

const leaf = (parent: number, x: number, y: number, width: number, height: number, visible = true): LeafNode => ({
  parent,
  tag: 'path',
  x,
  y,
  width,
  height,
  visible,
})

// scene(0) > gopher(1) > eyes(2); leaves: body, eye L, eye R under eyes, a fence plank in the scene.
const nodes = [group(-1), group(0), group(1)]
const leaves = [
  leaf(1, 10, 10, 30, 50), // 0 body
  leaf(2, 15, 15, 5, 5), // 1 eye L
  leaf(2, 30, 15, 5, 5), // 2 eye R
  leaf(0, 0, 40, 100, 4), // 3 plank, crosses the gopher
  leaf(1, 20, 20, 0, 10), // 4 vertical line: zero width
  leaf(1, 0, 0, 1, 1, false), // 5 clipped away
]

describe('leavesInRect', () => {
  it('takes visible leaves entirely inside, including zero-width lines', () => {
    expect(leavesInRect(leaves, { x: 5, y: 5, width: 40, height: 60 })).toEqual([0, 1, 2, 4])
  })
})

describe('collapse', () => {
  it('replaces a complete group by the group, keeping the biggest one', () => {
    expect(collapse(nodes, leaves, [0, 1, 2, 4])).toEqual({ groups: [1], leaves: [] })
  })

  it('keeps leaves of an incomplete group, collapsing complete subgroups', () => {
    expect(collapse(nodes, leaves, [1, 2, 4])).toEqual({ groups: [2], leaves: [4] })
  })

  it('leaves a lone plank as a leaf', () => {
    expect(collapse(nodes, leaves, [3, 1])).toEqual({ groups: [], leaves: [1, 3] })
  })
})

describe('pickInRect', () => {
  // scene(0) > [calendar sheet leaf, gopher(1) > body + eye]; the gopher sticks out of the calendar.
  const nodes = [
    { ...group(-1), width: 200, height: 100 },
    { ...group(0), x: 120, y: 20, width: 60, height: 90 },
  ]
  const leaves = [leaf(0, 0, 0, 150, 80), leaf(1, 120, 20, 60, 90), leaf(1, 130, 30, 5, 5)]
  const objectOf = (l: number) => nodes[leaves[l].parent === 0 ? 0 : 1]

  it('takes the calendar but does not cut the gopher sticking out of the rect apart', () => {
    expect(pickInRect(leaves, { x: 0, y: 0, width: 160, height: 85 }, objectOf)).toEqual([0])
  })

  it('picks details within an object bigger than the rect, even if the rect sticks out of it', () => {
    expect(pickInRect(leaves, { x: 125, y: 25, width: 20, height: 20 }, objectOf)).toEqual([2])
    expect(pickInRect(leaves, { x: 125, y: 15, width: 20, height: 20 }, objectOf)).toEqual([2])
  })

  it('picks a whole object inside the rect', () => {
    expect(pickInRect(leaves, { x: 110, y: 10, width: 80, height: 110 }, objectOf)).toEqual([1, 2])
  })
})
