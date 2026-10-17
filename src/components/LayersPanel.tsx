import { useMemo, useRef, useState } from 'react'
import type { CanvasObject } from '../lib/canvas'
import { componentSvg } from '../lib/extract'
import { useCanvasStore } from '../store/canvas'
import { useLibraryStore, type LibraryComponent } from '../store/library'
import { EyeIcon, EyeOffIcon, LockIcon, UnlockIcon } from './icons'

/** dataTransfer type of a layer row being dragged to a new place in the list. */
const LAYER_DRAG_TYPE = 'application/x-svg-composer-layer'

type Drop = { id: string; side: 'above' | 'below' }

function LayerThumb({ component }: { component: LibraryComponent | undefined }) {
  const src = useMemo(
    () => component && `data:image/svg+xml;charset=utf-8,${encodeURIComponent(componentSvg(component))}`,
    [component],
  )
  return <span className="layer-thumb">{src && <img src={src} alt="" draggable={false} />}</span>
}

function LayerName({ obj, editing, onEditing }: { obj: CanvasObject; editing: boolean; onEditing: (on: boolean) => void }) {
  const [draft, setDraft] = useState(obj.name)
  const cancelled = useRef(false)
  const update = useCanvasStore((s) => s.update)

  const commit = () => {
    const name = draft.trim()
    if (!cancelled.current && name && name !== obj.name) update(obj.id, { name })
    onEditing(false)
  }

  if (!editing) {
    return (
      <span
        className="layer-name"
        title={`${obj.name} — двойной клик, чтобы переименовать`}
        onDoubleClick={() => {
          setDraft(obj.name)
          cancelled.current = false
          onEditing(true)
        }}
      >
        {obj.name}
      </span>
    )
  }
  return (
    <input
      className="input layer-rename"
      value={draft}
      autoFocus
      maxLength={80}
      aria-label="Название слоя"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancelled.current = true
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}

/** Canvas objects, topmost first: click selects, drag reorders, double click renames. */
export function LayersPanel() {
  const { objects, selectedId, select, update, placeNextTo } = useCanvasStore()
  const components = useLibraryStore((s) => s.components)
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (objects.length === 0) return <p className="empty">На холсте пока нет объектов.</p>

  const dropSide = (e: React.DragEvent<HTMLElement>): Drop['side'] => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? 'above' : 'below'
  }

  const endDrag = () => {
    setDragId(null)
    setDrop(null)
  }

  // Topmost first: the canvas paint order reversed.
  return (
    <ul className="layer-list" aria-label="Слои">
      {[...objects].reverse().map((obj) => {
        const classes = ['layer-row']
        if (obj.id === selectedId) classes.push('layer-active')
        if (obj.hidden) classes.push('layer-hidden')
        if (obj.id === dragId) classes.push('layer-dragging')
        if (drop?.id === obj.id) classes.push(`layer-drop-${drop.side}`)
        return (
          <li
            key={obj.id}
            className={classes.join(' ')}
            data-layer-id={obj.id}
            draggable={obj.id !== editingId}
            onClick={() => select(obj.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData(LAYER_DRAG_TYPE, obj.id)
              e.dataTransfer.effectAllowed = 'move'
              setDragId(obj.id)
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(LAYER_DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const side = dropSide(e)
              if (drop?.id !== obj.id || drop.side !== side) setDrop({ id: obj.id, side })
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(LAYER_DRAG_TYPE)
              if (!id) return
              e.preventDefault()
              placeNextTo(id, obj.id, dropSide(e))
              endDrag()
            }}
            onDragEnd={endDrag}
          >
            <LayerThumb component={byId.get(obj.componentId)} />
            <LayerName obj={obj} editing={obj.id === editingId} onEditing={(on) => setEditingId(on ? obj.id : null)} />
            <button
              className={obj.hidden ? 'layer-toggle layer-toggle-on' : 'layer-toggle'}
              title={obj.hidden ? 'Показать' : 'Скрыть'}
              aria-label={obj.hidden ? 'Показать' : 'Скрыть'}
              aria-pressed={obj.hidden === true}
              onClick={(e) => {
                e.stopPropagation()
                update(obj.id, { hidden: !obj.hidden })
              }}
            >
              {obj.hidden ? <EyeOffIcon /> : <EyeIcon />}
            </button>
            <button
              className={obj.locked ? 'layer-toggle layer-toggle-on' : 'layer-toggle'}
              title={obj.locked ? 'Разблокировать' : 'Заблокировать от перемещения'}
              aria-label={obj.locked ? 'Разблокировать' : 'Заблокировать'}
              aria-pressed={obj.locked === true}
              onClick={(e) => {
                e.stopPropagation()
                update(obj.id, { locked: !obj.locked })
              }}
            >
              {obj.locked ? <LockIcon /> : <UnlockIcon />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
