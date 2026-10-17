import { create } from 'zustand'
import { flippedX, type CanvasObject, type Point, type Size } from '../lib/canvas'
import { emptyHistory, mapHistory, record, redo, undo, type History } from '../lib/history'
import { placeNextTo, reorder, type LayerMove } from '../lib/layers'
import type { LibraryComponent } from './library'

const STAGE_PADDING = 24
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 20
/** dataTransfer type used when a library tile is dragged onto the canvas. */
export const COMPONENT_DRAG_TYPE = 'application/x-svg-composer-component'

/** Screen position of a canvas point: `x + point.x * zoom`, relative to the stage. */
export interface View {
  zoom: number
  x: number
  y: number
}

/** Offset of a duplicate from its original, in canvas units. */
export const DUPLICATE_OFFSET = 20

/** What undo/redo restores. Selection comes back too, so undo shows what it changed. */
export type Snapshot = Pick<CanvasState, 'objects' | 'size' | 'selectedId'>

interface CanvasState {
  size: Size
  objects: CanvasObject[]
  selectedId: string | null
  stage: Size
  view: View
  /** The view follows the stage size until the user zooms or pans. */
  autoFit: boolean
  history: History<Snapshot>
  /** State before the current drag: the whole gesture becomes one undo step. */
  gesture: Snapshot | null
  /** Places a component at `at` (canvas units) or in the center of the visible area. */
  add: (component: LibraryComponent, at?: Point) => void
  /** Changes with the same `mergeKey` in quick succession make one undo step. */
  update: (id: string, patch: Partial<CanvasObject>, mergeKey?: string) => void
  select: (id: string | null) => void
  /** Copies the selected object with an offset, right above it, and selects the copy. */
  duplicate: () => void
  remove: (id: string) => void
  flip: (id: string) => void
  reorder: (id: string, move: LayerMove) => void
  placeNextTo: (id: string, targetId: string, side: 'above' | 'below') => void
  beginGesture: () => void
  endGesture: () => void
  undo: () => void
  redo: () => void
  removeComponent: (componentId: string) => void
  setSize: (size: Size) => void
  /** Replaces the whole composition (an opened project) as one undo step. */
  replace: (size: Size, objects: CanvasObject[]) => void
  setStage: (stage: Size) => void
  setView: (view: View) => void
  fit: () => void
}

const newId = () => 'o' + Math.random().toString(36).slice(2, 8)

const fitView = (size: Size, stage: Size): View => {
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min((stage.width - STAGE_PADDING * 2) / size.width, (stage.height - STAGE_PADDING * 2) / size.height),
  )
  return { zoom, x: (stage.width - size.width * zoom) / 2, y: (stage.height - size.height * zoom) / 2 }
}

/** A new object's longer side, as a share of the canvas height. */
const NEW_OBJECT_SHARE = 0.35

/** Center of the visible part of the page, in canvas units. */
function visibleCenter({ size, stage, view }: Pick<CanvasState, 'size' | 'stage' | 'view'>): Point {
  if (stage.width <= 0 || stage.height <= 0) return { x: size.width / 2, y: size.height / 2 }
  const x = (stage.width / 2 - view.x) / view.zoom
  const y = (stage.height / 2 - view.y) / view.zoom
  return { x: Math.min(size.width, Math.max(0, x)), y: Math.min(size.height, Math.max(0, y)) }
}

const snapshot = ({ objects, size, selectedId }: Snapshot): Snapshot => ({ objects, size, selectedId })

export const useCanvasStore = create<CanvasState>((set, get) => {
  /** Applies a change and records the state before it, unless a drag is collecting the changes. */
  const commit = (patch: Partial<Snapshot>, mergeKey?: string) => {
    const state = get()
    const changed =
      (patch.objects !== undefined && patch.objects !== state.objects) ||
      (patch.size !== undefined && patch.size !== state.size)
    if (!changed || state.gesture) set(patch)
    else set({ ...patch, history: record(state.history, snapshot(state), mergeKey) })
  }

  const restore = (step: { state: Snapshot; history: History<Snapshot> } | null) => {
    if (!step || get().gesture) return
    const sizeChanged = step.state.size !== get().size
    set({ ...step.state, history: step.history })
    if (sizeChanged) get().fit()
  }

  const selected = () => get().objects.find((o) => o.id === get().selectedId)

  return {
    size: { width: 1200, height: 800 },
    objects: [],
    selectedId: null,
    stage: { width: 0, height: 0 },
    view: { zoom: 1, x: 0, y: 0 },
    autoFit: true,
    history: emptyHistory(),
    gesture: null,
    add: (component, at) => {
      const { size, objects } = get()
      // Same visual size for every component, whatever its size in the source.
      const scale = (size.height * NEW_OBJECT_SHARE) / Math.max(component.width, component.height)
      const center = at ?? visibleCenter(get())
      const obj: CanvasObject = {
        id: newId(),
        componentId: component.id,
        name: component.name,
        x: center.x - (component.width * scale) / 2,
        y: center.y - (component.height * scale) / 2,
        scale,
        rotation: 0,
        flipX: false,
      }
      commit({ objects: [...objects, obj], selectedId: obj.id })
    },
    update: (id, patch, mergeKey) =>
      commit({ objects: get().objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }, mergeKey),
    select: (selectedId) => set({ selectedId }),
    duplicate: () => {
      const obj = selected()
      if (!obj) return
      const { objects } = get()
      // A locked copy could not be moved off its original.
      const copy = { ...obj, id: newId(), x: obj.x + DUPLICATE_OFFSET, y: obj.y + DUPLICATE_OFFSET, locked: false }
      const index = objects.indexOf(obj) + 1
      commit({ objects: [...objects.slice(0, index), copy, ...objects.slice(index)], selectedId: copy.id })
    },
    remove: (id) => {
      const { objects, selectedId } = get()
      commit({ objects: objects.filter((o) => o.id !== id), selectedId: selectedId === id ? null : selectedId })
    },
    flip: (id) => {
      const obj = get().objects.find((o) => o.id === id)
      if (obj && !obj.locked) get().update(id, flippedX(obj))
    },
    reorder: (id, move) => commit({ objects: reorder(get().objects, id, move) }),
    placeNextTo: (id, targetId, side) => commit({ objects: placeNextTo(get().objects, id, targetId, side) }),
    beginGesture: () => set({ gesture: snapshot(get()) }),
    endGesture: () => {
      const { gesture, objects, history } = get()
      if (!gesture) return
      set({ gesture: null, history: gesture.objects !== objects ? record(history, gesture) : history })
    },
    undo: () => restore(undo(get().history, snapshot(get()))),
    redo: () => restore(redo(get().history, snapshot(get()))),
    removeComponent: (componentId) => {
      // Not an undo step: the component is gone, so its instances cannot come back either.
      const keep = (s: Snapshot): Snapshot => {
        const objects = s.objects.filter((o) => o.componentId !== componentId)
        if (objects.length === s.objects.length) return s
        return { ...s, objects, selectedId: objects.some((o) => o.id === s.selectedId) ? s.selectedId : null }
      }
      set({ ...keep(snapshot(get())), history: mapHistory(get().history, keep) })
    },
    setSize: (size) => {
      commit({ size }, 'size')
      get().fit()
    },
    replace: (size, objects) => {
      commit({ size, objects, selectedId: null })
      get().fit()
    },
    setStage: (stage) => {
      set({ stage })
      if (get().autoFit) get().fit()
    },
    setView: (view) => set({ view, autoFit: false }),
    fit: () => {
      const { size, stage } = get()
      if (stage.width > 0 && stage.height > 0) set({ view: fitView(size, stage), autoFit: true })
    },
  }
})
