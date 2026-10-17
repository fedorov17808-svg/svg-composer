import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Rect } from '../lib/selection'
import { collectGroups } from '../lib/svgGroups'
import { unionRects } from '../lib/extract'
import { objectMembers } from '../lib/objects'
import { byAnchor, clickedObject, useEditorStore } from '../store/editor'
import { assetUrl, type SourceInfo } from '../store/sources'

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

  const { nodes, owners, leaves, hover, selection, selectedLeaves, setNodes, setHover } = useEditorStore()

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
    setNodes(index)
  }, [ready, html, width, setNodes])

  const indexAt = (map: Map<Element, number>, target: EventTarget | null) => {
    for (let el = target as Element | null; el && el !== hostRef.current; el = el.parentElement) {
      const index = map.get(el)
      if (index !== undefined) return index
    }
    return null
  }
  const groupAt = (target: EventTarget | null) => indexAt(elementsRef.current, target)
  const leafAt = (target: EventTarget | null) => indexAt(leavesRef.current, target)

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
      const clicked = groupAt(e.target)
      const index = clicked === null ? null : owners[clickedObject(nodes, owners, clicked)[0]]
      if (index !== hover) setHover(index)
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
    const group = groupAt(target)
    const leaf = leafAt(target)
    if (e.altKey && e.shiftKey) {
      if (leaf !== null) store.deselectLeaf(leaf)
    } else if (group !== null) store.select(group, e.shiftKey)
    else if (leaf !== null) store.selectLeaf(leaf, e.shiftKey)
    else if (!e.shiftKey) store.clearSelection()
  }

  const box = { scale, vbX, vbY }
  // One frame per click: an object's parts share the anchor.
  const selectedBoxes = byAnchor(selection).flatMap((items) => {
    const rects = items.map((item) => nodes[item.node]).filter(Boolean)
    return rects.length ? [unionRects(rects)] : []
  })

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
            {selectedBoxes.map((rect, i) => (
              <Box key={i} node={rect} kind="selected" {...box} />
            ))}
            {selectedLeaves.map((l) => leaves[l] && <Box key={`l${l}`} node={leaves[l]} kind="selected" {...box} />)}
            {hover !== null && nodes[hover] && !selection.some((item) => item.node === hover) && (
              <Box node={unionRects(objectMembers(owners, hover).map((n) => nodes[n]))} kind="hover" {...box} />
            )}
            {marquee && <Box node={marquee} kind="marquee" {...box} />}
          </svg>
        </div>
      )}
    </div>
  )
}
