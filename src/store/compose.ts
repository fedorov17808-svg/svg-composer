import { composeObjects, type AutoSettings } from '../lib/compose'
import { useCanvasStore } from './canvas'
import { useObjectLibraryStore } from './objectLibrary'

/**
 * Lays out the objects on the current canvas, in its L/S size, and puts them in place of the
 * composition as one undo step. False while the library is not loaded or nothing is asked for.
 */
export function buildComposition(settings: AutoSettings): boolean {
  const { status, objects: library } = useObjectLibraryStore.getState()
  if (status !== 'ready' || settings.objectIds.length === 0) return false
  const canvas = useCanvasStore.getState()
  canvas.compose(composeObjects(settings, library, canvas.size, canvas.objectSize), { ...settings, size: canvas.size })
  return true
}

/** The canvas changed size since «Собрать»: the composition can be rebuilt for it with the same seed. */
export const needsRecompose = ({ auto, size }: { auto: { size: { width: number; height: number } } | null; size: { width: number; height: number } }) =>
  auto !== null && (auto.size.width !== size.width || auto.size.height !== size.height)
