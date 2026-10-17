import { create } from 'zustand'
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
  /** Drawable non-group elements, for marquee selection. */
  leaves: LeafNode[]
  leafElements: SVGGraphicsElement[]
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

const areaOf = (n: GroupNode) => n.width * n.height

/**
 * Walks up from the clicked group to a meaningful object: big enough and not just a layer of its
 * parent, or directly under the root.
 */
export function meaningfulGroup(nodes: GroupNode[], node: number, area = sceneArea(nodes)) {
  let n = node
  for (let p = nodes[n].parent; p >= 0; p = nodes[n].parent) {
    const small = areaOf(nodes[n]) < area * MIN_AREA_SHARE
    const layer = areaOf(nodes[p]) <= areaOf(nodes[n]) * SAME_OBJECT_AREA_RATIO
    if (!small && !layer) break
    n = p
  }
  return n
}

const EMPTY_SOURCE = {
  nodes: [],
  elements: [],
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
  setNodes: (index) => set({ ...index, hover: null, selection: [], selectedLeaves: [] }),
  setHover: (hover) => set({ hover }),
  select: (clicked, additive) => {
    const { nodes, selection } = get()
    // The clicked group stays the anchor, so "level down" refines back to it.
    const node = meaningfulGroup(nodes, clicked)
    if (!additive) return set({ selection: [{ node, anchor: clicked }], selectedLeaves: [] })
    // Shift+click inside an already selected group removes that group.
    const covering = (item: SelectedItem) => item.node === clicked || isAncestor(nodes, item.node, clicked)
    if (selection.some(covering)) return set({ selection: selection.filter((item) => !covering(item)) })
    const kept = selection.filter((item) => !isAncestor(nodes, node, item.node))
    const { leaves, selectedLeaves } = get()
    set({
      selection: [...kept, { node, anchor: clicked }],
      selectedLeaves: selectedLeaves.filter((l) => !leafInGroup(nodes, leaves, l, node)),
    })
  },
  selectLeaf: (leaf, additive) => {
    const { selectedLeaves } = get()
    if (!additive) return set({ selection: [], selectedLeaves: [leaf] })
    if (selectedLeaves.includes(leaf)) return get().deselectLeaf(leaf)
    get().setPicked([...pickedLeaves(get()), leaf])
  },
  selectRect: (rect, additive) => {
    const { nodes, leaves } = get()
    const area = sceneArea(nodes)
    const inside = pickInRect(nodes, leaves, rect, (group) => meaningfulGroup(nodes, group, area))
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
    const { nodes, leaves, selection, selectedLeaves } = get()
    const next = selection.map((item) => {
      const parent = nodes[item.node].parent
      return parent >= 0 ? { ...item, node: parent } : item
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
    const next = selection.map((item) => {
      const { children } = nodes[item.node]
      if (children.length === 0) return item
      const towardsAnchor = children.find((c) => c === item.anchor || isAncestor(nodes, c, item.anchor))
      return { ...item, node: towardsAnchor ?? children[0] }
    })
    set({ selection: normalize(nodes, next) })
  },
}))
