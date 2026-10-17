import { clear, createStore, del, set as idbSet, setMany, values } from 'idb-keyval'
import { create } from 'zustand'
import { useCanvasStore } from './canvas'
import { assetUrl } from './sources'

export interface LibraryComponent {
  id: string
  name: string
  sourceId: string
  /** A single `<g>` positioned at the origin. */
  markup: string
  /** Serialized `<defs>` children with ids already prefixed. */
  defs: string
  width: number
  height: number
  createdAt: number
}

const db = createStore('svg-composer', 'library')
/** Set once the demo components have been offered, so a library emptied on purpose stays empty. */
const SEEDED_KEY = 'svg-composer-seeded'

/** Demo components built by `npm run seed` from the sources. */
async function fetchSeed(): Promise<LibraryComponent[]> {
  const res = await fetch(assetUrl('seed-library.json'))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as LibraryComponent[]
}

interface LibraryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  components: LibraryComponent[]
  load: () => Promise<void>
  add: (component: LibraryComponent) => Promise<void>
  /** Adds components the library does not have yet; existing ones (maybe renamed) stay as they are. */
  addMissing: (components: LibraryComponent[]) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Replaces the library with the demo components; canvas objects of removed components go too. */
  resetToDemo: () => Promise<void>
}

/** The one load in flight or done; callers that need the library wait for it. */
let loading: Promise<void> | null = null

export const useLibraryStore = create<LibraryState>((set, get) => ({
  status: 'idle',
  error: null,
  components: [],
  load: () =>
    (loading ??= (async () => {
      set({ status: 'loading', error: null })
      try {
        let components = await values<LibraryComponent>(db)
        if (components.length === 0 && !localStorage.getItem(SEEDED_KEY)) {
          try {
            components = await fetchSeed()
            await setMany(components.map((c) => [c.id, c]), db)
          } catch (err) {
            console.warn('Демо-библиотека: не удалось загрузить', err)
          }
        }
        localStorage.setItem(SEEDED_KEY, '1')
        components.sort((a, b) => a.createdAt - b.createdAt)
        set({ status: 'ready', components })
      } catch (err) {
        loading = null
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    })()),
  add: async (component) => {
    await idbSet(component.id, component, db)
    set({ components: [...get().components, component] })
  },
  addMissing: async (components) => {
    await get().load()
    const have = new Set(get().components.map((c) => c.id))
    const missing = components.filter((c) => !have.has(c.id))
    if (!missing.length) return
    await setMany(missing.map((c) => [c.id, c]), db)
    set({ components: [...get().components, ...missing] })
  },
  rename: async (id, name) => {
    const component = get().components.find((c) => c.id === id)
    if (!component || component.name === name) return
    const renamed = { ...component, name }
    await idbSet(id, renamed, db)
    set({ components: get().components.map((c) => (c.id === id ? renamed : c)) })
  },
  remove: async (id) => {
    await del(id, db)
    set({ components: get().components.filter((c) => c.id !== id) })
    useCanvasStore.getState().removeComponent(id)
  },
  resetToDemo: async () => {
    const seed = await fetchSeed()
    await clear(db)
    await setMany(seed.map((c) => [c.id, c]), db)
    const keep = new Set(seed.map((c) => c.id))
    const removed = get().components.filter((c) => !keep.has(c.id))
    set({ components: seed })
    for (const c of removed) useCanvasStore.getState().removeComponent(c.id)
  },
}))
