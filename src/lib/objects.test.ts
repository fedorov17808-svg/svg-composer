import { describe, expect, it } from 'vitest'
import { clickedObject, useEditorStore } from '../store/editor'
import { buildObjects, objectMembers } from './objects'
import type { GroupNode } from './svgGroups'

/** A group `[x, y, width, height]` with `elements` shapes inside. */
const g = (box: [number, number, number, number], elements = 1, parent = -1): GroupNode => ({
  id: null,
  parent,
  children: [],
  depth: parent < 0 ? 0 : 1,
  elementCount: elements,
  groupCount: 0,
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
})

// Siblings as drawn in the gopher pack (s08): ear behind, body (fill + shading + outline), belly,
// highlight dots, the face group on top.
const EAR = g([102, 130, 20, 20], 2)
const BODY = g([100, 40, 320, 490], 11)
const BELLY = g([180, 290, 190, 210])
const DOT = g([390, 200, 9, 9])
const FACE = g([140, 70, 280, 240], 26)

describe('buildObjects', () => {
  it('puts the face, belly, dots and ear onto the body: one gopher', () => {
    const owners = buildObjects([EAR, BODY, BELLY, DOT, FACE])
    expect(owners).toEqual([1, 1, 1, 1, 1])
  })

  it('chains parts: eyes lie on the face, the face on the body', () => {
    const eye = g([160, 90, 40, 40])
    expect(buildObjects([BODY, FACE, eye])).toEqual([0, 0, 0])
  })

  it('keeps a gopher in front of a single-shape frame (calendar in s04) separate', () => {
    const sheet = g([0, 0, 600, 520])
    const cell = g([20, 100, 40, 40])
    const gopher = g([300, 150, 230, 350], 64)
    expect(buildObjects([sheet, cell, gopher])).toEqual([0, 0, 2])
  })

  it('takes simple stripes onto a single shape (lantern in s12)', () => {
    const disc = g([0, 0, 150, 150])
    expect(buildObjects([disc, g([20, 0, 110, 150]), g([40, 0, 70, 150])])).toEqual([0, 0, 0])
  })

  it('keeps a composite group drawn behind a much bigger one separate (left gopher in s20)', () => {
    const gopher = g([10, 200, 140, 190], 65)
    const tree = g([0, 100, 580, 300], 101)
    expect(buildObjects([gopher, tree])).toEqual([0, 1])
    // A simple shape behind is fine: the second chopstick in s09.
    expect(buildObjects([g([10, 10, 230, 280]), g([0, 0, 280, 320])])).toEqual([1, 1])
  })

  it('lets a bigger shape pass between body and face (fishing rod in s14)', () => {
    const rod = g([0, 30, 530, 390])
    expect(buildObjects([BODY, BELLY, rod, FACE])).toEqual([0, 0, 2, 0])
  })

  it('lets a small detail lying on the body pass between (a paw sticking out in s10)', () => {
    const paw = g([380, 300, 80, 60])
    expect(buildObjects([BODY, paw, FACE])).toEqual([0, 1, 0])
  })

  it('cuts the link when an unrelated object is drawn between part and container', () => {
    const sign = g([350, 350, 250, 150], 5)
    expect(buildObjects([BODY, sign, FACE])).toEqual([0, 1, 2])
  })

  it('links only siblings', () => {
    // The face lies on the top-level group next to it, never on the body nested inside that group.
    const parent = g([0, 0, 600, 600], 40)
    expect(buildObjects([parent, { ...BODY, parent: 0 }, FACE])).toEqual([0, 1, 0])
  })
})

describe('clickedObject', () => {
  it('a click on the body selects the whole gopher', () => {
    const nodes = [EAR, BODY, BELLY, DOT, FACE, g([450, 500, 100, 80], 3)]
    const owners = buildObjects(nodes)
    expect(clickedObject(nodes, owners, 1)).toEqual([0, 1, 2, 3, 4])
    expect(objectMembers(owners, 5)).toEqual([5])
  })

  it('climbs past a parent that is only a wrapper around the object (s10)', () => {
    // gopher(0) > [body(1) + belly(2) + face(3)]; a click on the belly selects the gopher group.
    const nodes = [
      g([110, 50, 400, 510], 80),
      g([170, 90, 300, 460], 11, 0),
      g([210, 320, 180, 200], 1, 0),
      g([160, 120, 290, 180], 25, 0),
      g([0, 0, 50, 50], 1),
    ]
    const owners = buildObjects(nodes)
    expect(objectMembers(owners, 2)).toEqual([1, 2, 3])
    expect(clickedObject(nodes, owners, 2)).toEqual([0])
  })
})

describe('levels over an object', () => {
  it('click selects the object, ↓ narrows to the clicked group, ↑ widens back', () => {
    const nodes = [EAR, BODY, BELLY, DOT, FACE]
    const store = useEditorStore.getState()
    store.setNodes({ nodes, elements: [], leaves: [], leafElements: [] })
    const selected = () => useEditorStore.getState().selection.map((item) => item.node)
    store.select(2, false)
    expect(selected()).toEqual([0, 1, 2, 3, 4])
    useEditorStore.getState().levelDown()
    expect(selected()).toEqual([2])
    useEditorStore.getState().levelUp()
    expect(selected()).toEqual([0, 1, 2, 3, 4])
    // Shift+click inside the selected object removes all of it.
    useEditorStore.getState().select(4, true)
    expect(selected()).toEqual([])
  })
})
