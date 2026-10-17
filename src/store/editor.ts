import { create } from 'zustand'
import type { GroupNode } from '../lib/svgGroups'

export interface SelectedItem {
  node: number
  /** Group originally clicked; "level down" walks back towards it. */
  anchor: number
}

interface EditorState {
  openSourceId: string | null
  nodes: GroupNode[]
  /** Mounted `<g>` elements of the open source, same order as `nodes`. */
  elements: SVGGElement[]
  hover: number | null
  selection: SelectedItem[]
  open: (id: string) => void
  close: () => void
  setNodes: (nodes: GroupNode[], elements: SVGGElement[]) => void
  setHover: (node: number | null) => void
  select: (node: number, additive: boolean) => void
  clearSelection: () => void
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
  nodes: [],
  elements: [],
  hover: null,
  selection: [],
  open: (id) => {
    if (get().openSourceId === id) return
    set({ openSourceId: id, nodes: [], elements: [], hover: null, selection: [] })
  },
  close: () => set({ openSourceId: null, nodes: [], elements: [], hover: null, selection: [] }),
  setNodes: (nodes, elements) => set({ nodes, elements, hover: null, selection: [] }),
  setHover: (hover) => set({ hover }),
  select: (clicked, additive) => {
    const { nodes, selection } = get()
    // The clicked group stays the anchor, so "level down" refines back to it.
    const node = meaningfulGroup(nodes, clicked)
    if (!additive) return set({ selection: [{ node, anchor: clicked }] })
    // Shift+click inside an already selected group removes that group.
    const covering = (item: SelectedItem) => item.node === clicked || isAncestor(nodes, item.node, clicked)
    if (selection.some(covering)) return set({ selection: selection.filter((item) => !covering(item)) })
    const kept = selection.filter((item) => !isAncestor(nodes, node, item.node))
    set({ selection: [...kept, { node, anchor: clicked }] })
  },
  clearSelection: () => set({ selection: [] }),
  levelUp: () => {
    const { nodes, selection } = get()
    const next = selection.map((item) => {
      const parent = nodes[item.node].parent
      return parent >= 0 ? { ...item, node: parent } : item
    })
    set({ selection: normalize(nodes, next) })
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
