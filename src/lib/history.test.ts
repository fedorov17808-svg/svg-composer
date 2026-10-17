import { describe, expect, it } from 'vitest'
import { emptyHistory, HISTORY_LIMIT, MERGE_MS, mapHistory, record, redo, undo } from './history'

describe('history', () => {
  it('undoes and redoes in order', () => {
    let h = record(emptyHistory<number>(), 0, null, 0)
    h = record(h, 1, null, 10)
    let state = 2
    const back = undo(h, state)!
    expect(back.state).toBe(1)
    state = back.state
    const back2 = undo(back.history, state)!
    expect(back2.state).toBe(0)
    expect(undo(back2.history, back2.state)).toBeNull()
    const fwd = redo(back2.history, back2.state)!
    expect(fwd.state).toBe(1)
    expect(redo(fwd.history, fwd.state)!.state).toBe(2)
  })

  it('a new change clears redo', () => {
    const h = record(emptyHistory<number>(), 0, null, 0)
    const back = undo(h, 1)!
    expect(back.history.future).toEqual([1])
    expect(record(back.history, 0, null, 5).future).toEqual([])
  })

  it('merges a quick burst with the same key into one step', () => {
    let h = emptyHistory<number>()
    h = record(h, 0, 'nudge:a', 0)
    h = record(h, 1, 'nudge:a', 300)
    h = record(h, 2, 'nudge:a', 600)
    expect(h.past).toEqual([0])
    // Undo restores the state before the whole burst.
    expect(undo(h, 3)!.state).toBe(0)
  })

  it('does not merge different keys, pauses or changes across an undo', () => {
    let h = record(emptyHistory<number>(), 0, 'x:a', 0)
    h = record(h, 1, 'y:a', 100)
    expect(h.past).toEqual([0, 1])
    h = record(h, 2, 'y:a', 100 + MERGE_MS + 1)
    expect(h.past).toEqual([0, 1, 2])
    const back = undo(h, 3)!
    expect(record(back.history, 2, 'y:a', 100 + MERGE_MS + 2).past).toEqual([0, 1, 2])
  })

  it('keeps at most HISTORY_LIMIT steps', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = record(h, i, null, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]).toBe(5)
  })

  it('maps stored snapshots', () => {
    const h = undo(record(emptyHistory<number>(), 1, null, 0), 2)!.history
    expect(mapHistory(h, (n) => n * 10).future).toEqual([20])
  })
})
