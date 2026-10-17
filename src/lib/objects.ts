import type { GroupNode, LeafNode } from './svgGroups'

/** A sibling whose box lies at least this much inside another sibling's box is a part of it. */
export const PART_INSIDE_SHARE = 0.85

/**
 * A sibling drawn right next to a bigger one and lying at least this much on it is a part too: a
 * carp's head and tail stick out of its body box, but are drawn right after the body.
 */
export const PART_OVERLAP_SHARE = 0.5

/**
 * A composite part drawn behind its container is at least this many times smaller. Without it a
 * whole character drawn under a big scene group (the left gopher under the garland-and-tree group
 * in s20) would become a part of that group. Simple shapes behind (ears, the second chopstick) are
 * not limited. The same ratio tells a small detail from an object.
 */
export const BEHIND_PART_MIN_RATIO = 8

/** Parts with more elements than this are composite (a face, a character), not simple shapes. */
export const SIMPLE_PART_MAX_ELEMENTS = 2

/**
 * An object at least this share of the scene and with at least this many shapes is a figure on its
 * own: a character, a go board. A body's shading (3 shapes) is not.
 */
export const FIGURE_SCENE_SHARE = 0.1
export const FIGURE_MIN_ELEMENTS = 10

/** A part that only overlaps its container may grow the container's box at most this much (a carp's
 * head and tail do; a rope crossing a gopher does not). */
export const OVERLAP_MAX_GROWTH = 1.5

/** No object, merged or clicked, takes more than this share of the illustration. */
export const MAX_ILLUSTRATION_SHARE = 0.7

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const area = (b: Box) => b.width * b.height

/** Share of `part`'s area inside `container`. */
export function insideShare(part: Box, container: Box) {
  if (area(part) <= 0) return 0
  const w = Math.min(part.x + part.width, container.x + container.width) - Math.max(part.x, container.x)
  const h = Math.min(part.y + part.height, container.y + container.height) - Math.max(part.y, container.y)
  return w > 0 && h > 0 ? (w * h) / area(part) : 0
}

export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** Groups and loose shapes under one parent that make one thing: a gopher, a carp, a bubble. */
export interface SceneObject {
  /** Parent group of all members, or -1 at the top level. */
  parent: number
  /** Member groups and leaves, in document order. */
  groups: number[]
  leaves: number[]
  box: Box
  /** Shapes inside, at any depth. */
  elementCount: number
}

export interface ObjectIndex {
  objects: SceneObject[]
  /** Object of every group; a group that is not a part of anything is an object on its own. */
  groupObject: number[]
  /** Object of every leaf, or -1 for a loose leaf that is not a part of any object. */
  leafObject: number[]
}

export interface Areas {
  /** Area of the drawing (union of top-level groups). */
  scene: number
  /** Area of the whole illustration (viewBox). */
  illustration: number
}

interface Item extends Box {
  parent: number
  order: number
  elements: number
  group: number
  leaf: number
}

export const isFigure = (b: Box & { elementCount: number }, areas: Areas) =>
  area(b) >= areas.scene * FIGURE_SCENE_SHARE && b.elementCount >= FIGURE_MIN_ELEMENTS

/** Figures are one figure when the smaller lies inside the bigger (a face on a body, a panda in arms). */
const sameFigure = (a: Box, b: Box) =>
  area(a) <= area(b) ? insideShare(a, b) >= PART_INSIDE_SHARE : insideShare(b, a) >= PART_INSIDE_SHARE

/**
 * Logical objects among siblings — groups and loose shapes under the same parent. Gophers are drawn
 * as siblings: body, then belly, nostrils and a face group on top, ears and paws behind — no group
 * holds the whole character; in s02 even the body is a loose shape in a big scene group.
 *
 * Every item lies on its tightest container (`canHold`): the smallest bigger sibling holding at
 * least 85 % of its box, or 50 % when nothing is drawn between them that is not on the container as
 * well. Chains make objects: eyes → face → body. A part and its container must be drawn without
 * anything else on the container in between (`blocks`); otherwise the link is cut — a character in
 * front of a frame stays separate from the frame.
 *
 * Links are then joined tightest first, and a join is refused when the object would take more than
 * 70 % of the illustration or would put two separate figures together (a carp next to the fishing
 * gopher, two gophers on one bench).
 */
export function buildObjects(nodes: GroupNode[], leaves: LeafNode[], areas: Areas): ObjectIndex {
  const items: Item[] = [
    ...nodes.map((n, i) => ({ ...box(n), parent: n.parent, order: n.order ?? i, elements: n.elementCount, group: i, leaf: -1 })),
    ...leaves.map((l, i) => ({
      ...(l.visible ? box(l) : { x: 0, y: 0, width: 0, height: 0 }),
      parent: l.parent,
      order: l.order ?? nodes.length + i,
      elements: 1,
      group: -1,
      leaf: i,
    })),
  ]
  const siblings = new Map<number, number[]>()
  items.forEach((item, i) => {
    if (area(item) <= 0) return
    siblings.set(item.parent, [...(siblings.get(item.parent) ?? []), i])
  })
  for (const list of siblings.values()) list.sort((a, b) => items[a].order - items[b].order)

  // Groups holding two separate figures are scenes: they take no parts (the gong posts in s06).
  const scene = items.map((item) => item.group >= 0 && isScene(nodes, item.group, areas))
  const container = items.map(() => -1)
  for (const list of siblings.values()) {
    list.forEach((i, a) => {
      let best = -1
      list.forEach((j, b) => {
        if (!scene[j] && canHold(items, list, a, b, areas) && (best < 0 || area(items[j]) < area(items[best]))) best = j
      })
      container[i] = best
    })
  }

  const root = (i: number) => {
    while (container[i] >= 0) i = container[i]
    return i
  }
  /**
   * Something drawn between a part and its container that is not of the same object. A part on top
   * may skip things that are not on the container (HI and HELLO in s16); a part behind may not — it
   * shows only around the container's edges, and anything else in between is drawn over it (the
   * calendar cells behind the gopher in s04).
   */
  const blocks = (k: number, c: number, behind: boolean) => {
    const [item, holder] = [items[k], items[c]]
    if (root(k) === root(c) || area(item) > area(holder)) return false
    const share = insideShare(item, holder)
    if (!behind && share < 0.25) return false
    // A small detail sticking out of the container: a paw.
    if (share < PART_INSIDE_SHARE && area(item) * BEHIND_PART_MIN_RATIO <= area(holder)) return false
    return true
  }
  // Cutting a link only makes objects smaller, so repeating until nothing changes terminates.
  for (let changed = true; changed; ) {
    changed = false
    for (const list of siblings.values()) {
      for (const i of list) {
        const c = container[i]
        if (c < 0) continue
        const [a, b] = [list.indexOf(i), list.indexOf(c)]
        const [from, to] = a < b ? [a, b] : [b, a]
        if (list.slice(from + 1, to).some((k) => blocks(k, c, a < b))) {
          container[i] = -1
          changed = true
        }
      }
    }
  }

  // Join links tightest first, each join checked on the whole object it makes.
  const join = items.map((_, i) => i)
  const find = (i: number): number => (join[i] === i ? i : (join[i] = find(join[i])))
  const parts = items.map((item, i) => ({ box: box(item), elementCount: item.elements, members: [i] }))
  const links = items.flatMap((_, i) => (container[i] >= 0 ? [[i, container[i]]] : []))
  links.sort((p, q) => area(items[p[1]]) - area(items[q[1]]) || area(items[q[0]]) - area(items[p[0]]))
  for (const [i, c] of links) {
    const [a, b] = [find(i), find(c)]
    if (a === b) continue
    const merged = unionBox([parts[a].box, parts[b].box])
    if (area(merged) > areas.illustration * MAX_ILLUSTRATION_SHARE) continue
    const figures = [parts[a], parts[b]].filter((p) => isFigure({ ...p.box, elementCount: p.elementCount }, areas))
    if (figures.length === 2 && !sameFigure(parts[a].box, parts[b].box)) continue
    join[a] = b
    parts[b] = { box: merged, elementCount: parts[a].elementCount + parts[b].elementCount, members: [...parts[b].members, ...parts[a].members] }
  }

  const objects: SceneObject[] = []
  const groupObject = nodes.map(() => -1)
  const leafObject = leaves.map(() => -1)
  const members = new Map<number, number[]>()
  items.forEach((_, i) => {
    if (area(items[i]) <= 0 && items[i].leaf >= 0) return
    const r = area(items[i]) > 0 ? find(i) : i
    members.set(r, [...(members.get(r) ?? []), i])
  })
  for (const [r, list] of members) {
    // A loose leaf on its own stays a leaf; groups are always objects.
    if (list.length === 1 && items[r].leaf >= 0) continue
    list.sort((a, b) => items[a].order - items[b].order)
    const index = objects.length
    const visible = list.filter((i) => area(items[i]) > 0)
    objects.push({
      parent: items[r].parent,
      groups: list.filter((i) => items[i].group >= 0).map((i) => items[i].group),
      leaves: list.filter((i) => items[i].leaf >= 0).map((i) => items[i].leaf),
      box: visible.length ? unionBox(visible.map((i) => items[i])) : box(items[r]),
      elementCount: list.reduce((n, i) => n + items[i].elements, 0),
    })
    for (const i of list) {
      if (items[i].group >= 0) groupObject[items[i].group] = index
      else leafObject[items[i].leaf] = index
    }
  }
  return { objects, groupObject, leafObject }
}

const box = (b: Box): Box => ({ x: b.x, y: b.y, width: b.width, height: b.height })

/** Whether the group holds two separate figure-sized groups at any depth (two gophers, a board). */
function isScene(nodes: GroupNode[], group: number, areas: Areas) {
  const figures: Box[] = []
  const stack = [...nodes[group].children]
  while (stack.length) {
    const g = stack.pop()!
    stack.push(...nodes[g].children)
    if (!isFigure({ ...nodes[g], elementCount: nodes[g].elementCount }, areas)) continue
    if (!figures.some((f) => sameFigure(f, nodes[g]))) figures.push(box(nodes[g]))
    if (figures.length >= 2) return true
  }
  return false
}

/** Whether the sibling at position `a` of `list` can lie on the one at `b`. */
function canHold(items: Item[], list: number[], a: number, b: number, areas: Areas) {
  const [part, holder] = [items[list[a]], items[list[b]]]
  if (area(holder) <= area(part)) return false
  const share = insideShare(part, holder)
  if (share < PART_OVERLAP_SHARE) return false
  if (share < PART_INSIDE_SHARE) {
    if (area(unionBox([part, holder])) > area(holder) * OVERLAP_MAX_GROWTH) return false
    // Only overlapping: everything drawn between them must lie on the holder as well.
    const between = list.slice(Math.min(a, b) + 1, Math.max(a, b))
    if (!between.every((k) => insideShare(items[k], holder) >= PART_OVERLAP_SHARE)) return false
  }
  const composite = part.elements > SIMPLE_PART_MAX_ELEMENTS
  if (composite && a < b && area(holder) < area(part) * BEHIND_PART_MIN_RATIO) return false
  // A single shape (a calendar sheet, a lantern disc) takes stripes, cells and lettering, not a
  // character standing in front of it.
  if (holder.elements <= 1 && isFigure({ ...part, elementCount: part.elements }, areas)) return false
  return true
}

/** Objects nested in `groups`, at any depth. */
function nestedObjects(index: ObjectIndex, nodes: GroupNode[], groups: number[]) {
  const inside = new Set<number>()
  const stack = [...groups]
  while (stack.length) {
    const g = stack.pop()!
    for (const child of nodes[g].children) {
      inside.add(index.groupObject[child])
      stack.push(child)
    }
  }
  for (const o of index.leafObject) if (o >= 0 && isInside(nodes, index.objects[o].parent, groups)) inside.add(o)
  return [...inside].map((o) => index.objects[o])
}

const isInside = (nodes: GroupNode[], group: number, groups: number[]) => {
  for (let g = group; g >= 0; g = nodes[g].parent) if (groups.includes(g)) return true
  return false
}

/**
 * Figures inside `group` (at any depth) other than `current` and what is nested in it: another
 * gopher, a go board. Climbing from `current` into its parent group with such a figure would select
 * a scene, not the thing clicked. Only the parent group is looked into: parts merged onto it as
 * siblings (a panda held by the gopher in s13) were already judged to belong to it. Figures that
 * lie inside one another (a face on a body) count as one.
 */
export function otherFigures(index: ObjectIndex, nodes: GroupNode[], group: number, current: SceneObject, areas: Areas) {
  const own = new Set([current, ...nestedObjects(index, nodes, current.groups)])
  const figures = nestedObjects(index, nodes, [group])
    .filter((o) => !own.has(o) && isFigure({ ...o.box, elementCount: o.elementCount }, areas))
    // The clicked thing lying inside a figure is a part of it (a face on a body), not the other way
    // round: a fence spanning the scene does not make the gopher behind it a part of the fence.
    .filter((o) => insideShare(current.box, o.box) < PART_INSIDE_SHARE)
    .sort((p, q) => area(p.box) - area(q.box))
  const picked: Box[] = []
  for (const f of figures) if (!picked.some((p) => sameFigure(p, f.box))) picked.push(f.box)
  return picked.length
}
