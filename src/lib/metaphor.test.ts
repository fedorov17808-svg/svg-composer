import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from '../../public/library/manifest.json'
import { composeObjects } from './compose'
import { FORMATS } from './formats'
import { MAX_PICK, parseAiPick, pickLocal, pickObjects, stem } from './metaphor'
import type { LibraryObject } from '../store/objectLibrary'

const library = manifest as LibraryObject[]
const ids = library.map((o) => o.id)

/** 15 metaphors and what must be among the objects (the first one — in first place). */
const CASES: [string, string[]][] = [
  ['Финансовая грамотность', ['coin', 'book']],
  ['Учёба без стресса', ['book', 'headphones']],
  ['Удалённая работа', ['phone', 'headphones']],
  ['Идея', ['lamp']],
  ['Командная работа', ['puzzle']],
  ['Подарок маме на 8 марта', ['flowers']],
  ['Как сэкономить семейный бюджет', ['wallet', 'coin']],
  ['Подкаст о музыке', ['headphones']],
  ['Подписание договора', ['pen', 'folder']],
  ['Онлайн-покупки с кешбэком', ['wallet', 'phone']],
  ['Порядок в документах', ['folder']],
  ['Весеннее настроение', ['flowers']],
  ['Ночная подготовка к экзамену', ['book', 'lamp']],
  ['Стратегия развития бизнеса', ['puzzle', 'folder']],
  ['Безопасные платежи', ['coin']],
]

describe('local pick', () => {
  it('stems Russian words', () => {
    expect(['финансовая', 'финансы', 'учёбы', 'грамотности', 'договора'].map(stem)).toEqual(['финансов', 'финанс', 'учеб', 'грамотн', 'договор'])
  })

  it.each(CASES)('«%s» → 2–4 objects with a reason each', (text, expected) => {
    const pick = pickLocal(text, library)
    expect(pick.objectIds[0]).toBe(expected[0])
    for (const id of expected) expect(pick.objectIds).toContain(id)
    expect(pick.objectIds.length).toBeGreaterThanOrEqual(2)
    expect(pick.objectIds.length).toBeLessThanOrEqual(MAX_PICK)
    expect(new Set(pick.objectIds).size).toBe(pick.objectIds.length)
    expect(pick.reasons.map((r) => r.objectId)).toEqual(pick.objectIds)
    expect(pick.reasons.every((r) => r.text.length > 0)).toBe(true)
    // The composition works in every format: main objects whole inside the canvas.
    for (const format of FORMATS) {
      const objects = composeObjects({ objectIds: pick.objectIds, background: 'few', seed: 1 }, library, format.size, 'L')
      expect(objects.filter((o) => o.componentId.includes('-main-')).length).toBe(Math.min(3, pick.objectIds.length))
      for (const o of objects.filter((o) => o.componentId.includes('-main-'))) {
        const v = library.find((l) => o.componentId.endsWith(`-${l.id}`))!.versions.L.main
        expect(o.x).toBeGreaterThanOrEqual(0)
        expect(o.y).toBeGreaterThanOrEqual(0)
        expect(o.x + v.width * o.scale).toBeLessThanOrEqual(format.size.width + 1e-6)
        expect(o.y + v.height * o.scale).toBeLessThanOrEqual(format.size.height + 1e-6)
      }
    }
  })

  it('explains by the word of the object itself', () => {
    const { reasons } = pickLocal('Финансовая грамотность', library)
    expect(reasons.find((r) => r.objectId === 'coin')!.text).toBe('финансы')
    expect(reasons.find((r) => r.objectId === 'book')!.text).toBe('грамотность')
  })

  it('finds nothing in words that mean nothing to the library', () => {
    expect(pickLocal('Квантовая физика', library).objectIds).toEqual([])
    expect(pickLocal('', library).objectIds).toEqual([])
  })
})

describe('Claude pick', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts only library ids, no repeats, 1–4 with reasons', () => {
    expect(parseAiPick({ objects: [{ id: 'coin', reason: ' финансы ' }] }, ids)).toEqual({ objectIds: ['coin'], reasons: [{ objectId: 'coin', text: 'финансы' }], source: 'ai' })
    for (const bad of [
      null,
      { objects: [] },
      { objects: [{ id: 'cat', reason: 'x' }] },
      { objects: [{ id: 'coin', reason: 'x' }, { id: 'coin', reason: 'y' }] },
      { objects: [{ id: 'coin' }] },
      { objects: ids.slice(0, 5).map((id) => ({ id, reason: 'x' })) },
    ]) expect(parseAiPick(bad, ids)).toBeNull()
  })

  it('falls back to the local pick quietly: no server, an error, an invalid answer', async () => {
    const local = pickLocal('Идея', library)
    for (const fetch of [
      vi.fn(async () => new Response('{}', { status: 404 })),
      vi.fn(async () => new Response('{"error":"no key"}', { status: 503 })),
      vi.fn(async () => Response.json({ objects: [{ id: 'spaceship', reason: 'x' }] })),
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    ]) {
      vi.stubGlobal('fetch', fetch)
      expect(await pickObjects('Идея', library)).toEqual(local)
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ objects: [{ id: 'lamp', reason: 'идея' }, { id: 'puzzle', reason: 'решение' }] })))
    expect(await pickObjects('Идея', library)).toMatchObject({ objectIds: ['lamp', 'puzzle'], source: 'ai' })
  })
})
