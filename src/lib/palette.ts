/**
 * Color schemes of the object library. Every object is drawn in the lilac scheme, so each of its
 * colors is a slot: bg1–bg4 (background colors) or obj1–obj4 (object colors). Recoloring replaces
 * every fill/stroke by the color of the same slot in another scheme; a color variant swaps the
 * accent slots obj1–obj3 among themselves. Background slots stay background slots, so object colors
 * never reach background objects or the canvas background.
 */

export interface Palette {
  id: string
  name: string
  /** bg1–bg4, lightest first as on the sheet; bg1 is the canvas background. */
  background: string[]
  /** obj1–obj4: three accents and white. */
  objects: string[]
}

export type Slot = 'bg1' | 'bg2' | 'bg3' | 'bg4' | 'obj1' | 'obj2' | 'obj3' | 'obj4'
export const BACKGROUND_SLOTS: Slot[] = ['bg1', 'bg2', 'bg3', 'bg4']
export const OBJECT_SLOTS: Slot[] = ['obj1', 'obj2', 'obj3', 'obj4']
export const SLOT_COUNT = 4

/** The scheme the library is drawn in (the same as «Сиреневая» in `palettes.json`). */
export const BASE_PALETTE: Palette = {
  id: 'lilac',
  name: 'Сиреневая',
  background: ['#D7CDF5', '#AA9BF0', '#7864D7', '#181817'],
  objects: ['#F9ECB0', '#F9A3AA', '#FFE3E1', '#FFFFFF'],
}

/** Orders of the accents obj1–obj3; white (obj4) and the background slots never move. */
export const VARIANTS = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
  [0, 2, 1],
  [2, 1, 0],
  [1, 0, 2],
]

const NAMED: Record<string, string> = { white: '#FFFFFF', black: '#000000' }

/** "#abc", "#AABBCC", "aabbcc", "white" → "#AABBCC"; anything else → null. */
export function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (NAMED[v]) return NAMED[v]
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${hex.toUpperCase()}`
}

/** Slot of a color of the drawing, or null for a color outside the scheme. */
export function slotOf(color: string): Slot | null {
  const hex = normalizeHex(color)
  if (!hex) return null
  const bg = BASE_PALETTE.background.indexOf(hex)
  if (bg >= 0) return BACKGROUND_SLOTS[bg]
  const obj = BASE_PALETTE.objects.indexOf(hex)
  return obj >= 0 ? OBJECT_SLOTS[obj] : null
}

/** Color of a slot in a scheme, with the accents in the order of `variant`. */
export function slotColor(palette: Palette, slot: Slot, variant = 0): string {
  const i = Number(slot.at(-1)) - 1
  if (slot.startsWith('bg')) return palette.background[i]
  const order = VARIANTS[variant] ?? VARIANTS[0]
  return palette.objects[i < 3 ? order[i] : i]
}

/** Base color → color in `palette`, for every slot. */
export function colorMap(palette: Palette, variant = 0): Map<string, string> {
  return new Map([...BACKGROUND_SLOTS, ...OBJECT_SLOTS].map((slot) => [slotColor(BASE_PALETTE, slot), slotColor(palette, slot, variant)]))
}

const PAINT_ATTRS = /\b(fill|stroke|stop-color|flood-color)="([^"]*)"/g

/** Every paint attribute replaced by its slot color; `none` and colors outside the scheme stay. */
export function recolor(markup: string, map: Map<string, string>): string {
  return markup.replace(PAINT_ATTRS, (whole, attr: string, value: string) => {
    const next = map.get(normalizeHex(value) ?? '')
    return next ? `${attr}="${next}"` : whole
  })
}

/** Paint colors of a markup, normalized; `none` left out. */
export function paintColors(markup: string): string[] {
  return [...markup.matchAll(PAINT_ATTRS)].map((m) => m[2]).filter((v) => v !== 'none').map((v) => normalizeHex(v) ?? v)
}

const paintCache = new WeakMap<object, Map<string, unknown>>()

/**
 * A library component in `palette` and `variant`; other components (the gophers of v1) as they are.
 * Cached per component, so the canvas parts cache keeps working.
 */
export function paintComponent<C extends { sourceId: string; markup: string }>(component: C, palette: Palette, variant = 0): C {
  if (component.sourceId !== 'library') return component
  const key = `${palette.background.join()}|${palette.objects.join()}|${variant}`
  if (key === `${BASE_PALETTE.background.join()}|${BASE_PALETTE.objects.join()}|0`) return component
  let cache = paintCache.get(component)
  if (!cache) paintCache.set(component, (cache = new Map()))
  let painted = cache.get(key) as C | undefined
  if (!painted) cache.set(key, (painted = { ...component, markup: recolor(component.markup, colorMap(palette, variant)) }))
  return painted
}

/** A palette file that cannot be used; the message is for the user. */
export class PaletteError extends Error {}

const LABELS = { background: 'Цвет фона', objects: 'Цвет объектов' } as const

/** Checks a palette from a form or a file; colors come back as "#RRGGBB". */
export function validatePalette(value: unknown, where = 'Палитра'): Omit<Palette, 'id'> & { id?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PaletteError(`${where}: ожидался объект с полями name, background, objects.`)
  const data = value as Record<string, unknown>
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) throw new PaletteError(`${where}: нужно название (поле «name»).`)
  if (name.length > 40) throw new PaletteError(`${where}: название длиннее 40 символов.`)
  const colors = {} as Record<'background' | 'objects', string[]>
  for (const field of ['background', 'objects'] as const) {
    const list = data[field]
    if (!Array.isArray(list) || list.length !== SLOT_COUNT) {
      throw new PaletteError(`${where}: в «${field}» нужно ровно ${SLOT_COUNT} цвета (${LABELS[field].toLowerCase()} 1–4).`)
    }
    colors[field] = list.map((c, i) => {
      // Hex only: color names and rgb() would not survive the slot table.
      const hex = typeof c === 'string' && /^#?[0-9a-f]+$/i.test(c.trim()) ? normalizeHex(c) : null
      if (!hex) {
        throw new PaletteError(`${where}: ${LABELS[field]} ${i + 1} — «${String(c)}» не hex-цвет. Нужно #RRGGBB, например #D7CDF5.`)
      }
      return hex
    })
  }
  // Object colors must not be usable in backgrounds: the same color in both would break the rule.
  const shared = colors.objects.filter((c) => colors.background.includes(c))
  if (shared.length) {
    throw new PaletteError(`${where}: ${shared.join(', ')} — и цвет фона, и цвет объектов. Цвета объектов нельзя использовать в фоне, сделайте их разными.`)
  }
  return { ...(typeof data.id === 'string' ? { id: data.id } : {}), name, background: colors.background, objects: colors.objects }
}

/** A palette JSON file: one palette or a list of them (the format of `palettes.json`). */
export function parsePaletteFile(text: string): Omit<Palette, 'id'>[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new PaletteError('Файл повреждён: это не JSON.')
  }
  const list = Array.isArray(data) ? data : [data]
  if (!list.length) throw new PaletteError('В файле нет палитр.')
  return list.map((p, i) => {
    const { name, background, objects } = validatePalette(p, list.length > 1 ? `Палитра №${i + 1}` : 'Палитра')
    return { name, background, objects }
  })
}
