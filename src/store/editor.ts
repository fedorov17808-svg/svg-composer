import { create } from 'zustand'
import { unionRects } from '../lib/extract'
import {
  area as areaOf,
  buildObjects,
  isFigure,
  MAX_ILLUSTRATION_SHARE,
  otherFigures,
  type Areas,
  type ObjectIndex,
  type SceneObject,
} from '../lib/objects'
import { fitsTree, markBox, markIndex, type MarkedObject, type MarkIndex } from '../lib/marks'
import { collapse, groupLeaves, leafInGroup, pickInRect, type Rect } from '../lib/selection'
import type { GroupNode, LeafNode } from '../lib/svgGroups'

export interface SelectedItem {
  node: number
  /** What was clicked: a group index, or `-(leaf + 1)` for a shape. "Level down" walks back to it. */
  anchor: number
}

/** What a click starts from: a group, or a loose shape that is a part of an object. */
export type ClickTarget = { group: number } | { leaf: number }

export interface SourceIndex {
  nodes: GroupNode[]
  /** Mounted `<g>` elements of the open source, same order as `nodes`. */
  elements: SVGGElement[]
  /** Drawable non-group elements, for marquee selection and loose parts of objects. */
  leaves: LeafNode[]
  leafElements: SVGGraphicsElement[]
  viewBox: Rect
}

/** Marked-up objects of the open source (`objects.json`) with their boxes; empty without markup. */
export interface MarkState extends MarkIndex {
  marks: MarkedObject[]
  markBoxes: Rect[]
}

/** What a click would select, under the pointer: its frame and the key of its selection unit. */
export interface Hover {
  key: string
  box: Rect
}

export interface EditorState extends SourceIndex, ObjectIndex, MarkState {
  openSourceId: string | null
  hover: Hover | null
  /** Selected groups. */
  selection: SelectedItem[]
  /** Selected leaves not covered by `selection`: parts of objects, marquee picks, loose shapes. */
  selectedLeaves: number[]
  open: (id: string) => void
  close: () => void
  /** Indexes the mounted source; `marks` is its markup, used when it fits the index. */
  setNodes: (index: SourceIndex, marks?: MarkedObject[]) => void
  setHover: (hover: Hover | null) => void
  /** Click on a group: selects its marked-up object, else the object the click means (`clickedObject`). */
  select: (group: number, additive: boolean) => void
  /** Click on a shape that is a part of an object (its object), or that belongs to no group. */
  selectLeaf: (leaf: number, additive: boolean) => void
  /** Selects leaves fully inside `rect` (viewBox units), see `pickInRect`; complete groups are taken whole. */
  selectRect: (rect: Rect, additive: boolean) => void
  /** Removes one leaf from the selection, splitting a selected group that contains it. */
  deselectLeaf: (leaf: number) => void
  clearSelection: () => void
  /** Sets the selection from picked leaves, collapsing complete groups. */
  setPicked: (picked: number[]) => void
  levelUp: () => void
  levelDown: () => void
}

/** A click picks the smallest ancestor covering at least this share of the scene's area. */
const MIN_AREA_SHARE = 0.1
/**
 * A group whose parent is at most this much bigger is a layer of the same object, not an object:
 * a gopher's body fill and outline sit in one group, eyes and paws in its siblings.
 */
const SAME_OBJECT_AREA_RATIO = 1.5

/** Area of the union of top-level groups: the drawing itself, without empty margins. */
function sceneArea(nodes: GroupNode[]) {
  const top = nodes.filter((n) => n.parent < 0 && n.width > 0 && n.height > 0)
  return top.length ? areaOf(unionRects(top)) : 0
}

export const areasOf = ({ nodes, viewBox }: Pick<SourceIndex, 'nodes' | 'viewBox'>): Areas => ({
  scene: sceneArea(nodes),
  illustration: areaOf(viewBox) || sceneArea(nodes),
})

type ObjectState = Pick<EditorState, 'nodes' | 'viewBox' | keyof ObjectIndex>

const startObject = (state: ObjectState, target: ClickTarget) =>
  'group' in target ? state.objects[state.groupObject[target.group]] : state.objects[state.leafObject[target.leaf]]

/**
 * Walks up from the clicked object to a meaningful one: a figure (a character, a big prop) that is
 * not just a layer of its parent, or the top level. Objects (`buildObjects`) are compared by their
 * whole box, so a gopher body with its face, ears and paws is compared with the parent, not the body
 * alone. The walk never enters an object bigger than 70 % of the illustration, nor a scene: from a
 * figure, a group with another figure; from a small part, a group with two figures (a gong between
 * two gophers).
 */
export function clickedObject(state: ObjectState, target: ClickTarget, areas = areasOf(state)): SceneObject {
  let object = startObject(state, target)
  for (;;) {
    const p = object.parent
    if (p < 0) return object
    const own = areaOf(object.box)
    const small = own < areas.scene * MIN_AREA_SHARE
    const layer = areaOf(state.nodes[p]) <= own * SAME_OBJECT_AREA_RATIO
    const figure = isFigure({ ...object.box, elementCount: object.elementCount }, areas)
    if (!small && !layer && figure) return object
    const parent = state.objects[state.groupObject[p]]
    if (areaOf(parent.box) > areas.illustration * MAX_ILLUSTRATION_SHARE) return object
    // A figure stays out of a group with another figure; a small part (a paw, a gong) joins the
    // figure it belongs to, but stays out of a group with two of them.
    if (otherFigures(state, state.nodes, p, object, areas) > (figure ? 0 : 1)) return object
    object = parent
  }
}

/** `clickedObject` for plain groups, without logical objects: each group is its own object. */
export function meaningfulGroup(nodes: GroupNode[], node: number) {
  const objects = nodes.map((n, i) => ({
    parent: n.parent,
    groups: [i],
    leaves: [],
    box: { x: n.x, y: n.y, width: n.width, height: n.height },
    elementCount: n.elementCount,
  }))
  const state = {
    nodes,
    viewBox: { x: 0, y: 0, width: 0, height: 0 },
    objects,
    groupObject: nodes.map((_, i) => i),
    leafObject: [],
  }
  return clickedObject(state, { group: node }).groups[0]
}

/** Marked-up object a click on `target` selects, or -1 when the target is in none. */
export const markOf = (state: Partial<MarkIndex>, target: ClickTarget) =>
  ('group' in target ? state.groupMark?.[target.group] : state.leafMark?.[target.leaf]) ?? -1

/** Markup state for an index; markup that does not fit it (a changed source) is ignored. */
export function markState(index: Pick<SourceIndex, 'nodes' | 'leaves'>, marks: MarkedObject[] = []): MarkState {
  const tree = { groupParent: index.nodes.map((n) => n.parent), leafParent: index.leaves.map((l) => l.parent) }
  const fit = fitsTree(marks, tree) ? marks : []
  return {
    marks: fit,
    markBoxes: fit.map((m) => markBox(m, index.nodes, index.leaves)),
    ...markIndex(fit, tree),
  }
}

/** What a click on `target` selects, for the hover frame. */
export function clickHover(state: EditorState, target: ClickTarget): Hover {
  const m = markOf(state, target)
  if (m >= 0) return { key: `m${m}`, box: state.markBoxes[m] }
  const o = clickedObject(state, target)
  return { key: `o${state.objects.indexOf(o)}`, box: o.box }
}

const EMPTY_SOURCE = {
  nodes: [],
  elements: [],
  leaves: [],
  leafElements: [],
  viewBox: { x: 0, y: 0, width: 0, height: 0 },
  objects: [],
  groupObject: [],
  leafObject: [],
  marks: [],
  markBoxes: [],
  groupMark: [],
  leafMark: [],
  hover: null,
  selection: [],
  selectedLeaves: [],
}

/** Everything selected now, as visible leaves. */
const pickedLeaves = ({ nodes, leaves, selection, selectedLeaves }: EditorState) => [
  ...selectedLeaves,
  ...selection.flatMap((item) => groupLeaves(nodes, leaves, item.node)),
]

/** Elements and their visible bounds to extract: selected groups and loose leaves. */
export function selectedParts({
  nodes,
  elements,
  leaves,
  leafElements,
  selection,
  selectedLeaves,
}: Pick<EditorState, 'nodes' | 'elements' | 'leaves' | 'leafElements' | 'selection' | 'selectedLeaves'>) {
  return {
    elements: [...selection.map((item) => elements[item.node] as Element), ...selectedLeaves.map((l) => leafElements[l])],
    bounds: [...selection.map((item) => nodes[item.node] as Rect), ...selectedLeaves.map((l) => leaves[l])],
  }
}

const isAncestor = (nodes: GroupNode[], ancestor: number, node: number) => {
  for (let n = nodes[node].parent; n >= 0; n = nodes[n].parent) if (n === ancestor) return true
  return false
}

const covers = (nodes: GroupNode[], node: number, target: number) => node === target || isAncestor(nodes, node, target)

/** Drops duplicates and items already covered by a selected ancestor. */
const normalize = (nodes: GroupNode[], items: SelectedItem[]) =>
  items.filter(
    (item, i) =>
      items.findIndex((other) => other.node === item.node) === i &&
      !items.some((other) => isAncestor(nodes, other.node, item.node)),
  )

/** One selected thing as the user sees it: an object (or part of one), a group, or a loose shape. */
export interface SelectionUnit {
  key: string
  /** Marked-up object index, or -1 outside the markup. */
  mark: number
  /** Object index, or -1 for a loose leaf. */
  object: number
  items: SelectedItem[]
  leaves: number[]
  box: Rect
}

/** Selected groups and leaves put together by marked-up object, else by object: one frame and one card per unit. */
export function selectionUnits(
  state: Pick<EditorState, 'nodes' | 'leaves' | 'selection' | 'selectedLeaves' | 'groupObject' | 'leafObject'> &
    Partial<MarkIndex>,
): SelectionUnit[] {
  const units = new Map<string, SelectionUnit>()
  const unit = (key: string, mark: number, object: number) => {
    if (!units.has(key)) units.set(key, { key, mark, object, items: [], leaves: [], box: { x: 0, y: 0, width: 0, height: 0 } })
    return units.get(key)!
  }
  for (const item of state.selection) {
    const m = markOf(state, { group: item.node })
    const o = state.groupObject[item.node] ?? -1
    if (m >= 0) unit(`m${m}`, m, -1).items.push(item)
    else unit(o >= 0 ? `o${o}` : `g${item.node}`, -1, o).items.push(item)
  }
  for (const l of state.selectedLeaves) {
    const m = markOf(state, { leaf: l })
    const o = state.leafObject[l] ?? -1
    if (m >= 0) unit(`m${m}`, m, -1).leaves.push(l)
    else unit(o >= 0 ? `o${o}` : `l${l}`, -1, o).leaves.push(l)
  }
  return [...units.values()].flatMap((u) => {
    const rects = [...u.items.map((item) => state.nodes[item.node]), ...u.leaves.map((l) => state.leaves[l])]
    return rects.every(Boolean) && rects.length ? [{ ...u, box: unionRects(rects) }] : []
  })
}

const memberCount = (o: { groups: number[]; leaves: number[] }) => o.groups.length + o.leaves.length

/** Whether the unit holds every member of its marked-up object or object. */
const isWhole = (state: Pick<EditorState, 'objects' | 'marks'>, u: SelectionUnit) => {
  const count = u.items.length + u.leaves.length
  if (u.mark >= 0) return count === memberCount(state.marks[u.mark])
  return u.object < 0 || count === memberCount(state.objects[u.object])
}

/** Name of the marked-up object when exactly one is selected whole, else null. */
export function wholeMarkName(state: EditorState) {
  const units = selectionUnits(state)
  return units.length === 1 && units[0].mark >= 0 && isWhole(state, units[0]) ? state.marks[units[0].mark].name : null
}

/** Whether "level down" changes anything: an object narrows to what was clicked, a group to its child. */
export const canLevelDown = (state: EditorState) =>
  selectionUnits(state).some(
    (u) => u.items.length + u.leaves.length > 1 || u.items.some((item) => state.nodes[item.node]?.children.length > 0),
  )

/** Whether "level up" changes anything: a part widens to its object, an object to its parent's. */
export const canLevelUp = (state: EditorState) =>
  selectionUnits(state).some((u) => {
    if (!isWhole(state, u)) return true
    // A whole marked-up object is the top: what is around it is other objects.
    if (u.mark >= 0) return false
    if (u.object >= 0) return state.objects[u.object].parent >= 0
    return u.leaves.some((l) => state.leaves[l]?.parent >= 0)
  })

/** Selection of a whole object, every group with the given anchor. */
const objectSelection = (o: { groups: number[]; leaves: number[] }, anchor: number) => ({
  items: o.groups.map((node) => ({ node, anchor })),
  leaves: o.leaves,
})

export const useEditorStore = create<EditorState>((set, get) => {
  /** Selects the object a click means; with Shift adds it, or removes the clicked unit if selected. */
  const pick = (target: ClickTarget, anchor: number, additive: boolean) => {
    const state = get()
    const { nodes, leaves, selection, selectedLeaves } = state
    const m = markOf(state, target)
    const picked = objectSelection(m >= 0 ? state.marks[m] : clickedObject(state, target), anchor)
    if (!additive) return set({ selection: picked.items, selectedLeaves: picked.leaves })
    const hit = selectionUnits(state).find((u) =>
      'group' in target
        ? u.items.some((item) => covers(nodes, item.node, target.group))
        : u.leaves.includes(target.leaf) || u.items.some((item) => leafInGroup(nodes, leaves, target.leaf, item.node)),
    )
    if (hit) {
      return set({
        selection: selection.filter((item) => !hit.items.includes(item)),
        selectedLeaves: selectedLeaves.filter((l) => !hit.leaves.includes(l)),
      })
    }
    const kept = selection.filter((item) => !picked.items.some((p) => isAncestor(nodes, p.node, item.node)))
    set({
      selection: normalize(nodes, [...kept, ...picked.items]),
      selectedLeaves: [
        ...selectedLeaves.filter((l) => !picked.items.some((p) => leafInGroup(nodes, leaves, l, p.node))),
        ...picked.leaves.filter((l) => !selectedLeaves.includes(l)),
      ],
    })
  }

  return {
    openSourceId: null,
    ...EMPTY_SOURCE,
    open: (id) => {
      if (get().openSourceId === id) return
      set({ openSourceId: id, ...EMPTY_SOURCE })
    },
    close: () => set({ openSourceId: null, ...EMPTY_SOURCE }),
    setNodes: (index, marks) =>
      set({
        ...index,
        ...markState(index, marks),
        ...buildObjects(index.nodes, index.leaves, areasOf(index)),
        hover: null,
        selection: [],
        selectedLeaves: [],
      }),
    setHover: (hover) => set({ hover }),
    // What was clicked stays the anchor, so "level down" refines back to it.
    select: (group, additive) => pick({ group }, group, additive),
    selectLeaf: (leaf, additive) => {
      const { leafObject, leafMark, selectedLeaves } = get()
      if (leafObject[leaf] >= 0 || leafMark[leaf] >= 0) return pick({ leaf }, -(leaf + 1), additive)
      if (!additive) return set({ selection: [], selectedLeaves: [leaf] })
      if (selectedLeaves.includes(leaf)) return get().deselectLeaf(leaf)
      get().setPicked([...pickedLeaves(get()), leaf])
    },
    selectRect: (rect, additive) => {
      const state = get()
      const areas = areasOf(state)
      // Bounds of what a click on the leaf would select.
      const inside = pickInRect(state.leaves, rect, (leaf) => {
        if (state.leafMark[leaf] >= 0) return state.markBoxes[state.leafMark[leaf]]
        if (state.leafObject[leaf] >= 0) return clickedObject(state, { leaf }, areas).box
        const parent = state.leaves[leaf].parent
        return parent < 0 ? null : clickedObject(state, { group: parent }, areas).box
      })
      get().setPicked(additive ? [...pickedLeaves(state), ...inside] : inside)
    },
    deselectLeaf: (leaf) => {
      const { nodes, leaves, selection, selectedLeaves } = get()
      if (selectedLeaves.includes(leaf)) return set({ selectedLeaves: selectedLeaves.filter((l) => l !== leaf) })
      const owner = selection.find((item) => leafInGroup(nodes, leaves, leaf, item.node))
      if (!owner) return
      // The group falls apart into the rest of its leaves; complete subgroups come back whole.
      const rest = collapse(nodes, leaves, groupLeaves(nodes, leaves, owner.node).filter((l) => l !== leaf))
      set({
        selection: [
          ...selection.filter((item) => item !== owner),
          ...rest.groups.map((node) => ({ node, anchor: node })),
        ],
        selectedLeaves: [...selectedLeaves, ...rest.leaves].sort((a, b) => a - b),
      })
    },
    setPicked: (picked) => {
      const { nodes, leaves, selection } = get()
      const { groups, leaves: rest } = collapse(nodes, leaves, picked)
      // Groups that were selected before keep their anchor for "level down".
      const items = groups.map((node) => selection.find((item) => item.node === node) ?? { node, anchor: node })
      set({ selection: items, selectedLeaves: rest })
    },
    clearSelection: () => set({ selection: [], selectedLeaves: [] }),
    levelUp: () => {
      const state = get()
      const { nodes, leaves, objects, groupObject, marks } = state
      const next: SelectedItem[] = []
      const nextLeaves: number[] = []
      for (const u of selectionUnits(state)) {
        const anchor = u.items[0]?.anchor ?? -(u.leaves[0] + 1)
        // A part widens to its whole object first, a whole object to its parent's object; a loose
        // leaf goes up to its group, leaves right under the root stay.
        let target: { groups: number[]; leaves: number[] } | null = null
        if (u.mark >= 0) target = marks[u.mark]
        else if (!isWhole(state, u)) target = objects[u.object]
        else if (u.object >= 0 && objects[u.object].parent >= 0) target = objects[groupObject[objects[u.object].parent]]
        else if (u.object < 0 && leaves[u.leaves[0]]?.parent >= 0) target = objects[groupObject[leaves[u.leaves[0]].parent]]
        const picked = target ? objectSelection(target, anchor) : { items: u.items, leaves: u.leaves }
        next.push(...picked.items)
        nextLeaves.push(...picked.leaves)
      }
      const groups = normalize(nodes, next)
      set({
        selection: groups,
        selectedLeaves: [...new Set(nextLeaves)].filter(
          (l) => !groups.some((item) => leafInGroup(nodes, leaves, l, item.node)),
        ),
      })
    },
    levelDown: () => {
      const state = get()
      const { nodes, leaves } = state
      const next: SelectedItem[] = []
      const nextLeaves: number[] = []
      for (const u of selectionUnits(state)) {
        const anchor = u.items[0]?.anchor
        if (u.items.length + u.leaves.length > 1) {
          // An object narrows to what was clicked: the shape, or the member group holding it.
          const leaf = anchor !== undefined && anchor < 0 ? -anchor - 1 : -1
          const group = u.items.find((item) =>
            item.anchor >= 0 ? covers(nodes, item.node, item.anchor) : leafInGroup(nodes, leaves, leaf, item.node),
          )
          if (u.leaves.includes(leaf)) nextLeaves.push(leaf)
          else if (group) next.push(group)
          else if (u.items.length) next.push(u.items[0])
          else nextLeaves.push(u.leaves[0])
          continue
        }
        nextLeaves.push(...u.leaves)
        for (const item of u.items) {
          const { children } = nodes[item.node]
          if (children.length === 0) next.push(item)
          else next.push({ ...item, node: children.find((c) => covers(nodes, c, item.anchor)) ?? children[0] })
        }
      }
      set({ selection: normalize(nodes, next), selectedLeaves: nextLeaves })
    },
  }
})
