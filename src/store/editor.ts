import { create } from 'zustand'
import { unionRects } from '../lib/extract'
import { buildObjects, objectMembers } from '../lib/objects'
import { collapse, groupLeaves, leafInGroup, pickInRect, type Rect } from '../lib/selection'
import type { GroupNode, LeafNode } from '../lib/svgGroups'

export interface SelectedItem {
  node: number
  /** Group originally clicked; "level down" walks back towards it. */
  anchor: number
}

export interface EditorState {
  openSourceId: string | null
  nodes: GroupNode[]
  /** Mounted `<g>` elements of the open source, same order as `nodes`. */
  elements: SVGGElement[]
  /** Main group of each group's logical object (see `buildObjects`), same order as `nodes`. */
  owners: number[]
  /** Drawable non-group elements, for marquee selection. */
  leaves: LeafNode[]
  leafElements: SVGGraphicsElement[]
  /** Main group of the object a click would select. */
  hover: number | null
  selection: SelectedItem[]
  /** Leaves picked one by one (marquee, click on an ungrouped shape), not covered by `selection`. */
  selectedLeaves: number[]
  open: (id: string) => void
  close: () => void
  setNodes: (index: { nodes: GroupNode[]; elements: SVGGElement[]; leaves: LeafNode[]; leafElements: SVGGraphicsElement[] }) => void
  setHover: (node: number | null) => void
  select: (node: number, additive: boolean) => void
  /** Click on a shape that belongs to no group. */
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
  if (top.length === 0) return 0
  const x = Math.min(...top.map((n) => n.x))
  const y = Math.min(...top.map((n) => n.y))
  const right = Math.max(...top.map((n) => n.x + n.width))
  const bottom = Math.max(...top.map((n) => n.y + n.height))
  return (right - x) * (bottom - y)
}

const areaOf = (n: Rect) => n.width * n.height

/**
 * Walks up from the clicked group to a meaningful object: big enough and not just a layer of its
 * parent, or directly under the root. Works on logical objects (`owners`, see `buildObjects`): the
 * size of a group is the size of its whole object, so a gopher body with its face, ears and paws is
 * compared with the parent, not the body alone. Returns the object's groups in document order.
 */
export function clickedObject(nodes: GroupNode[], owners: number[], clicked: number, area = sceneArea(nodes)) {
  let n = clicked
  for (;;) {
    const members = objectMembers(owners, n)
    const p = nodes[n].parent
    if (p < 0) return members
    const own = areaOf(unionRects(members.map((m) => nodes[m])))
    const small = own < area * MIN_AREA_SHARE
    const layer = areaOf(nodes[p]) <= own * SAME_OBJECT_AREA_RATIO
    if (!small && !layer) return members
    n = p
  }
}

/** `clickedObject` for plain groups, without logical objects. */
export const meaningfulGroup = (nodes: GroupNode[], node: number, area = sceneArea(nodes)) =>
  clickedObject(nodes, nodes.map((_, i) => i), node, area)[0]

const EMPTY_SOURCE = {
  nodes: [],
  elements: [],
  owners: [],
  leaves: [],
  leafElements: [],
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

/** Items picked by one click (or level step), grouped by their anchor. */
export function byAnchor(items: SelectedItem[]) {
  const groups = new Map<number, SelectedItem[]>()
  for (const item of items) groups.set(item.anchor, [...(groups.get(item.anchor) ?? []), item])
  return [...groups.values()]
}

const covers = (nodes: GroupNode[], node: number, target: number) => node === target || isAncestor(nodes, node, target)

/** Whether "level down" changes anything: an object narrows to one group, a group to its child. */
export const canLevelDown = ({ nodes, selection }: Pick<EditorState, 'nodes' | 'selection'>) =>
  byAnchor(selection).some((items) => items.length > 1 || nodes[items[0].node]?.children.length > 0)

/** Whether "level up" changes anything: a group widens to its object or its parent. */
export const canLevelUp = ({ nodes, owners, leaves, selection, selectedLeaves }: EditorState) =>
  selection.some((item) => nodes[item.node]?.parent >= 0 || objectMembers(owners, item.node).length > 1) ||
  selectedLeaves.some((l) => leaves[l]?.parent >= 0)

/** Drops duplicates and items already covered by a selected ancestor. */
const normalize = (nodes: GroupNode[], items: SelectedItem[]) =>
  items.filter(
    (item, i) =>
      items.findIndex((other) => other.node === item.node) === i &&
      !items.some((other) => isAncestor(nodes, other.node, item.node)),
  )

export const useEditorStore = create<EditorState>((set, get) => ({
  openSourceId: null,
  ...EMPTY_SOURCE,
  open: (id) => {
    if (get().openSourceId === id) return
    set({ openSourceId: id, ...EMPTY_SOURCE })
  },
  close: () => set({ openSourceId: null, ...EMPTY_SOURCE }),
  setNodes: (index) => set({ ...index, owners: buildObjects(index.nodes), hover: null, selection: [], selectedLeaves: [] }),
  setHover: (hover) => set({ hover }),
  select: (clicked, additive) => {
    const { nodes, owners, selection } = get()
    // The clicked group stays the anchor, so "level down" refines back to it.
    const picked = clickedObject(nodes, owners, clicked).map((node) => ({ node, anchor: clicked }))
    if (!additive) return set({ selection: picked, selectedLeaves: [] })
    // Shift+click inside an already selected group removes everything that click selected.
    const hit = selection.filter((item) => covers(nodes, item.node, clicked)).map((item) => item.anchor)
    if (hit.length) return set({ selection: selection.filter((item) => !hit.includes(item.anchor)) })
    const kept = selection.filter((item) => !picked.some((p) => isAncestor(nodes, p.node, item.node)))
    const { leaves, selectedLeaves } = get()
    set({
      selection: normalize(nodes, [...kept, ...picked]),
      selectedLeaves: selectedLeaves.filter((l) => !picked.some((p) => leafInGroup(nodes, leaves, l, p.node))),
    })
  },
  selectLeaf: (leaf, additive) => {
    const { selectedLeaves } = get()
    if (!additive) return set({ selection: [], selectedLeaves: [leaf] })
    if (selectedLeaves.includes(leaf)) return get().deselectLeaf(leaf)
    get().setPicked([...pickedLeaves(get()), leaf])
  },
  selectRect: (rect, additive) => {
    const { nodes, owners, leaves } = get()
    const area = sceneArea(nodes)
    const inside = pickInRect(leaves, rect, (group) =>
      unionRects(clickedObject(nodes, owners, group, area).map((n) => nodes[n])),
    )
    get().setPicked(additive ? [...pickedLeaves(get()), ...inside] : inside)
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
    const { nodes, owners, leaves, selection, selectedLeaves } = get()
    // A part of an object widens to the whole object first, a whole object to its parent's object.
    const next = byAnchor(selection).flatMap((items) => {
      const { anchor } = items[0]
      const object = objectMembers(owners, items[0].node)
      const whole = object.every((n) => items.some((item) => item.node === n))
      if (!whole) return object.map((node) => ({ node, anchor }))
      const parents = [...new Set(items.map((item) => nodes[item.node].parent))]
      if (parents.some((p) => p < 0)) return items
      return parents.flatMap((p) => objectMembers(owners, p)).map((node) => ({ node, anchor }))
    })
    // A loose leaf goes up to its group; leaves right under the root stay.
    for (const l of selectedLeaves) {
      const parent = leaves[l].parent
      if (parent >= 0) next.push({ node: parent, anchor: parent })
    }
    const groups = normalize(nodes, next)
    set({
      selection: groups,
      selectedLeaves: selectedLeaves.filter(
        (l) => leaves[l].parent < 0 && !groups.some((item) => leafInGroup(nodes, leaves, l, item.node)),
      ),
    })
  },
  levelDown: () => {
    const { nodes, selection } = get()
    const next = byAnchor(selection).flatMap((items) => {
      // An object narrows to the group that was clicked, then to its children towards the click.
      if (items.length > 1) return [items.find((item) => covers(nodes, item.node, item.anchor)) ?? items[0]]
      const [item] = items
      const { children } = nodes[item.node]
      if (children.length === 0) return items
      const towardsAnchor = children.find((c) => covers(nodes, c, item.anchor))
      return [{ ...item, node: towardsAnchor ?? children[0] }]
    })
    set({ selection: normalize(nodes, next) })
  },
}))
