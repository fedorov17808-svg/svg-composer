import { emptyHistory } from '../lib/history'
import { pickLocal } from '../lib/metaphor'
import { useCanvasStore } from './canvas'
import { buildComposition } from './compose'
import { useObjectLibraryStore } from './objectLibrary'

/** The metaphor of the composition a first visitor sees; it also fills the field of the compose panel. */
export const DEMO_METAPHOR = 'Финансовая грамотность'
/** Set by the tests (and anyone who wants an empty start): no demo composition on the first run. */
export const NO_DEMO_KEY = 'svg-composer-no-demo'

/** `load()` returns at once when the grid has already started it, so wait for the end of the load. */
async function libraryLoaded(): Promise<void> {
  const store = useObjectLibraryStore
  void store.getState().load()
  if (store.getState().status === 'ready' || store.getState().status === 'error') return
  await new Promise<void>((resolve) => {
    const stop = store.subscribe((state) => {
      if (state.status !== 'ready' && state.status !== 'error') return
      stop()
      resolve()
    })
  })
}

/**
 * The first run, with nothing saved: puts a built composition on the wide canvas, so that the
 * result is there before anything is clicked. It is not an undo step: ⌘Z must not empty the page.
 */
export async function showDemo(): Promise<void> {
  try {
    if (localStorage.getItem(NO_DEMO_KEY)) return
  } catch {
    // Storage blocked: show the demo anyway.
  }
  await libraryLoaded()
  const { status, objects: library } = useObjectLibraryStore.getState()
  // The visitor may have started already while the library was loading.
  if (status !== 'ready' || useCanvasStore.getState().objects.length > 0) return
  const pick = pickLocal(DEMO_METAPHOR, library)
  const built = buildComposition({
    objectIds: pick.objectIds,
    background: 'few',
    seed: 1,
    metaphor: { text: DEMO_METAPHOR, reasons: pick.reasons, source: pick.source },
  })
  if (!built) return
  useCanvasStore.setState({ history: emptyHistory() })
  useCanvasStore.getState().fit()
}
