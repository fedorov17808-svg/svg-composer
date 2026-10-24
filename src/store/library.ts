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
/** Components of the object library (`public/library`) come with the app and live in memory only. */
export const isBuiltin = (id: string) => id.startsWith('lib-')
const builtinOf = (components: LibraryComponent[]) => components.filter((c) => isBuiltin(c.id))
/** Set once the demo components have been offered, so a library emptied on purpose stays empty. */
const SEEDED_KEY = 'svg-composer-seeded'
/**
 * Version of the demo set. When it changes, demo components still in the library get the new
 * markup (v2: objects from `objects.json` — the shop with its awning, the lantern with tassels;
 * v3: the lantern with its pole; v4: the lantern alone, without the pole).
 */
const SEED_VERSION = '4'

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
  /** Puts the object library in, replacing the previous copy; nothing is written to IndexedDB. */
  setBuiltin: (components: LibraryComponent[]) => void
}

/** The one load in flight or done; callers that need the library wait for it. */
let loading: Promise<void> | null = null

/** Demo components in `components` replaced by the current seed; the user's name and order are kept. */
async function refreshSeed(components: LibraryComponent[]) {
  const seed = new Map((await fetchSeed()).map((c) => [c.id, c]))
  const updated = components.map((c) => {
    const fresh = seed.get(c.id)
    return fresh ? { ...fresh, name: c.name, createdAt: c.createdAt } : c
  })
  await setMany(updated.filter((c) => seed.has(c.id)).map((c) => [c.id, c]), db)
  return updated
}

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
        const seeded = localStorage.getItem(SEEDED_KEY)
        if (seeded && seeded !== SEED_VERSION && components.some((c) => c.id.startsWith('seed-'))) {
          try {
            components = await refreshSeed(components)
          } catch (err) {
            console.warn('Демо-библиотека: не удалось обновить', err)
          }
        }
        localStorage.setItem(SEEDED_KEY, SEED_VERSION)
        components.sort((a, b) => a.createdAt - b.createdAt)
        set({ status: 'ready', components: [...components.filter((c) => !isBuiltin(c.id)), ...builtinOf(get().components)] })
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
    // Object library components of a project only fill in until the app's own copy loads.
    await setMany(missing.filter((c) => !isBuiltin(c.id)).map((c) => [c.id, c]), db)
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
    const removed = get().components.filter((c) => !keep.has(c.id) && !isBuiltin(c.id))
    set({ components: [...seed, ...builtinOf(get().components)] })
    for (const c of removed) useCanvasStore.getState().removeComponent(c.id)
  },
  setBuiltin: (components) => set({ components: [...get().components.filter((c) => !isBuiltin(c.id)), ...components] }),
}))
