import type { Size } from './canvas'
import type { ObjectState } from './libraryObjects'

/** How many background objects the service may add from the library. */
export type BackgroundAmount = 'none' | 'few' | 'many'
export const BACKGROUND_AMOUNTS: { id: BackgroundAmount; label: string }[] = [
  { id: 'none', label: 'нет' },
  { id: 'few', label: 'немного' },
  { id: 'many', label: 'много' },
]

/** An object of the library as the layout sees it: the proportions of its two versions. */
export interface LayoutSource {
  id: string
  main: Size
  bg: Size
}

export interface LayoutRequest {
  /** The objects asked for, in order, without repeats. */
  objects: LayoutSource[]
  /** Every object of the library, for background objects the service adds. */
  library: LayoutSource[]
  canvas: Size
  background: BackgroundAmount
  seed: number
}

/** A placed object: its unrotated box on the canvas, bottom to top in the result. */
export interface Placement {
  objectId: string
  state: ObjectState
  x: number
  y: number
  width: number
  height: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** At most this many objects are main, in focus; the rest of the list goes to the background. */
export const MAX_MAIN = 3
/** Free edge around the main objects, as a share of the short side of the canvas. */
export const MAIN_MARGIN = 0.05
/** Largest overlap of two main boxes, as a share of the smaller one (boxes of isometric objects have empty corners). */
export const MAX_MAIN_OVERLAP = 0.12
/** How much of the size difference of the sheet main objects keep: 1 — as drawn, 0 — all alike. */
const FOCUS_POWER = 0.35
/** Background objects the service adds at most, by amount (objects of the list beyond MAX_MAIN come anyway). */
const ADDED_BACKGROUND: Record<BackgroundAmount, number> = { none: 0, few: 2, many: 4 }

/**
 * Objects that go together by meaning; a background object is picked first from the themes of the
 * main ones.
 */
const THEMES: string[][] = [
  ['book', 'pen', 'folder', 'lamp', 'puzzle'],
  ['coin', 'wallet', 'phone', 'folder', 'pen'],
  ['headphones', 'phone', 'flowers', 'book', 'lamp'],
  ['puzzle', 'lamp', 'book', 'pen', 'headphones'],
  ['flowers', 'lamp', 'book', 'wallet', 'coin'],
]

/** Deterministic random numbers in [0, 1) from a seed (mulberry32). */
export function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (rnd: () => number, a: number, b: number) => a + (b - a) * rnd()
const shuffle = <T>(items: T[], rnd: () => number) => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const area = (r: Rect) => r.width * r.height
function intersection(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
/** Overlap of two boxes as a share of the smaller one. */
export const overlapShare = (a: Rect, b: Rect) => intersection(a, b) / Math.min(area(a), area(b))

const bounds = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y }
}

/**
 * Relative sizes of the main objects: the sheet makes a coin four times smaller than a folder; in
 * focus they come closer (that ratio to the power FOCUS_POWER, 0.6 instead of 0.23), so a coin next
 * to a folder is not a speck.
 */
function focusSizes(objects: LayoutSource[]): Size[] {
  const weights = objects.map((o) => Math.sqrt(o.main.width * o.main.height))
  const top = Math.max(...weights)
  return objects.map((o, i) => {
    const k = Math.pow(weights[i] / top, FOCUS_POWER) / weights[i]
    return { width: o.main.width * k, height: o.main.height * k }
  })
}

type Arrangement = 'row' | 'column' | 'diagonal'
const arrangementOf = ({ width, height }: Size): Arrangement => (width / height >= 1.4 ? 'row' : width / height <= 0.8 ? 'column' : 'diagonal')

/**
 * Main objects one after another along `dir`, each as close to the earlier ones as the allowed
 * overlap lets it, shifted across by `across` (a share of its size). Units are those of `sizes`.
 */
function chain(sizes: Size[], dir: { x: number; y: number }, across: number[], overlap: number): Rect[] {
  const rects: Rect[] = []
  const normal = { x: -dir.y, y: dir.x }
  let center = { x: 0, y: 0 }
  sizes.forEach((size, i) => {
    const at = (t: number): Rect => {
      const shift = across[i] * Math.sqrt(size.width * size.height)
      const c = { x: center.x + dir.x * t + normal.x * shift, y: center.y + dir.y * t + normal.y * shift }
      return { x: c.x - size.width / 2, y: c.y - size.height / 2, width: size.width, height: size.height }
    }
    if (i > 0) {
      const fits = (t: number) => rects.every((r) => overlapShare(r, at(t)) <= overlap)
      // The smallest step along the direction that keeps the overlap allowed.
      let [lo, hi] = [0, 4 * Math.max(size.width, size.height, ...rects.map((r) => Math.max(r.width, r.height)))]
      if (!fits(lo)) {
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2
          if (fits(mid)) hi = mid
          else lo = mid
        }
        lo = hi
      }
      const r = at(lo)
      center = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      rects.push(r)
    } else {
      const r = at(0)
      center = { x: 0, y: 0 }
      rects.push({ ...r, x: -size.width / 2, y: -size.height / 2 })
    }
  })
  return rects
}

interface Candidate {
  rects: Rect[]
  score: number
}

/** Share of the free length along the arrangement that goes into the gaps between main objects. */
const SPREAD = 0.35

/**
 * The main group scaled to the largest size that fits inside the margin and placed in the frame.
 * Part of the length left free along the arrangement goes between the objects, so a column of two
 * on a tall canvas fills it instead of leaving empty bands above and below.
 */
function fit(rects: Rect[], canvas: Size, arrangement: Arrangement, shift: { x: number; y: number }): Candidate {
  const margin = MAIN_MARGIN * Math.min(canvas.width, canvas.height)
  const inner = { width: canvas.width - 2 * margin, height: canvas.height - 2 * margin }
  const box = bounds(rects)
  const s = Math.min(inner.width / box.width, inner.height / box.height)
  let placed = rects.map((r) => ({ x: (r.x - box.x) * s, y: (r.y - box.y) * s, width: r.width * s, height: r.height * s }))
  if (placed.length > 1) {
    const spread = {
      x: arrangement === 'column' ? 0 : (inner.width - box.width * s) * SPREAD,
      y: arrangement === 'row' ? 0 : (inner.height - box.height * s) * SPREAD,
    }
    const steps = (key: 'x' | 'y', size: 'width' | 'height') => {
      const rank = placed.map((r, i) => ({ i, c: r[key] + r[size] / 2 })).sort((a, b) => a.c - b.c)
      const out = new Array<number>(placed.length)
      rank.forEach(({ i }, k) => (out[i] = (k / (placed.length - 1)) * spread[key]))
      return out
    }
    const [dx, dy] = [steps('x', 'width'), steps('y', 'height')]
    placed = placed.map((r, i) => ({ ...r, x: r.x + dx[i], y: r.y + dy[i] }))
  }
  const group = bounds(placed)
  const slack = { x: inner.width - group.width, y: inner.height - group.height }
  const ox = margin + slack.x * (0.5 + shift.x) - group.x
  const oy = margin + slack.y * (0.5 + shift.y) - group.y
  placed = placed.map((r) => ({ ...r, x: r.x + ox, y: r.y + oy }))
  // Large objects first; then a group that fills both sides of the frame, not only one.
  const coverage = placed.reduce((sum, r) => sum + area(r), 0) / area({ x: 0, y: 0, ...canvas })
  const fill = Math.min(group.width / inner.width, group.height / inner.height)
  return { rects: placed, score: coverage + 0.15 * fill }
}

/** Main objects: chosen by the seed among the best arrangements of a few dozen tries. */
function layoutMain(objects: LayoutSource[], canvas: Size, rnd: () => number): Rect[] {
  if (objects.length === 0) return []
  const sizes = focusSizes(objects)
  const arrangement = arrangementOf(canvas)
  const order = shuffle(
    objects.map((_, i) => i),
    rnd,
  )
  // Discrete choices of this variant.
  const sign = rnd() < 0.5 ? -1 : 1
  const zig = rnd() < 0.5 ? -1 : 1
  const candidates: (Candidate & { order: number[] })[] = []
  for (let k = 0; k < 48; k++) {
    let dir: { x: number; y: number }
    const tilt = between(rnd, 0.05, 0.35) * sign
    if (arrangement === 'row') dir = { x: 1, y: tilt }
    else if (arrangement === 'column') dir = { x: tilt, y: 1 }
    else dir = { x: 1, y: sign * between(rnd, 0.6, 1.1) }
    const len = Math.hypot(dir.x, dir.y)
    dir = { x: dir.x / len, y: dir.y / len }
    const across = order.map((_, i) => (i === 0 ? 0 : (i % 2 ? zig : -zig) * between(rnd, 0, arrangement === 'diagonal' ? 0.15 : 0.3)))
    const rects = chain(
      order.map((i) => sizes[i]),
      dir,
      across,
      between(rnd, 0.01, 0.06),
    )
    const fitted = fit(rects, canvas, arrangement, { x: between(rnd, -0.2, 0.2), y: between(rnd, -0.2, 0.2) })
    candidates.push({ ...fitted, order })
  }
  candidates.sort((a, b) => b.score - a.score)
  // One of the best three: variants differ, quality stays.
  const pick = candidates[Math.floor(rnd() * Math.min(3, candidates.length))]
  const rects: Rect[] = []
  pick.order.forEach((objectIndex, i) => (rects[objectIndex] = pick.rects[i]))
  return rects
}

/** Background objects: those asked for beyond the main ones, then ones of the same themes, then any. */
function pickBackground(request: LayoutRequest, main: LayoutSource[], rnd: () => number): LayoutSource[] {
  const extra = request.objects.slice(MAX_MAIN)
  const count = Math.max(extra.length, ADDED_BACKGROUND[request.background])
  const used = new Set(request.objects.map((o) => o.id))
  const related = new Set(THEMES.filter((t) => main.some((o) => t.includes(o.id))).flat())
  const free = request.library.filter((o) => !used.has(o.id))
  const tiers = [shuffle(free.filter((o) => related.has(o.id)), rnd), shuffle(free.filter((o) => !related.has(o.id)), rnd)]
  return [...extra, ...tiers.flat()].slice(0, count)
}

/**
 * Background objects behind the main ones, larger than them, at the edges and corners of the frame
 * and partly past them: each goes where it covers the most of the frame nothing covers yet.
 */
function layoutBackground(objects: LayoutSource[], main: Rect[], canvas: Size, rnd: () => number): Rect[] {
  if (objects.length === 0) return []
  const mainSize = main.length ? main.reduce((s, r) => s + Math.sqrt(area(r)), 0) / main.length : Math.min(canvas.width, canvas.height) * 0.5
  const cols = 32
  const rows = Math.max(8, Math.round((cols * canvas.height) / canvas.width))
  const cw = canvas.width / cols
  const ch = canvas.height / rows
  // 0 — empty, 1 — a background object, 2 — a main object.
  const grid = new Uint8Array(cols * rows)
  const cells = (r: Rect, inset: number) => {
    const out: number[] = []
    const [x0, x1] = [r.x + r.width * inset, r.x + r.width * (1 - inset)]
    const [y0, y1] = [r.y + r.height * inset, r.y + r.height * (1 - inset)]
    for (let j = Math.max(0, Math.floor(y0 / ch)); j < Math.min(rows, Math.ceil(y1 / ch)); j++) {
      for (let i = Math.max(0, Math.floor(x0 / cw)); i < Math.min(cols, Math.ceil(x1 / cw)); i++) out.push(j * cols + i)
    }
    return out
  }
  for (const r of main) for (const c of cells(r, 0.12)) grid[c] = 2

  const anchors: { x: number; y: number }[] = []
  for (const fx of [0, 0.25, 0.5, 0.75, 1]) for (const fy of [0, 0.25, 0.5, 0.75, 1]) if (fx % 1 === 0 || fy % 1 === 0) anchors.push({ x: fx, y: fy })

  const placed: Rect[] = []
  for (const object of objects) {
    const k = between(rnd, 1.1, 1.4)
    const w = Math.sqrt(object.bg.width * object.bg.height)
    const size = { width: (object.bg.width / w) * mainSize * k, height: (object.bg.height / w) * mainSize * k }
    let best: { rect: Rect; score: number } | null = null
    for (const a of anchors) {
      for (const out of [0.2, 0.35]) {
        // Pushed past the edges the anchor is on, by `out` of its size.
        const dx = a.x === 0 ? -1 : a.x === 1 ? 1 : 0
        const dy = a.y === 0 ? -1 : a.y === 1 ? 1 : 0
        const cx = a.x * canvas.width - dx * size.width * (0.5 - out)
        const cy = a.y * canvas.height - dy * size.height * (0.5 - out)
        const rect = { x: cx - size.width / 2, y: cy - size.height / 2, ...size }
        let score = 0
        for (const c of cells(rect, 0.1)) score += grid[c] === 0 ? 1 : grid[c] === 1 ? -1.5 : -0.6
        score *= between(rnd, 0.85, 1.15)
        if (!best || score > best.score) best = { rect, score }
      }
    }
    placed.push(best!.rect)
    for (const c of cells(best!.rect, 0.1)) if (grid[c] === 0) grid[c] = 1
  }
  return placed
}

/**
 * A composition of the objects asked for, deterministic for a seed: up to three main objects in
 * focus, large, inside the frame and almost not overlapping, along the format (a row on a wide
 * canvas, a column on a tall one, a diagonal on a square); background objects behind them, larger,
 * at the edges. Boxes keep the proportions of the objects; nothing is rotated. Bottom to top:
 * background objects, then main ones from the farthest (highest) to the nearest (lowest).
 */
export function autoLayout(request: LayoutRequest): Placement[] {
  const rnd = random(request.seed)
  const main = request.objects.slice(0, MAX_MAIN)
  const mainRects = layoutMain(main, request.canvas, rnd)
  const background = pickBackground(request, main, rnd)
  const bgRects = layoutBackground(background, mainRects, request.canvas, rnd)
  const mains = main
    .map((o, i) => ({ objectId: o.id, state: 'main' as const, ...mainRects[i] }))
    .sort((a, b) => a.y + a.height - (b.y + b.height))
  return [...background.map((o, i) => ({ objectId: o.id, state: 'bg' as const, ...bgRects[i] })), ...mains]
}
