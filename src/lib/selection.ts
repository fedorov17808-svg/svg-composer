import type { GroupNode, LeafNode } from './svgGroups'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const EPS = 1e-6

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.width <= outer.x + outer.width + EPS &&
  inner.y + inner.height <= outer.y + outer.height + EPS

/** Visible leaves lying entirely inside the rect (both in source viewBox units). */
export function leavesInRect(leaves: LeafNode[], r: Rect): number[] {
  const out: number[] = []
  leaves.forEach((l, i) => {
    if (l.visible && contains(r, l)) out.push(i)
  })
  return out
}

const area = (r: Rect) => r.width * r.height

/**
 * Leaves a marquee picks. A leaf counts when it is entirely inside the rect and the marquee does not
 * cut a smaller object apart: the object (bounds of what a click on the leaf selects, `objectOf`; null for a loose leaf) is entirely
 * inside the rect too, or it is bigger than the rect — then the marquee picks details within it. So a
 * rect around a calendar skips the eyes of a gopher standing in front of it, while a rect around a
 * gopher made of loose details in a big scene group picks those details.
 */
export function pickInRect(leaves: LeafNode[], rect: Rect, objectOf: (leaf: number) => Rect | null) {
  return leavesInRect(leaves, rect).filter((l) => {
    const object = objectOf(l)
    if (!object) return true
    return contains(rect, object) || area(object) > area(rect)
  })
}

/** Whether `group` is `leaf`'s parent group or one of its ancestors. */
export function leafInGroup(nodes: GroupNode[], leaves: LeafNode[], leaf: number, group: number) {
  for (let p = leaves[leaf].parent; p >= 0; p = nodes[p].parent) if (p === group) return true
  return false
}

/** Visible leaves of a group, at any depth. */
export const groupLeaves = (nodes: GroupNode[], leaves: LeafNode[], group: number) =>
  leaves.flatMap((l, i) => (l.visible && leafInGroup(nodes, leaves, i, group) ? [i] : []))

/**
 * Replaces leaves by their group wherever every visible leaf of that group is picked, taking the
 * biggest such group. Leaves outside complete groups stay as they are. Fewer, larger pieces keep
 * the extracted markup close to the source structure.
 */
export function collapse(nodes: GroupNode[], leaves: LeafNode[], picked: Iterable<number>) {
  const set = new Set(picked)
  const total = new Array<number>(nodes.length).fill(0)
  const hit = new Array<number>(nodes.length).fill(0)
  leaves.forEach((l, i) => {
    if (!l.visible) return
    for (let p = l.parent; p >= 0; p = nodes[p].parent) {
      total[p]++
      if (set.has(i)) hit[p]++
    }
  })
  const full = (g: number) => total[g] > 0 && hit[g] === total[g]
  // A full group inside a full parent is covered by the parent; one level up is enough to check.
  const groups = nodes.flatMap((n, g) => (full(g) && !(n.parent >= 0 && full(n.parent)) ? [g] : []))
  const rest = [...set].filter((i) => {
    for (let p = leaves[i].parent; p >= 0; p = nodes[p].parent) if (full(p)) return false
    return true
  })
  return { groups, leaves: rest.sort((a, b) => a - b) }
}
