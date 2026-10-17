import { describe, expect, it } from 'vitest'
import { clickedObject, selectionUnits, useEditorStore } from '../store/editor'
import { buildObjects, otherFigures, type Areas } from './objects'
import type { GroupNode, LeafNode } from './svgGroups'

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

const leaf = (box: [number, number, number, number], parent = -1, order?: number): LeafNode => ({
  parent,
  tag: 'path',
  order,
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
  visible: true,
})

const AREAS: Areas = { scene: 600 * 600, illustration: 600 * 600 }

/** Object of every group, named by its first group. */
const owners = (nodes: GroupNode[], leaves: LeafNode[] = [], areas = AREAS) => {
  const index = buildObjects(nodes, leaves, areas)
  return index.groupObject.map((o) => index.objects[o].groups[0])
}

// Siblings as drawn in the gopher pack (s08): ear behind, body (fill + shading + outline), belly,
// highlight dots, the face group on top.
const EAR = g([102, 130, 20, 20], 2)
const BODY = g([100, 40, 320, 490], 11)
const BELLY = g([180, 290, 190, 210])
const DOT = g([390, 200, 9, 9])
const FACE = g([140, 70, 280, 240], 26)

describe('buildObjects', () => {
  it('puts the face, belly, dots and ear onto the body: one gopher', () => {
    expect(owners([EAR, BODY, BELLY, DOT, FACE])).toEqual([0, 0, 0, 0, 0])
  })

  it('chains parts: eyes lie on the face, the face on the body', () => {
    expect(owners([BODY, FACE, g([160, 90, 40, 40])])).toEqual([0, 0, 0])
  })

  it('keeps a gopher in front of a single-shape frame separate, takes the cells (calendar in s04)', () => {
    const sheet = g([0, 0, 600, 400])
    const cell = g([20, 100, 40, 40])
    const gopher = g([300, 150, 230, 350], 64)
    expect(owners([sheet, cell, gopher])).toEqual([0, 0, 2])
  })

  it('takes simple stripes and lettering onto a single shape (lantern, HELLO bubble)', () => {
    const disc = g([0, 0, 150, 150])
    expect(owners([disc, g([20, 0, 110, 150]), g([40, 0, 70, 150])])).toEqual([0, 0, 0])
    const bubble = g([130, 410, 150, 90])
    const text = g([160, 440, 100, 22], 12)
    // Another caption far away drawn in between does not matter (HI in s16).
    expect(owners([bubble, g([350, 130, 40, 22], 6), text])).toEqual([0, 1, 0])
  })

  it('keeps a composite group drawn behind a much bigger one separate (left gopher in s20)', () => {
    const gopher = g([10, 200, 140, 190], 65)
    const tree = g([0, 100, 580, 300], 101)
    expect(owners([gopher, tree])).toEqual([0, 1])
    // A simple shape behind is fine: the second chopstick in s09.
    expect(owners([g([10, 10, 230, 280]), g([0, 0, 280, 320])])).toEqual([0, 0])
  })

  it('lets a bigger shape pass between body and face (fishing rod in s14)', () => {
    const rod = g([0, 30, 530, 390])
    expect(owners([BODY, BELLY, rod, FACE])).toEqual([0, 0, 2, 0])
  })

  it('lets a small detail sticking out of the body pass between (a paw in s10)', () => {
    // Half on the body and drawn right after it: the paw is a part of the gopher.
    const paw = g([380, 300, 80, 60])
    expect(owners([BODY, paw, FACE])).toEqual([0, 0, 0])
    // Mostly off the body: not a part, but it does not cut the face off either.
    const far = g([400, 300, 80, 60])
    expect(owners([BODY, far, FACE])).toEqual([0, 1, 0])
  })

  it('cuts the link when another thing lying on the container is drawn between', () => {
    const sign = g([350, 350, 250, 150], 5)
    expect(owners([BODY, sign, FACE])).toEqual([0, 1, 2])
  })

  it('takes overlapping parts drawn right next to the body (carp in s14)', () => {
    const body = g([377, 298, 197, 225], 7)
    const head = g([480, 276, 113, 122], 7)
    const tail = g([330, 436, 145, 80], 7)
    expect(owners([body, head, tail])).toEqual([0, 0, 0])
    // Not when something else lies between them: overlapping alone is not enough.
    expect(owners([body, g([300, 300, 60, 60], 3), tail])).toEqual([0, 1, 2])
  })

  it('takes loose shapes too: a body that is a path in a scene group (s02)', () => {
    const scene = { ...g([0, 50, 140, 70], 120), order: 0 }
    const shading = { ...g([22, 65, 36, 50], 3, 0), order: 2 }
    const face = { ...g([21, 62, 32, 28], 13, 0), order: 4 }
    const outline = leaf([20, 58, 38, 58], 0, 3)
    const fill = leaf([21, 59, 37, 56], 0, 1)
    const rope = leaf([6, 95, 66, 6], 0, 5)
    const index = buildObjects([scene, shading, face], [outline, fill, rope], AREAS)
    const gopher = index.objects[index.leafObject[0]]
    expect(gopher.groups).toEqual([1, 2])
    expect(gopher.leaves).toEqual([1, 0])
    expect(index.leafObject[2]).toBe(-1)
  })

  it('a part behind its container needs nothing else in between (calendar cells behind the gopher in s04)', () => {
    const sheet = g([0, 0, 600, 400])
    const cell = g([420, 200, 40, 40])
    const check = g([200, 150, 150, 140])
    const gopher = g([300, 150, 230, 350], 64)
    // The cell does not stick to the gopher; the check mark drawn between them keeps them apart.
    expect(owners([sheet, cell, check, gopher])).toEqual([0, 1, 2, 3])
    // In front, things that are not on the container do not matter.
    expect(owners([sheet, gopher, g([0, 0, 50, 50], 3), g([320, 200, 40, 40])])).toEqual([0, 1, 2, 1])
  })

  it('a group holding two separate figures is a scene and takes no parts (gong posts in s06)', () => {
    const state = indexed([
      g([196, 155, 22, 192]),
      g([0, 173, 599, 262], 243),
      g([0, 180, 174, 250], 64, 1),
      g([432, 178, 168, 250], 66, 1),
    ])
    expect(state.groupObject[0]).not.toBe(state.groupObject[1])
  })

  it('links only siblings', () => {
    // The face never lies on the body nested inside the group next to it.
    const parent = g([0, 0, 400, 560], 40)
    expect(owners([parent, { ...BODY, parent: 0 }, FACE])).toEqual([0, 1, 0])
  })

  it('never makes an object bigger than 70 % of the illustration', () => {
    const big = g([0, 0, 500, 500], 3)
    const strip = g([10, 10, 480, 100], 3)
    expect(owners([big, strip], [], { scene: 250000, illustration: 250000 / 0.6 })).toEqual([0, 0])
    expect(owners([big, strip], [], { scene: 250000, illustration: 250000 })).toEqual([0, 1])
  })
})

/** Index state for `clickedObject`. */
const indexed = (nodes: GroupNode[], leaves: LeafNode[] = []) => {
  nodes.forEach((n, i) => n.parent >= 0 && nodes[n.parent].children.push(i))
  const viewBox = { x: 0, y: 0, width: 600, height: 600 }
  return { nodes, leaves, viewBox, ...buildObjects(nodes, leaves, AREAS) }
}

describe('clickedObject', () => {
  it('a click on the body selects the whole gopher', () => {
    const state = indexed([EAR, BODY, BELLY, DOT, FACE, g([450, 500, 100, 80], 3)].map((n) => ({ ...n, children: [] })))
    expect(clickedObject(state, { group: 1 }).groups).toEqual([0, 1, 2, 3, 4])
    expect(clickedObject(state, { group: 5 }).groups).toEqual([5])
  })

  it('climbs past a parent that is only a wrapper around the object (s10)', () => {
    const state = indexed([
      g([110, 50, 400, 510], 80),
      g([170, 90, 300, 460], 11, 0),
      g([210, 320, 180, 200], 1, 0),
      g([160, 120, 290, 180], 25, 0),
      g([0, 0, 50, 50], 1),
    ])
    expect(state.objects[state.groupObject[2]].groups).toEqual([1, 2, 3])
    expect(clickedObject(state, { group: 2 }).groups).toEqual([0])
  })

  it('does not climb into a scene with two separate figures (gong in s06)', () => {
    // scene(0) > [gong(1), left gopher(2), right gopher(3)]
    const state = indexed([
      g([0, 170, 600, 260], 240),
      g([240, 200, 120, 120], 1, 0),
      g([0, 180, 170, 250], 64, 0),
      g([430, 180, 170, 250], 66, 0),
    ])
    expect(otherFigures(state, state.nodes, 0, state.objects[state.groupObject[1]], AREAS)).toBe(2)
    expect(otherFigures(state, state.nodes, 0, state.objects[state.groupObject[2]], AREAS)).toBe(1)
    expect(clickedObject(state, { group: 1 }).groups).toEqual([1])
    expect(clickedObject(state, { group: 2 }).groups).toEqual([2])
  })

  it('climbs from a figure lying inside another one (a panda in a gopher’s arms)', () => {
    const state = indexed([g([0, 0, 400, 600], 100), g([100, 40, 300, 560], 60, 0), g([180, 300, 150, 150], 33, 0)])
    expect(otherFigures(state, state.nodes, 0, state.objects[state.groupObject[2]], AREAS)).toBe(0)
  })

  it('climbs from a part that is not a figure to the group holding the character (right gopher in s02)', () => {
    // gopher(1) > [body shading(2), face(3)]: the click on the shading selects the gopher group.
    const state = indexed([
      g([0, 0, 400, 300], 120),
      g([100, 50, 140, 160], 57, 0),
      g([140, 60, 90, 140], 3, 1),
      g([100, 60, 140, 60], 34, 1),
    ])
    expect(clickedObject(state, { group: 2 }).groups).toEqual([1])
  })
})

const VIEWBOX = { x: 0, y: 0, width: 600, height: 600 }

describe('levels over an object', () => {
  it('click selects the object, ↓ narrows to the clicked group, ↑ widens back', () => {
    const nodes = [EAR, BODY, BELLY, DOT, FACE].map((n) => ({ ...n, children: [] }))
    useEditorStore.getState().setNodes({ nodes, elements: [], leaves: [], leafElements: [], viewBox: VIEWBOX })
    const selected = () => useEditorStore.getState().selection.map((item) => item.node)
    useEditorStore.getState().select(2, false)
    expect(selected()).toEqual([0, 1, 2, 3, 4])
    expect(selectionUnits(useEditorStore.getState())).toHaveLength(1)
    useEditorStore.getState().levelDown()
    expect(selected()).toEqual([2])
    useEditorStore.getState().levelUp()
    expect(selected()).toEqual([0, 1, 2, 3, 4])
    // Shift+click inside the selected object removes all of it.
    useEditorStore.getState().select(4, true)
    expect(selected()).toEqual([])
  })

  it('a click on a loose shape of an object selects its groups and shapes; ↓ gives the shape', () => {
    const scene = { ...g([0, 50, 140, 70], 120), order: 0, children: [1, 2] }
    const shading = { ...g([22, 65, 36, 50], 3, 0), order: 2 }
    const face = { ...g([21, 62, 32, 28], 13, 0), order: 4 }
    const leaves = [leaf([20, 58, 38, 58], 0, 3), leaf([21, 59, 37, 56], 0, 1)]
    useEditorStore.getState().setNodes({ nodes: [scene, shading, face], elements: [], leaves, leafElements: [], viewBox: VIEWBOX })
    useEditorStore.getState().selectLeaf(1, false)
    let s = useEditorStore.getState()
    expect(s.selection.map((item) => item.node)).toEqual([1, 2])
    expect([...s.selectedLeaves].sort()).toEqual([0, 1])
    expect(selectionUnits(s)).toHaveLength(1)
    useEditorStore.getState().levelDown()
    s = useEditorStore.getState()
    expect(s.selection).toEqual([])
    expect(s.selectedLeaves).toEqual([1])
  })
})

describe('climbing from a small part', () => {
  it('a paw joins its gopher even when the gopher has a separate face figure (s04, s02)', () => {
    // gopher(0) > [body(1), face(2), paw(3)]
    const state = indexed([
      g([200, 100, 240, 360], 64),
      g([210, 150, 200, 300], 11, 0),
      g([230, 160, 170, 80], 25, 0),
      g([420, 300, 30, 30], 2, 0),
    ])
    expect(clickedObject(state, { group: 3 }).groups).toEqual([0])
  })
})

describe('a big container is not the same figure as what lies in its box', () => {
  it('a fence spanning the scene does not climb into the scene with the other gopher (s02)', () => {
    // scene(0) > [right gopher(1), fence with the left gopher(2) > left gopher(3)]
    const state = indexed([
      g([0, 50, 600, 300], 127),
      g([300, 60, 230, 270], 57, 0),
      g([0, 50, 600, 300], 68, 0),
      g([80, 60, 180, 250], 30, 2),
    ])
    expect(clickedObject(state, { group: 2 }).groups).toEqual([2])
  })
})
