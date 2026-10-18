import type { Box } from './objects'

/**
 * A marked-up object of a source (`public/sources/objects.json`): a character or a prop as a person
 * sees it, with every group and loose shape it is drawn with. Groups and leaves are indices in the
 * source index (`collectGroups`, document order); a member group brings all of its content.
 */
export interface MarkedObject {
  name: string
  groups: number[]
  leaves: number[]
}

/** `objects.json`: marked-up objects of every source, by source id. */
export type MarkedObjects = Record<string, MarkedObject[]>

/**
 * Hand corrections of the generated markup (`scripts/object-overrides.json`), applied in order.
 * `object` is an index in the generated list; objects made by `split` get the next indices.
 * A node belongs to one object only: adding it elsewhere takes it from its old object, and a node
 * inside a member group is taken by splitting that group into its children. `rest` adds everything
 * that no object holds (the biggest free groups whole) to an object, or makes a new one of it.
 * `set` replaces the list with explicit objects: for a source where the generated list shifts
 * whenever bounds change, indices are not stable enough to patch.
 */
export type ObjectOverride =
  | { op: 'name'; object: number; name: string }
  | { op: 'merge'; objects: number[]; name?: string }
  | { op: 'add'; object: number; groups?: number[]; leaves?: number[] }
  | { op: 'remove'; object: number; groups?: number[]; leaves?: number[] }
  | { op: 'split'; object: number; name: string; groups?: number[]; leaves?: number[] }
  | { op: 'drop'; object: number }
  | { op: 'rest'; object: number }
  | { op: 'rest'; name: string }
  | { op: 'set'; objects: MarkedObject[] }

/** Parents of the source's groups and leaves (-1 under the scene root). */
export interface Tree {
  groupParent: number[]
  leafParent: number[]
}

type Ref = { group: number } | { leaf: number }

const parentOf = (tree: Tree, ref: Ref) => ('group' in ref ? tree.groupParent[ref.group] : tree.leafParent[ref.leaf])

const has = (o: MarkedObject, ref: Ref) => ('group' in ref ? o.groups.includes(ref.group) : o.leaves.includes(ref.leaf))

/** Replaces member `group` with its child groups and leaves. */
function expand(tree: Tree, o: MarkedObject, group: number) {
  o.groups = o.groups.filter((g) => g !== group)
  tree.groupParent.forEach((p, g) => p === group && o.groups.push(g))
  tree.leafParent.forEach((p, l) => p === group && o.leaves.push(l))
}

/** Takes `ref` out of `o`, splitting the member group that holds it. */
function take(tree: Tree, o: MarkedObject, ref: Ref) {
  const chain: number[] = []
  for (let g = parentOf(tree, ref); g >= 0; g = tree.groupParent[g]) chain.unshift(g)
  const top = chain.findIndex((g) => o.groups.includes(g))
  if (top >= 0) for (const g of chain.slice(top)) expand(tree, o, g)
  if ('group' in ref) o.groups = o.groups.filter((g) => g !== ref.group)
  else o.leaves = o.leaves.filter((l) => l !== ref.leaf)
}

const refsOf = (op: { groups?: number[]; leaves?: number[] }): Ref[] => [
  ...(op.groups ?? []).map((group) => ({ group })),
  ...(op.leaves ?? []).map((leaf) => ({ leaf })),
]

const sorted = (o: MarkedObject): MarkedObject => ({
  name: o.name,
  groups: [...new Set(o.groups)].sort((a, b) => a - b),
  leaves: [...new Set(o.leaves)].sort((a, b) => a - b),
})

/** Nodes that no object holds: free groups whose parent is not free, and free leaves outside them. */
function freeRefs(list: (MarkedObject | null)[], tree: Tree): Ref[] {
  const marks = list.filter((o): o is MarkedObject => !!o)
  const { groupMark, leafMark } = markIndex(marks, tree)
  // A group is free when nothing in it or above it is marked.
  const busy = groupMark.map((m) => m >= 0)
  const mark = (g: number) => {
    for (let p = g; p >= 0 && !busy[p]; p = tree.groupParent[p]) busy[p] = true
  }
  tree.leafParent.forEach((p, l) => leafMark[l] >= 0 && p >= 0 && mark(p))
  marks.forEach((m) => m.groups.forEach((g) => mark(tree.groupParent[g])))
  const free = (g: number) => g >= 0 && !busy[g]
  return [
    ...tree.groupParent.flatMap((p, group) => (free(group) && !free(p) ? [{ group }] : [])),
    ...tree.leafParent.flatMap((p, leaf) => (leafMark[leaf] < 0 && !free(p) ? [{ leaf }] : [])),
  ]
}

/** Applies `overrides` to the generated objects; empty and dropped objects are left out. */
export function applyOverrides(generated: MarkedObject[], tree: Tree, overrides: ObjectOverride[]): MarkedObject[] {
  const list: (MarkedObject | null)[] = generated.map((o) => ({ name: o.name, groups: [...o.groups], leaves: [...o.leaves] }))
  const get = (i: number) => {
    const o = list[i]
    if (!o) throw new Error(`object ${i} does not exist`)
    return o
  }
  /** Moves `refs` into `target` (or nowhere), taking them from every object that holds them. */
  const move = (refs: Ref[], target: MarkedObject | null) => {
    for (const ref of refs) {
      for (const o of list) if (o && o !== target) take(tree, o, ref)
      if (target && !has(target, ref)) {
        take(tree, target, ref)
        if ('group' in ref) target.groups.push(ref.group)
        else target.leaves.push(ref.leaf)
      }
    }
  }
  for (const op of overrides) {
    if (op.op === 'name') get(op.object).name = op.name
    else if (op.op === 'drop') list[op.object] = null
    else if (op.op === 'set') list.splice(0, list.length, ...op.objects.map((o) => ({ ...o, groups: [...o.groups], leaves: [...o.leaves] })))
    else if (op.op === 'rest') {
      const o = 'object' in op ? get(op.object) : { name: op.name, groups: [], leaves: [] }
      if (!('object' in op)) list.push(o)
      move(freeRefs(list, tree), o)
    }
    else if (op.op === 'add') move(refsOf(op), get(op.object))
    else if (op.op === 'remove') {
      const o = get(op.object)
      for (const ref of refsOf(op)) take(tree, o, ref)
    } else if (op.op === 'split') {
      get(op.object)
      const o = { name: op.name, groups: [], leaves: [] }
      list.push(o)
      move(refsOf(op), o)
    } else {
      const [first, ...rest] = op.objects.map(get)
      for (const o of rest) {
        first.groups.push(...o.groups)
        first.leaves.push(...o.leaves)
        list[list.indexOf(o)] = null
      }
      if (op.name) first.name = op.name
    }
  }
  return list.filter((o): o is MarkedObject => !!o && o.groups.length + o.leaves.length > 0).map(sorted)
}

/** Object of every group and leaf, -1 if none: a member's content belongs to it; the innermost member wins. */
export interface MarkIndex {
  groupMark: number[]
  leafMark: number[]
}

/** Builds `MarkIndex`. Groups come in document order, so a parent is always seen before its children. */
export function markIndex(marks: MarkedObject[], tree: Tree): MarkIndex {
  const groupMark = tree.groupParent.map(() => -1)
  const leafMark = tree.leafParent.map(() => -1)
  const direct = new Map<number, number>()
  marks.forEach((m, i) => m.groups.forEach((g) => direct.set(g, i)))
  tree.groupParent.forEach((p, g) => (groupMark[g] = direct.get(g) ?? (p >= 0 ? groupMark[p] : -1)))
  tree.leafParent.forEach((p, l) => (leafMark[l] = p >= 0 ? groupMark[p] : -1))
  marks.forEach((m, i) => m.leaves.forEach((l) => (leafMark[l] = i)))
  return { groupMark, leafMark }
}

/** Whether the markup fits the index: every member exists. Stale markup is ignored, not trusted. */
export const fitsTree = (marks: MarkedObject[], tree: Tree) =>
  marks.every(
    (m) =>
      m.groups.every((g) => g >= 0 && g < tree.groupParent.length) &&
      m.leaves.every((l) => l >= 0 && l < tree.leafParent.length),
  )

/** Bounds of a marked object: the union of its members' boxes; empty members (hidden shapes) are skipped. */
export function markBox(m: MarkedObject, groups: Box[], leaves: Box[]): Box {
  const boxes = [...m.groups.map((g) => groups[g]), ...m.leaves.map((l) => leaves[l])].filter(
    (b) => b && (b.width > 0 || b.height > 0),
  )
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  }
}
