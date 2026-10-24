import { createStore, get, set } from 'idb-keyval'
import type { CanvasObject, Size } from '../lib/canvas'
import { useCanvasStore } from './canvas'

/** A separate database: a new store cannot be added to the existing library database. */
const db = createStore('svg-composer-composition', 'composition')
const KEY = 'current'
const DELAY = 300

interface Saved {
  size: Size
  objects: CanvasObject[]
  /** Missing in compositions saved before v2. */
  paletteId?: string
}

const isSaved = (v: unknown): v is Saved =>
  typeof v === 'object' && v !== null && Array.isArray((v as Saved).objects) && typeof (v as Saved).size?.width === 'number'

/**
 * Restores the last composition, then saves objects, canvas size and color scheme after every change. History is
 * session state and is not kept.
 */
export async function startAutosave() {
  try {
    const saved = await get<unknown>(KEY, db)
    // Only if nothing has been placed while the database was opening.
    if (isSaved(saved) && useCanvasStore.getState().objects.length === 0) {
      useCanvasStore.setState({ size: saved.size, objects: saved.objects, selectedId: null, ...(saved.paletteId ? { paletteId: saved.paletteId } : {}) })
      useCanvasStore.getState().fit()
    }
  } catch (err) {
    console.warn('Автосохранение: не удалось прочитать композицию', err)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(timer)
    timer = undefined
    const { size, objects, paletteId } = useCanvasStore.getState()
    set(KEY, { size, objects, paletteId } satisfies Saved, db).catch((err) =>
      console.warn('Автосохранение: не удалось записать композицию', err),
    )
  }
  useCanvasStore.subscribe((state, prev) => {
    if (state.objects === prev.objects && state.size === prev.size && state.paletteId === prev.paletteId) return
    clearTimeout(timer)
    timer = setTimeout(save, DELAY)
  })
  // Do not lose the last change when the tab is closed right after it.
  addEventListener('pagehide', () => timer !== undefined && save())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && timer !== undefined && save())
}
