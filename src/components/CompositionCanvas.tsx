import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  boxCenter,
  canvasParts,
  normalizeAngle,
  objectTransform,
  toCanvas,
  toLocal,
  type CanvasObject,
  type Point,
  type Size,
} from '../lib/canvas'
import { COMPONENT_DRAG_TYPE, MAX_ZOOM, MIN_ZOOM, useCanvasStore, type View } from '../store/canvas'
import { useLibraryStore, type LibraryComponent } from '../store/library'

const HANDLE = 8
const ROTATE_OFFSET = 24
const ROTATE_STEP = 15
const CORNERS = { nw: [0, 0], ne: [1, 0], se: [1, 1], sw: [0, 1] } as const
type Corner = keyof typeof CORNERS

type Drag =
  | { kind: 'move'; id: string; start: Point; origin: Point }
  | { kind: 'scale'; id: string; anchor: Point; anchorLocal: Point; diagonal: Point; startScale: number }
  | { kind: 'rotate'; id: string; center: Point }
  | { kind: 'pan'; start: Point; view: View }

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable)

const MOVES: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/** Zooms so that the stage point `p` stays over the same canvas point. */
function zoomAt(p: Point, zoom: number) {
  const { view, setView } = useCanvasStore.getState()
  const next = clampZoom(zoom)
  const k = next / view.zoom
  setView({ zoom: next, x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k })
}

const CanvasItem = memo(function CanvasItem({ obj, component }: { obj: CanvasObject; component: LibraryComponent }) {
  const html = useMemo(() => ({ __html: canvasParts(component).markup }), [component])
  return <g data-object-id={obj.id} transform={objectTransform(obj, component)} dangerouslySetInnerHTML={html} />
})

/** Drawn in screen pixels, so line and handle sizes do not depend on zoom. */
function SelectionFrame({ obj, size, view }: { obj: CanvasObject; size: Size; view: View }) {
  const locked = obj.locked === true
  const screen = (u: number, v: number) => {
    const p = toCanvas(obj, size, u, v)
    return { x: view.x + p.x * view.zoom, y: view.y + p.y * view.zoom }
  }
  const center = screen(size.width / 2, size.height / 2)
  const corners = (Object.keys(CORNERS) as Corner[]).map((corner) => {
    const [u, v] = CORNERS[corner]
    return { corner, ...screen(u * size.width, v * size.height) }
  })
  const top = screen(size.width / 2, 0)
  const rad = (obj.rotation * Math.PI) / 180
  const knob = { x: top.x + Math.sin(rad) * ROTATE_OFFSET, y: top.y - Math.cos(rad) * ROTATE_OFFSET }

  const box = corners.map((c) => `${c.x},${c.y}`).join(' ')
  // A locked object shows where it is, without handles to grab.
  if (locked) return <polygon className="frame-box frame-locked" points={box} />

  return (
    <g>
      <polygon className="frame-box" points={box} />
      <line className="frame-box" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} />
      {corners.map((c) => (
        <rect
          key={c.corner}
          data-handle={c.corner}
          className="frame-handle"
          style={{ cursor: (c.x - center.x) * (c.y - center.y) > 0 ? 'nwse-resize' : 'nesw-resize' }}
          x={c.x - HANDLE / 2}
          y={c.y - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
        >
          <title>Масштаб с сохранением пропорций</title>
        </rect>
      ))}
      <circle data-handle="rotate" className="frame-handle frame-rotate" cx={knob.x} cy={knob.y} r={HANDLE / 2 + 1}>
        <title>Поворот (Shift — шаг 15°)</title>
      </circle>
    </g>
  )
}

export function CompositionCanvas() {
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const { size, objects, selectedId, stage, view, select, update, add, setStage } = useCanvasStore()
  const components = useLibraryStore((s) => s.components)
  const loadLibrary = useLibraryStore((s) => s.load)

  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])
  const visible = objects.filter((o) => byId.has(o.componentId) && !o.hidden)
  const selected = visible.find((o) => o.id === selectedId)

  // Each component's definitions once, however many instances it has.
  const defsKey = [...new Set(visible.map((o) => o.componentId))].join(' ')
  const defs = useMemo(
    () => ({ __html: defsKey ? defsKey.split(' ').map((id) => canvasParts(byId.get(id)!).defs).join('') : '' }),
    [byId, defsKey],
  )

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    // Opening the composition always shows the whole page; measure now to skip a stale first frame.
    useCanvasStore.setState({ autoFit: true })
    setStage({ width: el.clientWidth, height: el.clientHeight })
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStage({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setStage])

  const stagePoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = stageRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const canvasPoint = (p: Point): Point => {
    const { view } = useCanvasStore.getState()
    return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom }
  }

  // Wheel and Safari pinch need non-passive listeners to stop the page from scrolling or zooming.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    let gestureZoom: number | null = null
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (gestureZoom !== null) return
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
      // Pinch arrives as ctrl+wheel with small deltas; a mouse notch is about 100.
      const k = e.ctrlKey ? 0.01 : 0.0015
      zoomAt(stagePoint(e), useCanvasStore.getState().view.zoom * Math.exp(-delta * k))
    }
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number }
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureZoom = useCanvasStore.getState().view.zoom
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureEvent
      if (gestureZoom !== null) zoomAt(stagePoint(g), gestureZoom * g.scale)
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      gestureZoom = null
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if (e.code === 'Space') {
        e.preventDefault()
        setSpaceDown(true)
        return
      }
      const canvas = useCanvasStore.getState()
      const obj = canvas.objects.find((o) => o.id === canvas.selectedId)
      // Physical keys, so shortcuts work in any keyboard layout.
      if (e.metaKey || e.ctrlKey) {
        if (e.code === 'KeyZ') {
          if (e.shiftKey) canvas.redo()
          else canvas.undo()
        } else if (e.code === 'KeyD') canvas.duplicate()
        else if (e.code === 'BracketRight' && obj) canvas.reorder(obj.id, e.shiftKey ? 'front' : 'forward')
        else if (e.code === 'BracketLeft' && obj) canvas.reorder(obj.id, e.shiftKey ? 'back' : 'backward')
        else return
        e.preventDefault()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && obj) canvas.remove(obj.id)
      else if (e.code === 'KeyH' && !e.altKey && obj) canvas.flip(obj.id)
      else if (e.key === 'Escape') canvas.select(null)
      else if (e.key in MOVES && obj && !obj.locked) {
        const step = e.shiftKey ? 10 : 1
        const move = MOVES[e.key]
        canvas.update(obj.id, { x: obj.x + move.x * step, y: obj.y + move.y * step }, `nudge:${obj.id}`)
      } else return
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      // Otherwise a focused button would be pressed by the space bar.
      if (!isTyping(e.target)) e.preventDefault()
      setSpaceDown(false)
    }
    const onBlur = () => setSpaceDown(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    const p = stagePoint(e)
    const c = canvasPoint(p)
    const target = e.target as Element
    let drag: Drag | null = null

    if (spaceDown || e.button === 1) {
      drag = { kind: 'pan', start: p, view }
      setPanning(true)
    } else {
      const handle = target.closest('[data-handle]')?.getAttribute('data-handle')
      const component = selected && byId.get(selected.componentId)
      if (handle && selected && component && !selected.locked) {
        if (handle === 'rotate') {
          drag = { kind: 'rotate', id: selected.id, center: boxCenter(selected, component) }
        } else {
          const [u, v] = CORNERS[handle as Corner]
          const anchorLocal = { x: (1 - u) * component.width, y: (1 - v) * component.height }
          const anchor = toCanvas(selected, component, anchorLocal.x, anchorLocal.y)
          const corner = toCanvas(selected, component, u * component.width, v * component.height)
          drag = {
            kind: 'scale',
            id: selected.id,
            anchor,
            anchorLocal,
            diagonal: { x: corner.x - anchor.x, y: corner.y - anchor.y },
            startScale: selected.scale,
          }
        }
      } else {
        let id = target.closest('[data-object-id]')?.getAttribute('data-object-id') ?? null
        // Transparent parts of the selected object still grab it.
        if (!id && selected && component) {
          const local = toLocal(selected, component, c)
          if (local.x >= 0 && local.y >= 0 && local.x <= component.width && local.y <= component.height) id = selected.id
        }
        const obj = id ? visible.find((o) => o.id === id) : undefined
        select(obj?.id ?? null)
        if (obj && !obj.locked) drag = { kind: 'move', id: obj.id, start: c, origin: { x: obj.x, y: obj.y } }
      }
    }
    if (!drag) return
    if (drag.kind !== 'pan') useCanvasStore.getState().beginGesture()
    dragRef.current = drag
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const p = stagePoint(e)
    if (drag.kind === 'pan') {
      useCanvasStore.getState().setView({
        zoom: drag.view.zoom,
        x: drag.view.x + p.x - drag.start.x,
        y: drag.view.y + p.y - drag.start.y,
      })
      return
    }
    const c = canvasPoint(p)
    const obj = useCanvasStore.getState().objects.find((o) => o.id === drag.id)
    const component = obj && byId.get(obj.componentId)
    if (!obj || !component) return
    if (drag.kind === 'move') {
      update(obj.id, { x: drag.origin.x + c.x - drag.start.x, y: drag.origin.y + c.y - drag.start.y })
    } else if (drag.kind === 'scale') {
      // Project the pointer on the start diagonal: proportional scale around the opposite corner.
      const { diagonal: d, anchor } = drag
      const k = ((c.x - anchor.x) * d.x + (c.y - anchor.y) * d.y) / (d.x * d.x + d.y * d.y)
      const scale = Math.max(0.01, drag.startScale * k)
      const moved = toCanvas({ ...obj, scale, x: 0, y: 0 }, component, drag.anchorLocal.x, drag.anchorLocal.y)
      update(obj.id, { scale, x: anchor.x - moved.x, y: anchor.y - moved.y })
    } else {
      let angle = (Math.atan2(c.y - drag.center.y, c.x - drag.center.x) * 180) / Math.PI + 90
      if (e.shiftKey) angle = Math.round(angle / ROTATE_STEP) * ROTATE_STEP
      update(obj.id, { rotation: normalizeAngle(angle) })
    }
  }

  const endDrag = () => {
    if (dragRef.current && dragRef.current.kind !== 'pan') useCanvasStore.getState().endGesture()
    dragRef.current = null
    setPanning(false)
  }

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(COMPONENT_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (e: React.DragEvent) => {
    const component = byId.get(e.dataTransfer.getData(COMPONENT_DRAG_TYPE))
    if (!component) return
    e.preventDefault()
    add(component, canvasPoint(stagePoint(e)))
  }

  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : undefined
  const ready = stage.width > 0 && stage.height > 0

  return (
    <div
      ref={stageRef}
      className="workspace-stage canvas-stage"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {ready && (
        <svg
          className="canvas-svg"
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`${-view.x / view.zoom} ${-view.y / view.zoom} ${stage.width / view.zoom} ${stage.height / view.zoom}`}
          preserveAspectRatio="xMinYMin meet"
        >
          <defs dangerouslySetInnerHTML={defs} />
          <rect className="canvas-page" width={size.width} height={size.height} />
          {visible.map((obj) => (
            <CanvasItem key={obj.id} obj={obj} component={byId.get(obj.componentId)!} />
          ))}
        </svg>
      )}
      {ready && (
        <svg className="canvas-overlay" aria-hidden="true">
          {selected && <SelectionFrame obj={selected} size={byId.get(selected.componentId)!} view={view} />}
        </svg>
      )}
      {objects.length === 0 && (
        <p className="canvas-hint">Перетащите компонент из библиотеки на холст или щёлкните по нему.</p>
      )}
    </div>
  )
}
