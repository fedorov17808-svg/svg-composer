import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_SLOTS,
  BASE_PALETTE,
  colorMap,
  normalizeHex,
  OBJECT_SLOTS,
  paintColors,
  paintComponent,
  PaletteError,
  parsePaletteFile,
  recolor,
  slotColor,
  slotOf,
  validatePalette,
  VARIANTS,
  type Palette,
} from './palette'

// The files of `npm run import-library` as text, without Node APIs (the app tsconfig has no Node types).
const sources = import.meta.glob<string>(['../../public/library/*/*/*.svg', '../../public/library/palettes.json'], { query: '?raw', import: 'default', eager: true })
const palettesText = sources['../../public/library/palettes.json']
const palettes = JSON.parse(palettesText) as Palette[]
const files = Object.entries(sources)
  .filter(([path]) => path.endsWith('.svg'))
  .map(([path, markup]) => {
    const file = path.replace('../../public/library/', '')
    return { file, state: file.split('/')[1], markup }
  })
const mint = palettes.find((p) => p.id === 'mint')!

describe('slot table', () => {
  it('is the lilac scheme of palettes.json', () => {
    expect(palettes.map((p) => p.id)).toEqual(['lilac', 'peach', 'mint'])
    expect(palettes[0]).toEqual(BASE_PALETTE)
  })

  it('names every color of all 40 library files', () => {
    expect(files).toHaveLength(40)
    const outside = new Map<string, string[]>()
    for (const { file, markup } of files) {
      for (const color of paintColors(markup)) if (!slotOf(color)) outside.set(color, [...(outside.get(color) ?? []), file])
    }
    // On failure: which colors and where, to ask about them instead of guessing a slot.
    expect(Object.fromEntries([...outside].map(([c, f]) => [c, [...new Set(f)]]))).toEqual({})
  })

  it('background objects use background colors only', () => {
    for (const { file, state, markup } of files.filter((f) => f.state === 'bg')) {
      const slots = new Set(paintColors(markup).map(slotOf))
      expect([...slots].every((s) => s?.startsWith('bg')), `${file} (${state}): ${[...slots].join(' ')}`).toBe(true)
    }
  })
})

describe('recolor', () => {
  it('replaces each color by the color of its slot', () => {
    const markup = BASE_PALETTE.background.map((c) => `<path fill="${c}"/>`).join('') + '<path fill="white" stroke="#f9ecb0"/><path fill="none"/><path fill="#123456"/>'
    const out = recolor(markup, colorMap(mint))
    expect(out).toBe(
      mint.background.map((c) => `<path fill="${c}"/>`).join('') + `<path fill="${mint.objects[3]}" stroke="${mint.objects[0]}"/><path fill="none"/><path fill="#123456"/>`,
    )
  })

  it('puts every library file in each scheme with that scheme colors only', () => {
    for (const palette of palettes) {
      const allowed = new Set([...palette.background, ...palette.objects])
      for (const { file, state, markup } of files) {
        for (let variant = 0; variant < VARIANTS.length; variant++) {
          const colors = new Set(paintColors(recolor(markup, colorMap(palette, variant))))
          expect([...colors].every((c) => allowed.has(c)), `${palette.id} ${file} #${variant}`).toBe(true)
          // Object colors never reach background objects.
          if (state === 'bg') expect([...colors].every((c) => palette.background.includes(c)), `${palette.id} ${file}`).toBe(true)
        }
      }
    }
  })

  it('keeps the drawing: only paint attributes change', () => {
    const { markup } = files.find((f) => f.file === 'L/main/book.svg')!
    const strip = (m: string) => m.replace(/(fill|stroke)="[^"]*"/g, '')
    expect(strip(recolor(markup, colorMap(mint, 3)))).toBe(strip(markup))
  })
})

describe('color variants', () => {
  it('are the 6 orders of the accents; white and background colors stay', () => {
    expect(new Set(VARIANTS.map((v) => v.join())).size).toBe(6)
    expect(VARIANTS[0]).toEqual([0, 1, 2])
    for (let v = 0; v < VARIANTS.length; v++) {
      for (const slot of BACKGROUND_SLOTS) expect(slotColor(mint, slot, v)).toBe(slotColor(mint, slot))
      expect(slotColor(mint, 'obj4', v)).toBe('#FFFFFF')
      const accents = OBJECT_SLOTS.slice(0, 3).map((s) => slotColor(mint, s, v))
      expect([...accents].sort()).toEqual([...mint.objects.slice(0, 3)].sort())
    }
  })

  it('paint a library component, leave the gopher pieces and the base scheme alone', () => {
    const lib = { sourceId: 'library', markup: '<g><path fill="#F9ECB0"/></g>' }
    expect(paintComponent(lib, BASE_PALETTE)).toBe(lib)
    expect(paintComponent(lib, BASE_PALETTE, 1).markup).toBe('<g><path fill="#F9A3AA"/></g>')
    expect(paintComponent(lib, mint, 1)).toBe(paintComponent(lib, mint, 1))
    const gopher = { sourceId: 's01', markup: '<g><path fill="#F9ECB0"/></g>' }
    expect(paintComponent(gopher, mint)).toBe(gopher)
  })
})

describe('palette input', () => {
  const ok = { name: '  Морская ', background: ['#e0f0ff', 'a0c8f0', '#36C', '#101820'], objects: ['#FFD166', '#EF476F', '#06D6A0', '#fff'] }

  it('normalizes colors to #RRGGBB', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC')
    expect(normalizeHex('white')).toBe('#FFFFFF')
    expect(normalizeHex('#12345')).toBeNull()
    expect(validatePalette(ok)).toEqual({
      name: 'Морская',
      background: ['#E0F0FF', '#A0C8F0', '#3366CC', '#101820'],
      objects: ['#FFD166', '#EF476F', '#06D6A0', '#FFFFFF'],
    })
  })

  it('says what is wrong', () => {
    const fail = (value: unknown) => () => validatePalette(value)
    expect(fail({ ...ok, name: ' ' })).toThrow('нужно название')
    expect(fail({ ...ok, background: ok.background.slice(0, 3) })).toThrow('ровно 4 цвета')
    expect(fail({ ...ok, objects: ['#FFD166', 'red', '#06D6A0', '#fff'] })).toThrow('Цвет объектов 2 — «red» не hex-цвет')
    expect(fail({ ...ok, objects: ['#FFD166', '#EF476F', '#06D6A0', '#101820'] })).toThrow('#101820 — и цвет фона, и цвет объектов')
    expect(fail([ok])).toThrow(PaletteError)
  })

  it('reads one palette or the palettes.json list', () => {
    expect(parsePaletteFile(JSON.stringify(ok))).toHaveLength(1)
    expect(parsePaletteFile(palettesText).map((p) => p.name)).toEqual(['Сиреневая', 'Персиковая', 'Мятная'])
    expect(() => parsePaletteFile('{')).toThrow('это не JSON')
    expect(() => parsePaletteFile(JSON.stringify([ok, { ...ok, background: [] }]))).toThrow('Палитра №2')
  })
})
