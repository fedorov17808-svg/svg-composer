import { create } from 'zustand'
import { versionId, type ObjectSize, type ObjectState } from '../lib/libraryObjects'
import { useLibraryStore, type LibraryComponent } from './library'
import { assetUrl } from './sources'

export { versionId, type ObjectSize, type ObjectState }

export interface ObjectVersion {
  /** Path relative to the app base, e.g. "library/L/main/book.svg". */
  file: string
  width: number
  height: number
}

/** An object of the library, as in `public/library/manifest.json` (built by `npm run import-library`). */
export interface LibraryObject {
  id: string
  name: string
  synonyms: string[]
  /** Meanings and associations, for picking objects by a metaphor. */
  tags: string[]
  versions: Record<ObjectSize, Record<ObjectState, ObjectVersion>>
}

export const OBJECT_SIZES: ObjectSize[] = ['L', 'S']
export const OBJECT_STATES: ObjectState[] = ['main', 'bg']
export const STATE_LABELS: Record<ObjectState, string> = { main: 'Главный', bg: 'Фоновый' }

/** The file holds one `<g>` already at the origin; it becomes the component markup as it is. */
export function versionComponent(object: LibraryObject, size: ObjectSize, state: ObjectState, svg: string): LibraryComponent {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const group = doc.documentElement.querySelector(':scope > g')
  if (doc.querySelector('parsererror') || !group) throw new Error(`${object.versions[size][state].file}: нет группы объекта`)
  const { width, height } = object.versions[size][state]
  return {
    id: versionId(object.id, size, state),
    name: object.name,
    sourceId: 'library',
    markup: new XMLSerializer().serializeToString(group),
    defs: '',
    width,
    height,
    createdAt: 0,
  }
}

interface ObjectLibraryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  objects: LibraryObject[]
  state: ObjectState
  load: () => Promise<void>
  setState: (state: ObjectState) => void
}

export const useObjectLibraryStore = create<ObjectLibraryState>((set, get) => ({
  status: 'idle',
  error: null,
  objects: [],
  state: 'main',
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return
    set({ status: 'loading', error: null })
    try {
      const res = await fetch(assetUrl('library/manifest.json'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const objects = (await res.json()) as LibraryObject[]
      // Every version up front: objects on the canvas may use any of them.
      const components = await Promise.all(
        objects.flatMap((object) =>
          OBJECT_SIZES.flatMap((size) =>
            OBJECT_STATES.map(async (state) => {
              const file = await fetch(assetUrl(object.versions[size][state].file))
              if (!file.ok) throw new Error(`${object.versions[size][state].file}: HTTP ${file.status}`)
              return versionComponent(object, size, state, await file.text())
            }),
          ),
        ),
      )
      useLibraryStore.getState().setBuiltin(components)
      set({ status: 'ready', objects })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },
  setState: (state) => set({ state }),
}))
