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

  it('keeps a big enough group and stops at top-level groups', () => {
    expect(meaningfulGroup(nodes, 1)).toBe(1)
    expect(meaningfulGroup(nodes, 4)).toBe(4)
  })
})
