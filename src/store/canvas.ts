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

export const useCanvasStore = create<CanvasState>((set, get) => ({
  size: { width: 1200, height: 800 },
  objects: [],
  selectedId: null,
  stage: { width: 0, height: 0 },
  view: { zoom: 1, x: 0, y: 0 },
  autoFit: true,
  add: (component, at) => {
    const { size, objects } = get()
    // Components keep source units; shrink only those that would not fit comfortably.
    const scale = Math.min(1, (size.width * 0.6) / component.width, (size.height * 0.6) / component.height)
    const center = at ?? { x: size.width / 2, y: size.height / 2 }
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
