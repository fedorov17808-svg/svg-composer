import type { GroupNode } from './svgGroups'

/** A sibling whose box lies at least this much inside another sibling's box is a part of it. */
export const PART_INSIDE_SHARE = 0.85

/**
 * A composite part drawn behind its container is at least this many times smaller. Without it a
 * whole character drawn under a big scene group (the left gopher under the garland-and-tree group
 * in s20) would become a part of that group. Simple shapes behind (ears, the second chopstick) are
 * not limited.
 */
export const BEHIND_PART_MIN_RATIO = 8

/**
 * A single shape (a calendar sheet, a lantern disc, a fishing rod whose box is huge) takes only
 * simple parts — stripes, highlights — not composite groups: a gopher standing in front of the
 * calendar is its own object, while a gopher's face goes onto the body group (fill, shading, outline).
 */
export const SIMPLE_PART_MAX_ELEMENTS = 2

type Box = Pick<GroupNode, 'x' | 'y' | 'width' | 'height'>

const area = (b: Box) => b.width * b.height

/** Share of `part`'s area inside `container`. */
export function insideShare(part: Box, container: Box) {
  if (area(part) <= 0) return 0
  const w = Math.min(part.x + part.width, container.x + container.width) - Math.max(part.x, container.x)
  const h = Math.min(part.y + part.height, container.y + container.height) - Math.max(part.y, container.y)
  return w > 0 && h > 0 ? (w * h) / area(part) : 0
}

/** Whether `part` (sibling index `i`) can lie on `container` (sibling index `j`). */
function canHold(part: GroupNode, i: number, container: GroupNode, j: number) {
  if (area(container) <= area(part)) return false
  if (insideShare(part, container) < PART_INSIDE_SHARE) return false
  const composite = part.elementCount > SIMPLE_PART_MAX_ELEMENTS
  if (composite && i < j && area(container) < area(part) * BEHIND_PART_MIN_RATIO) return false
  if (composite && container.elementCount <= 1) return false
  return true
}

/**
 * Logical objects among sibling groups. Gophers are drawn as siblings: body, then belly, nostrils
 * and a face group on top, ears and paws behind — no group holds the whole character.
 *
 * Every group lies on its tightest container: the smallest sibling holding at least 85 % of its box
 * (see `canHold` for the limits). Containment chains make objects: eyes → face → body. A part and
 * its container must be drawn next to each other: anything drawn between them is another part of
 * the same object, a small detail lying mostly on the container (a paw sticking out of the body),
 * or something bigger passing over it (a fishing rod across a gopher). Otherwise the link is cut —
 * a character in front of a frame stays separate from the frame.
 *
 * Returns, for every group, the index of its object's main group (the root of its chain); groups
 * that are not a part of anything are their own object.
 */
export function buildObjects(nodes: GroupNode[]): number[] {
  const container = nodes.map(() => -1)
  const siblings = new Map<number, number[]>()
  nodes.forEach((n, i) => {
    const list = siblings.get(n.parent) ?? []
    list.push(i)
    siblings.set(n.parent, list)
  })

  for (const list of siblings.values()) {
    list.forEach((i, a) => {
      let best = -1
      list.forEach((j, b) => {
        if (canHold(nodes[i], a, nodes[j], b) && (best < 0 || area(nodes[j]) < area(nodes[best]))) best = j
      })
      container[i] = best
    })
  }

  const root = (i: number) => {
    while (container[i] >= 0) i = container[i]
    return i
  }
  // Cutting a link only makes objects smaller, so repeating until nothing changes terminates.
  for (let changed = true; changed; ) {
    changed = false
    for (const list of siblings.values()) {
      for (const i of list) {
        const c = container[i]
        if (c < 0) continue
        const [from, to] = [list.indexOf(i), list.indexOf(c)].sort((x, y) => x - y)
        const between = list.slice(from + 1, to)
        const allowed = (k: number) =>
          area(nodes[k]) <= 0 ||
          root(k) === root(c) ||
          area(nodes[k]) > area(nodes[c]) ||
          (area(nodes[k]) * BEHIND_PART_MIN_RATIO <= area(nodes[c]) && insideShare(nodes[k], nodes[c]) >= 0.5)
        const blocked = !between.every(allowed)
        if (blocked) {
          container[i] = -1
          changed = true
        }
      }
    }
  }
  return nodes.map((_, i) => root(i))
}

/** All groups of the object `node` belongs to, in document order. */
export const objectMembers = (owner: number[], node: number) =>
  owner.flatMap((o, i) => (o === owner[node] ? [i] : []))
