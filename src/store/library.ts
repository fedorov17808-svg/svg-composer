import { createStore, del, set as idbSet, values } from 'idb-keyval'
import { create } from 'zustand'

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

interface LibraryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  components: LibraryComponent[]
  load: () => Promise<void>
  add: (component: LibraryComponent) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  status: 'idle',
  error: null,
  components: [],
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return
    set({ status: 'loading', error: null })
    try {
      const components = await values<LibraryComponent>(db)
      components.sort((a, b) => a.createdAt - b.createdAt)
      set({ status: 'ready', components })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },
  add: async (component) => {
    await idbSet(component.id, component, db)
    set({ components: [...get().components, component] })
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
  },
}))
