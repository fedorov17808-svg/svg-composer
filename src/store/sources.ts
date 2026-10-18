import { create } from 'zustand'
import type { MarkedObjects } from '../lib/marks'

export interface SourceInfo {
  id: string
  title: string
  /** Path relative to the app base, e.g. "sources/s01.svg". */
  file: string
  viewBox: string
}

export const assetUrl = (file: string) => `${import.meta.env.BASE_URL}${file}`

interface SourcesState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  sources: SourceInfo[]
  /** Marked-up objects of every source (`objects.json`, built by `npm run objects`); empty if missing. */
  objects: MarkedObjects
  load: () => Promise<void>
}

export const useSourcesStore = create<SourcesState>((set, get) => ({
  status: 'idle',
  error: null,
  sources: [],
  objects: {},
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return
    set({ status: 'loading', error: null })
    try {
      const [res, marks] = await Promise.all([
        fetch(assetUrl('sources/manifest.json')),
        fetch(assetUrl('sources/objects.json')).catch(() => null),
      ])
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const sources = (await res.json()) as SourceInfo[]
      // Without the markup clicks fall back to the computed objects.
      const objects = marks?.ok ? ((await marks.json().catch(() => ({}))) as MarkedObjects) : {}
      set({ status: 'ready', sources, objects })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },
}))
