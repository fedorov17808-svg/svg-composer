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
  select: (node, additive) => {
    const { nodes, selection } = get()
    if (!additive) return set({ selection: [{ node, anchor: node }] })
    // Shift+click inside an already selected group removes that group.
    const covering = (item: SelectedItem) => item.node === node || isAncestor(nodes, item.node, node)
    if (selection.some(covering)) return set({ selection: selection.filter((item) => !covering(item)) })
    const kept = selection.filter((item) => !isAncestor(nodes, node, item.node))
    set({ selection: [...kept, { node, anchor: node }] })
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
