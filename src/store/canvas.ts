import { create } from 'zustand'
import type { CanvasObject, Point, Size } from '../lib/canvas'
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

interface CanvasState {
  size: Size
  objects: CanvasObject[]
  selectedId: string | null
  stage: Size
  view: View
  /** The view follows the stage size until the user zooms or pans. */
  autoFit: boolean
  /** Places a component at `at` (canvas units) or in the center of the visible area. */
  add: (component: LibraryComponent, at?: Point) => void
  update: (id: string, patch: Partial<CanvasObject>) => void
  select: (id: string | null) => void
  removeComponent: (componentId: string) => void
  setSize: (size: Size) => void
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

export const useCanvasStore = create<CanvasState>((set, get) => ({
  size: { width: 1200, height: 800 },
  objects: [],
  selectedId: null,
  stage: { width: 0, height: 0 },
  view: { zoom: 1, x: 0, y: 0 },
  autoFit: true,
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
    set({ objects: [...objects, obj], selectedId: obj.id })
  },
  update: (id, patch) => set({ objects: get().objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }),
  select: (selectedId) => set({ selectedId }),
  removeComponent: (componentId) => {
    const objects = get().objects.filter((o) => o.componentId !== componentId)
    const selectedId = objects.some((o) => o.id === get().selectedId) ? get().selectedId : null
    set({ objects, selectedId })
  },
  setSize: (size) => {
    set({ size })
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
}))
