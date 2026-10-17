/**
 * Layer order. Arrays are in paint order: index 0 is drawn first (bottom), the last item is on top.
 * Every function returns the same array when nothing moves, so callers can skip a no-op undo step.
 */

export type LayerMove = 'front' | 'forward' | 'backward' | 'back'

interface Item {
  id: string
}

/** Removes the item and inserts it at `index` of the remaining items. */
export function moveTo<T extends Item>(items: T[], id: string, index: number): T[] {
  const from = items.findIndex((item) => item.id === id)
  if (from < 0) return items
  const rest = items.filter((_, i) => i !== from)
  const to = Math.max(0, Math.min(rest.length, index))
  if (to === from) return items
  return [...rest.slice(0, to), items[from], ...rest.slice(to)]
}

export function reorder<T extends Item>(items: T[], id: string, move: LayerMove): T[] {
  const from = items.findIndex((item) => item.id === id)
  if (from < 0) return items
  const to = { front: items.length - 1, forward: from + 1, backward: from - 1, back: 0 }[move]
  return moveTo(items, id, to)
}

/** Drops `id` right above or below `targetId` as seen in the layers panel (above = in front). */
export function placeNextTo<T extends Item>(items: T[], id: string, targetId: string, side: 'above' | 'below'): T[] {
  if (id === targetId) return items
  const rest = items.filter((item) => item.id !== id)
  const target = rest.findIndex((item) => item.id === targetId)
  if (target < 0) return items
  return moveTo(items, id, side === 'above' ? target + 1 : target)
}
