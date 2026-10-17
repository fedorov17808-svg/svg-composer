/** Undo/redo stacks of whole-state snapshots. Snapshots are immutable, so keeping them is cheap. */
export interface History<T> {
  past: T[]
  future: T[]
  /** Key and time of the last recorded change, for merging a burst of related changes. */
  lastKey: string | null
  lastAt: number
}

export const HISTORY_LIMIT = 200
/** Changes with the same key closer than this in time make one undo step (arrow nudges, typing). */
export const MERGE_MS = 1000

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], lastKey: null, lastAt: 0 })

/** Records `before` — the state just before a change — as one undo step. Clears redo. */
export function record<T>(history: History<T>, before: T, key: string | null = null, now = Date.now()): History<T> {
  if (key !== null && key === history.lastKey && now - history.lastAt < MERGE_MS) {
    // The step that started the burst already holds the state before it.
    return { ...history, future: [], lastAt: now }
  }
  return { past: [...history.past, before].slice(-HISTORY_LIMIT), future: [], lastKey: key, lastAt: now }
}

/** Steps back: returns the restored state and the new history, or null when there is nothing to undo. */
export function undo<T>(history: History<T>, current: T): { state: T; history: History<T> } | null {
  if (history.past.length === 0) return null
  return {
    state: history.past[history.past.length - 1],
    history: { past: history.past.slice(0, -1), future: [current, ...history.future], lastKey: null, lastAt: 0 },
  }
}

export function redo<T>(history: History<T>, current: T): { state: T; history: History<T> } | null {
  if (history.future.length === 0) return null
  return {
    state: history.future[0],
    history: { past: [...history.past, current], future: history.future.slice(1), lastKey: null, lastAt: 0 },
  }
}

/** Applies `fn` to every stored snapshot, e.g. to forget objects whose component was deleted. */
export const mapHistory = <T>(history: History<T>, fn: (state: T) => T): History<T> => ({
  ...history,
  past: history.past.map(fn),
  future: history.future.map(fn),
})
