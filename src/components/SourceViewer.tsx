import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { collectGroups, type GroupNode } from '../lib/svgGroups'
import { useEditorStore } from '../store/editor'
import { assetUrl, type SourceInfo } from '../store/sources'

const STAGE_PADDING = 24
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
function Box({ node, kind, scale, vbX, vbY }: { node: GroupNode; kind: 'hover' | 'selected'; scale: number; vbX: number; vbY: number }) {
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

export function SourceViewer({ source }: { source: SourceInfo }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const elementsRef = useRef(new Map<Element, number>())
  const stage = useElementSize(stageRef)
  const [markup, setMarkup] = useState<{ file: string; html: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { nodes, hover, selection, setNodes, setHover, select, clearSelection } = useEditorStore()

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
    const { nodes, elements } = collectGroups(svg)
    elementsRef.current = new Map(elements.map((el, i) => [el, i]))
    setNodes(nodes)
  }, [ready, html, width, setNodes])

  const groupAt = (target: EventTarget | null) => {
    for (let el = target as Element | null; el && el !== hostRef.current; el = el.parentElement) {
      const index = elementsRef.current.get(el)
      if (index !== undefined) return index
    }
    return null
  }

  return (
    <div
      ref={stageRef}
      className="workspace-stage"
      onClick={(e) => e.target === e.currentTarget && clearSelection()}
    >
      {error && <p className="empty">Не удалось загрузить {source.file} ({error}).</p>}
      {!error && !ready && <p className="empty">Загрузка…</p>}
      {ready && (
        <div className="source-frame" style={{ width, height }}>
          <div
            ref={hostRef}
            className="source-host"
            dangerouslySetInnerHTML={html}
            onPointerMove={(e) => {
              const index = groupAt(e.target)
              if (index !== hover) setHover(index)
            }}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              const index = groupAt(e.target)
              if (index !== null) select(index, e.shiftKey)
              else if (!e.shiftKey) clearSelection()
            }}
          />
          <svg className="source-overlay" aria-hidden="true">
            {selection.map(
              ({ node }) =>
                nodes[node] && <Box key={node} node={nodes[node]} kind="selected" {...{ scale, vbX, vbY }} />,
            )}
            {hover !== null && nodes[hover] && !selection.some((item) => item.node === hover) && (
              <Box node={nodes[hover]} kind="hover" {...{ scale, vbX, vbY }} />
            )}
          </svg>
        </div>
      )}
    </div>
  )
}
