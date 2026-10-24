import type { LibraryObject } from '../store/objectLibrary'
import { autoLayout, BACKGROUND_AMOUNTS, type BackgroundAmount } from './autoLayout'
import type { CanvasObject, Size } from './canvas'
import { versionId, type ObjectSize } from './libraryObjects'

/** What an automatic composition was built from; the same settings give the same composition. */
export interface AutoSettings {
  objectIds: string[]
  background: BackgroundAmount
  seed: number
}

let counter = 0
const newId = () => 'o' + Math.random().toString(36).slice(2, 6) + (counter++).toString(36)

/**
 * The automatic composition as ordinary canvas objects in the versions of `objectSize`. The layout
 * works on the L proportions (S has the same), so L and S give the same composition.
 */
export function composeObjects(settings: AutoSettings, library: LibraryObject[], canvas: Size, objectSize: ObjectSize): CanvasObject[] {
  const byId = new Map(library.map((o) => [o.id, o]))
  const source = (o: LibraryObject) => ({ id: o.id, main: o.versions.L.main, bg: o.versions.L.bg })
  const objects = settings.objectIds.map((id) => byId.get(id)).filter((o): o is LibraryObject => !!o)
  return autoLayout({ objects: objects.map(source), library: library.map(source), canvas, background: settings.background, seed: settings.seed }).map((p) => {
    const object = byId.get(p.objectId)!
    const version = object.versions[objectSize][p.state]
    return {
      id: newId(),
      componentId: versionId(object.id, objectSize, p.state),
      name: object.name,
      x: p.x,
      y: p.y,
      scale: p.width / version.width,
      rotation: 0,
      flipX: false,
    }
  })
}

/** Settings of an automatic composition from a file or the autosave, or null if they do not fit. */
export function parseAuto(value: unknown): (AutoSettings & { size: Size }) | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const size = v.size as Record<string, unknown> | undefined
  const ok =
    Array.isArray(v.objectIds) &&
    v.objectIds.every((id) => typeof id === 'string') &&
    BACKGROUND_AMOUNTS.some((a) => a.id === v.background) &&
    Number.isInteger(v.seed) &&
    typeof size?.width === 'number' &&
    typeof size?.height === 'number' &&
    size.width > 0 &&
    size.height > 0
  if (!ok) return null
  return {
    objectIds: [...(v.objectIds as string[])],
    background: v.background as BackgroundAmount,
    seed: v.seed as number,
    size: { width: size.width as number, height: size.height as number },
  }
}
