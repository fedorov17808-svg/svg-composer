import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Rect } from '../lib/selection'
import { collectGroups } from '../lib/svgGroups'
import { clickHover, selectionUnits, useEditorStore, type ClickTarget } from '../store/editor'
import { assetUrl, useSourcesStore, type SourceInfo } from '../store/sources'

const STAGE_PADDING = 24
/** Pointer travel (px) after which a press becomes a marquee drag. */
const DRAG_THRESHOLD = 3
const svgCache = new Map<string, Promise<string>>()

function fetchSvg(file: string) {
  let text = svgCache.get(file)
  if (!text) {
    text = fetch(assetUrl(file)).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })
    text.catch(() => svgCache.delete(file))
    svgCache.set(file, text)
  }
  return text
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** Drawn in screen pixels (not viewBox units), so stroke width and dashes do not depend on zoom. */
function Box({ node, kind, scale, vbX, vbY }: { node: Rect; kind: 'hover' | 'selected' | 'marquee'; scale: number; vbX: number; vbY: number }) {
  return (
    <rect
      className={`overlay-box overlay-${kind}`}
      x={(node.x - vbX) * scale}
      y={(node.y - vbY) * scale}
      width={node.width * scale}
      height={node.height * scale}
    />
  )
}

interface Press {
  start: { x: number; y: number }
  /** Marquee if the pointer moves: pressed on empty space or with Alt. */
  marquee: boolean
  dragging: boolean
}

export function SourceViewer({ source }: { source: SourceInfo }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const elementsRef = useRef(new Map<Element, number>())
  const leavesRef = useRef(new Map<Element, number>())
  const pressRef = useRef<Press | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const stage = useElementSize(stageRef)
  const [markup, setMarkup] = useState<{ file: string; html: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const editor = useEditorStore()
  const { hover, setNodes, setHover } = editor

  useEffect(() => {
    let cancelled = false
    fetchSvg(source.file).then(
      (html) => !cancelled && setMarkup({ file: source.file, html }),
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      cancelled = true
    }
  }, [source.file])

  const [vbX, vbY, vbWidth, vbHeight] = source.viewBox.split(/[\s,]+/).map(Number)
  const scale = Math.max(0, Math.min((stage.width - STAGE_PADDING * 2) / vbWidth, (stage.height - STAGE_PADDING * 2) / vbHeight))
  const width = vbWidth * scale
  const height = vbHeight * scale

  const ready = markup?.file === source.file
  const html = useMemo(() => ({ __html: ready ? markup.html : '' }), [ready, markup])

  // Index the groups once the inline SVG is mounted and laid out.
  useLayoutEffect(() => {
    const svg = hostRef.current?.querySelector('svg')
    if (!ready || !svg || width === 0) return
    if (useEditorStore.getState().nodes.length > 0 && elementsRef.current.size > 0) return
    const index = collectGroups(svg)
    elementsRef.current = new Map(index.elements.map((el, i) => [el, i]))
    leavesRef.current = new Map(index.leafElements.map((el, i) => [el, i]))
    setNodes(index, useSourcesStore.getState().objects[source.id])
  }, [ready, html, width, setNodes, source.id])

  const indexAt = (map: Map<Element, number>, target: EventTarget | null) => {
    for (let el = target as Element | null; el && el !== hostRef.current; el = el.parentElement) {
      const index = map.get(el)
      if (index !== undefined) return index
    }
    return null
  }
  const groupAt = (target: EventTarget | null) => indexAt(elementsRef.current, target)
  const leafAt = (target: EventTarget | null) => indexAt(leavesRef.current, target)
  /** What a click on `target` starts from: a shape that is a part of an object, or its group. */
  const clickTarget = (target: EventTarget | null): ClickTarget | null => {
    const { leaves, leafObject, leafMark } = useEditorStore.getState()
    const group = groupAt(target)
    const leaf = leafAt(target)
    // A marked-up shape selects its own object, wherever it is drawn (a paw in front of a shop).
    if (leaf !== null && leafMark[leaf] >= 0) return { leaf }
    if (leaf !== null && leafObject[leaf] >= 0 && leaves[leaf].parent === (group ?? -1)) return { leaf }
    return group === null ? null : { group }
  }

  /** Client point → source viewBox units. */
  const toSource = (clientX: number, clientY: number) => {
    const rect = hostRef.current!.getBoundingClientRect()
    return { x: vbX + (clientX - rect.left) / scale, y: vbY + (clientY - rect.top) / scale }
  }

  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  })

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !hostRef.current) return
    const onShape = groupAt(e.target) !== null || leafAt(e.target) !== null
    pressRef.current = { start: { x: e.clientX, y: e.clientY }, marquee: e.altKey || !onShape, dragging: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    if (!press) {
      // Preview what a click would select.
      const state = useEditorStore.getState()
      const target = clickTarget(e.target)
      const next = target === null ? null : clickHover(state, target)
      if (next?.key !== hover?.key) setHover(next)
      return
    }
    const moved = Math.hypot(e.clientX - press.start.x, e.clientY - press.start.y) > DRAG_THRESHOLD
    if (!press.marquee || (!press.dragging && !moved)) return
    press.dragging = true
    if (hover !== null) setHover(null)
    setMarquee(rectFrom(toSource(press.start.x, press.start.y), toSource(e.clientX, e.clientY)))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    pressRef.current = null
    setMarquee(null)
    if (!press) return
    const store = useEditorStore.getState()
    if (press.dragging) {
      store.selectRect(rectFrom(toSource(press.start.x, press.start.y), toSource(e.clientX, e.clientY)), e.shiftKey)
      return
    }
    // Pointer capture retargets events to the stage; find what is under the pointer instead.
    const target = document.elementFromPoint(e.clientX, e.clientY)
    const clicked = clickTarget(target)
    const leaf = leafAt(target)
    if (e.altKey && e.shiftKey) {
      if (leaf !== null) store.deselectLeaf(leaf)
    } else if (clicked && 'leaf' in clicked) store.selectLeaf(clicked.leaf, e.shiftKey)
    else if (clicked) store.select(clicked.group, e.shiftKey)
    else if (leaf !== null) store.selectLeaf(leaf, e.shiftKey)
    else if (!e.shiftKey) store.clearSelection()
  }

  const box = { scale, vbX, vbY }
  // One frame per object, however many groups and shapes it is made of.
  const units = selectionUnits(editor)
  const hovered = hover && !units.some((u) => u.key === hover.key) ? hover.box : null

  return (
    <div
      ref={stageRef}
      className="workspace-stage source-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        pressRef.current = null
        setMarquee(null)
      }}
      onPointerLeave={() => !pressRef.current && setHover(null)}
    >
      {error && <p className="empty">Не удалось загрузить {source.file} ({error}).</p>}
      {!error && !ready && <p className="empty">Загрузка…</p>}
      {ready && (
        <div className="source-frame" style={{ width, height }}>
          <div ref={hostRef} className="source-host" dangerouslySetInnerHTML={html} />
          <svg className="source-overlay" aria-hidden="true">
            {units.map((u, i) => (
              <Box key={i} node={u.box} kind="selected" {...box} />
            ))}
            {hovered && <Box node={hovered} kind="hover" {...box} />}
            {marquee && <Box node={marquee} kind="marquee" {...box} />}
          </svg>
        </div>
      )}
    </div>
  )
}
