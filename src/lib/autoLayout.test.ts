import { describe, expect, it } from 'vitest'
import manifest from '../../public/library/manifest.json'
import { autoLayout, MAX_MAIN, MAX_MAIN_OVERLAP, overlapShare, type BackgroundAmount, type Placement } from './autoLayout'
import { composeObjects } from './compose'
import { FORMATS } from './formats'
import type { LibraryObject } from '../store/objectLibrary'

const library = manifest as LibraryObject[]
const sources = library.map((o) => ({ id: o.id, main: o.versions.L.main, bg: o.versions.L.bg }))
const byId = new Map(sources.map((s) => [s.id, s]))

/** Sets of the contact sheet and a few more, every format, several seeds. */
const SETS = [
  ['lamp'],
  ['headphones', 'phone'],
  ['book', 'lamp', 'pen'],
  ['coin', 'wallet', 'phone'],
  ['coin', 'folder'],
  ['flowers', 'book', 'puzzle', 'headphones', 'folder'],
  ['pen', 'coin', 'puzzle'],
  ['folder', 'book', 'phone'],
]
const AMOUNTS: BackgroundAmount[] = ['none', 'few', 'many']
const CASES = SETS.flatMap((ids) =>
  FORMATS.flatMap((format) => AMOUNTS.flatMap((background) => [1, 2, 3, 7].map((seed) => ({ ids, canvas: format.size, format: format.id, background, seed })))),
)

const run = (c: (typeof CASES)[number]) =>
  autoLayout({ objects: c.ids.map((id) => byId.get(id)!), library: sources, canvas: c.canvas, background: c.background, seed: c.seed })
const label = (c: (typeof CASES)[number]) => `${c.ids.join('+')} ${c.format} ${c.background} seed ${c.seed}`
const mains = (p: Placement[]) => p.filter((o) => o.state === 'main')

describe('autoLayout', () => {
  it('keeps main objects whole inside the canvas', () => {
    for (const c of CASES) {
      for (const o of mains(run(c))) {
        expect(o.x, label(c)).toBeGreaterThanOrEqual(0)
        expect(o.y, label(c)).toBeGreaterThanOrEqual(0)
        expect(o.x + o.width, label(c)).toBeLessThanOrEqual(c.canvas.width + 1e-6)
        expect(o.y + o.height, label(c)).toBeLessThanOrEqual(c.canvas.height + 1e-6)
      }
    }
  })

  it('lets main objects overlap only a little', () => {
    for (const c of CASES) {
      const m = mains(run(c))
      for (let i = 0; i < m.length; i++) {
        for (let j = i + 1; j < m.length; j++) expect(overlapShare(m[i], m[j]), label(c)).toBeLessThanOrEqual(MAX_MAIN_OVERLAP)
      }
    }
  })

  it('fills the frame: the main group spans most of its width or height', () => {
    for (const c of CASES) {
      const m = mains(run(c))
      const w = Math.max(...m.map((o) => o.x + o.width)) - Math.min(...m.map((o) => o.x))
      const h = Math.max(...m.map((o) => o.y + o.height)) - Math.min(...m.map((o) => o.y))
      expect(Math.max(w / c.canvas.width, h / c.canvas.height), label(c)).toBeGreaterThan(0.85)
    }
  })

  it('keeps the proportions of every object', () => {
    for (const c of CASES) {
      for (const o of run(c)) {
        const src = byId.get(o.objectId)![o.state]
        expect(o.width / o.height, label(c)).toBeCloseTo(src.width / src.height, 9)
      }
    }
  })

  it('gives the same result for the same seed, and another one for another seed', () => {
    for (const c of CASES) expect(run(c), label(c)).toEqual(run(c))
    const c = CASES.find((c) => c.ids.length === 3 && c.background === 'few')!
    expect(run({ ...c, seed: 2 })).not.toEqual(run({ ...c, seed: 1 }))
  })

  it('makes the first three main and the rest background; adds background objects as asked', () => {
    for (const c of CASES) {
      const p = run(c)
      expect(mains(p).map((o) => o.objectId).sort(), label(c)).toEqual(c.ids.slice(0, MAX_MAIN).sort())
      const bg = p.filter((o) => o.state === 'bg').map((o) => o.objectId)
      for (const id of c.ids.slice(MAX_MAIN)) expect(bg, label(c)).toContain(id)
      expect(bg.length, label(c)).toBe(Math.max(c.ids.length - MAX_MAIN, { none: 0, few: 2, many: 4 }[c.background]))
      expect(new Set(p.map((o) => o.objectId)).size, label(c)).toBe(p.length)
      // Background objects are under the main ones, larger than the average main one.
      expect(p.slice(0, bg.length).every((o) => o.state === 'bg'), label(c)).toBe(true)
      const mainSide = mains(p).reduce((s, o) => s + Math.sqrt(o.width * o.height), 0) / mains(p).length
      for (const o of p.slice(0, bg.length)) expect(Math.sqrt(o.width * o.height), label(c)).toBeGreaterThan(mainSide)
    }
  })

  it('draws the nearer (lower) main object over the farther one', () => {
    for (const c of CASES) {
      const bottoms = mains(run(c)).map((o) => o.y + o.height)
      expect(bottoms, label(c)).toEqual([...bottoms].sort((a, b) => a - b))
    }
  })

  it('follows the format: a row on a wide canvas, a column on a tall one', () => {
    for (const c of CASES.filter((c) => c.ids.length >= 2 && c.format !== 'square')) {
      const m = mains(run(c))
      const cx = m.map((o) => o.x + o.width / 2)
      const cy = m.map((o) => o.y + o.height / 2)
      const spread = (v: number[]) => Math.max(...v) - Math.min(...v)
      if (c.format === 'wide') expect(spread(cx) / c.canvas.width, label(c)).toBeGreaterThan(spread(cy) / c.canvas.height)
      else expect(spread(cy) / c.canvas.height, label(c)).toBeGreaterThan(spread(cx) / c.canvas.width)
    }
  })
})

describe('composeObjects', () => {
  it('gives canvas objects of the chosen size, unrotated, the same layout in L and S', () => {
    const settings = { objectIds: ['book', 'lamp', 'pen', 'coin'], background: 'few' as const, seed: 5 }
    const canvas = FORMATS[0].size
    const [l, s] = [composeObjects(settings, library, canvas, 'L'), composeObjects(settings, library, canvas, 'S')]
    expect(l.every((o) => o.componentId.startsWith('lib-L-') && o.rotation === 0 && !o.flipX)).toBe(true)
    expect(s.every((o) => o.componentId.startsWith('lib-S-'))).toBe(true)
    l.forEach((o, i) => {
      const [lv, sv] = [o, s[i]].map((x) => {
        const [, size, state, id] = /^lib-(L|S)-(main|bg)-(.+)$/.exec(x.componentId)!
        return library.find((obj) => obj.id === id)!.versions[size as 'L' | 'S'][state as 'main' | 'bg']
      })
      expect(s[i].x).toBeCloseTo(o.x, 6)
      expect(sv.width * s[i].scale).toBeCloseTo(lv.width * o.scale, 6)
    })
  })
})
