import { createStore, del, set as idbSet, values } from 'idb-keyval'
import { create } from 'zustand'
import type { CanvasObject } from '../lib/canvas'
import { BASE_PALETTE, paintComponent, type Palette } from '../lib/palette'
import { useCanvasStore } from './canvas'
import { assetUrl } from './sources'

/** A separate database: a new store cannot be added to the existing library database. */
const db = createStore('svg-composer-palettes', 'palettes')

export const isCustomPalette = (id: string) => id.startsWith('custom-')
const newId = () => 'custom-' + Math.random().toString(36).slice(2, 8)

interface PalettesState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** The schemes of `library/palettes.json` (built by `npm run import-library`). */
  builtin: Palette[]
  /** Added by the user, kept in IndexedDB; oldest first. */
  custom: Palette[]
  /** A palette being edited: the canvas shows it until the form closes. */
  preview: Palette | null
  load: () => Promise<void>
  /** Saves a new palette and returns it with its id. */
  add: (palette: Omit<Palette, 'id'>) => Promise<Palette>
  /** Keeps a palette that came with a project, under its own id, unless one with that id is here. */
  addMissing: (palette: Palette) => Promise<void>
  remove: (id: string) => Promise<void>
  setPreview: (palette: Palette | null) => void
}

let loading: Promise<void> | null = null

export const usePalettesStore = create<PalettesState>((set, get) => ({
  status: 'idle',
  error: null,
  builtin: [BASE_PALETTE],
  custom: [],
  preview: null,
  load: () =>
    (loading ??= (async () => {
      set({ status: 'loading', error: null })
      try {
        const [res, custom] = await Promise.all([fetch(assetUrl('library/palettes.json')), values<Palette & { createdAt: number }>(db)])
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const builtin = (await res.json()) as Palette[]
        custom.sort((a, b) => a.createdAt - b.createdAt)
        set({ status: 'ready', builtin, custom: custom.map(({ id, name, background, objects }) => ({ id, name, background, objects })) })
      } catch (err) {
        loading = null
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    })()),
  add: async (palette) => {
    const saved = { id: newId(), name: palette.name, background: [...palette.background], objects: [...palette.objects] }
    await idbSet(saved.id, { ...saved, createdAt: Date.now() }, db)
    set({ custom: [...get().custom, saved] })
    return saved
  },
  addMissing: async (palette) => {
    await get().load()
    if (!isCustomPalette(palette.id) || get().custom.some((p) => p.id === palette.id)) return
    await idbSet(palette.id, { ...palette, createdAt: Date.now() }, db)
    set({ custom: [...get().custom, palette] })
  },
  remove: async (id) => {
    await del(id, db)
    set({ custom: get().custom.filter((p) => p.id !== id) })
  },
  setPreview: (preview) => set({ preview }),
}))

/** Every scheme to choose from: the built-in ones, then the user's. */
export const allPalettes = (s: Pick<PalettesState, 'builtin' | 'custom'>) => [...s.builtin, ...s.custom]

/** The scheme with this id; the base scheme if it is gone (a deleted palette, an old project). */
export const findPalette = (s: Pick<PalettesState, 'builtin' | 'custom'>, id: string) =>
  allPalettes(s).find((p) => p.id === id) ?? s.builtin[0] ?? BASE_PALETTE

/** What the canvas and the export draw in: the palette being edited, else the composition's scheme. */
export function activePalette(): Palette {
  const palettes = usePalettesStore.getState()
  return palettes.preview ?? findPalette(palettes, useCanvasStore.getState().paletteId)
}

export function useActivePalette(): Palette {
  const paletteId = useCanvasStore((s) => s.paletteId)
  return usePalettesStore((s) => s.preview ?? findPalette(s, paletteId))
}

/** A canvas object's component in the scheme, with the object's color variant. */
export const paintObject = <C extends { sourceId: string; markup: string }>(obj: Pick<CanvasObject, 'variant'>, component: C, palette: Palette) =>
  paintComponent(component, palette, obj.variant ?? 0)
