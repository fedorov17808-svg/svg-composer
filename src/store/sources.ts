import { create } from 'zustand'

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
  load: () => Promise<void>
}

export const useSourcesStore = create<SourcesState>((set, get) => ({
  status: 'idle',
  error: null,
  sources: [],
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return
    set({ status: 'loading', error: null })
    try {
      const res = await fetch(assetUrl('sources/manifest.json'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const sources = (await res.json()) as SourceInfo[]
      set({ status: 'ready', sources })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },
}))
