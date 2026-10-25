import { createStore, get, set } from 'idb-keyval'
import type { CanvasObject, Size } from '../lib/canvas'
import { parseAuto, type AutoSettings } from '../lib/compose'
import { FORMAT_IDS, formatOf, objectSizeOf, type FormatId } from '../lib/formats'
import type { ObjectSize } from '../lib/libraryObjects'
import { useCanvasStore } from './canvas'
import { showDemo } from './demo'

/** A separate database: a new store cannot be added to the existing library database. */
const db = createStore('svg-composer-composition', 'composition')
const KEY = 'current'
const DELAY = 300

interface Saved {
  size: Size
  objects: CanvasObject[]
  /** Missing in compositions saved before v2. */
  paletteId?: string
  /** Missing in compositions saved before v2 stage 3. */
  format?: FormatId
  objectSize?: ObjectSize
  /** Missing in compositions saved before v2 stage 4. */
  auto?: (AutoSettings & { size: Size }) | null
}

const isSaved = (v: unknown): v is Saved =>
  typeof v === 'object' && v !== null && Array.isArray((v as Saved).objects) && typeof (v as Saved).size?.width === 'number'

/**
 * Restores the last composition, then saves objects, canvas size, format, object size and color scheme after every change. History is
 * session state and is not kept.
 */
export async function startAutosave() {
  let restored = false
  try {
    const saved = await get<unknown>(KEY, db)
    // Only if nothing has been placed while the database was opening.
    if (isSaved(saved) && useCanvasStore.getState().objects.length === 0) {
      useCanvasStore.setState({
        size: saved.size,
        objects: saved.objects,
        selectedId: null,
        format: saved.format && FORMAT_IDS.includes(saved.format) ? saved.format : formatOf(saved.size),
        objectSize: saved.objectSize === 'L' || saved.objectSize === 'S' ? saved.objectSize : objectSizeOf(saved.objects),
        auto: parseAuto(saved.auto),
        ...(saved.paletteId ? { paletteId: saved.paletteId } : {}),
      })
      useCanvasStore.getState().fit()
    }
    restored = isSaved(saved)
  } catch (err) {
    console.warn('Автосохранение: не удалось прочитать композицию', err)
  }

  // Nothing saved yet: the first run shows a built composition (not after a deliberately emptied one).
  if (!restored) await showDemo()

  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(timer)
    timer = undefined
    const { size, objects, paletteId, format, objectSize, auto } = useCanvasStore.getState()
    set(KEY, { size, objects, paletteId, format, objectSize, auto } satisfies Saved, db).catch((err) =>
      console.warn('Автосохранение: не удалось записать композицию', err),
    )
  }
  useCanvasStore.subscribe((state, prev) => {
    const same = (['objects', 'size', 'paletteId', 'format', 'objectSize', 'auto'] as const).every((key) => state[key] === prev[key])
    if (same) return
    clearTimeout(timer)
    timer = setTimeout(save, DELAY)
  })
  // Do not lose the last change when the tab is closed right after it.
  addEventListener('pagehide', () => timer !== undefined && save())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && timer !== undefined && save())
}
