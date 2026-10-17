import { describe, expect, it } from 'vitest'
import type { GroupNode } from '../lib/svgGroups'
import { meaningfulGroup } from './editor'

const node = (parent: number, width: number, height: number): GroupNode => ({
  id: null,
  parent,
  children: [],
  depth: 0,
  elementCount: 0,
  groupCount: 0,
  x: 0,
  y: 0,
  width,
  height,
})

describe('meaningfulGroup', () => {
  // Scene 100×100: a gopher (40×40 = 16 %) with a body (30×30 = 9 %) and an eye (5×5).
  const nodes = [node(-1, 100, 100), node(0, 40, 40), node(1, 30, 30), node(2, 5, 5), node(-1, 3, 3)]

  it('climbs from a small part to the first group of at least 10 % of the scene', () => {
    expect(meaningfulGroup(nodes, 3)).toBe(1)
    expect(meaningfulGroup(nodes, 2)).toBe(1)
  })

  it('climbs from a layer to the object when the parent is barely bigger', () => {
    // s13: the body (337×508) is a layer of the gopher (367×563) that also holds eyes and paws.
    const gopher = [node(-1, 600, 600), node(0, 367, 563), node(1, 337, 508), node(1, 60, 60)]
    expect(meaningfulGroup(gopher, 2)).toBe(1)
    expect(meaningfulGroup(gopher, 3)).toBe(1)
  })

  it('keeps a big enough group and stops at top-level groups', () => {
    expect(meaningfulGroup(nodes, 1)).toBe(1)
    expect(meaningfulGroup(nodes, 4)).toBe(4)
  })
})
