import { useEffect, useMemo, useState } from 'react'
import { componentSvg } from '../lib/extract'
import { COMPONENT_DRAG_TYPE, useCanvasStore } from '../store/canvas'
import { useLibraryStore, type LibraryComponent } from '../store/library'
import { useSourcesStore } from '../store/sources'
import { useUiStore } from '../store/ui'

const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M11.3 2.3a1.4 1.4 0 0 1 2 2L5.5 12.1 2.5 13l.9-3 7.9-7.7Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function LibraryTile({ component }: { component: LibraryComponent }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(component.name)
  const { rename, remove } = useLibraryStore()
  const source = useSourcesStore((s) => s.sources.find((item) => item.id === component.sourceId))
  // A data URL isolates each preview, so ids never clash with the open source or other tiles.
  const src = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(componentSvg(component))}`, [component])

  const commit = () => {
    setEditing(false)
    const name = draft.trim()
    if (name) void rename(component.id, name)
    else setDraft(component.name)
  }

  const place = () => {
    const { workspaceMode, setWorkspaceMode } = useUiStore.getState()
    const canvas = useCanvasStore.getState()
    // A canvas that is not shown yet will open fitted, so its visible center is the page center.
    if (workspaceMode === 'composition') canvas.add(component)
    else canvas.add(component, { x: canvas.size.width / 2, y: canvas.size.height / 2 })
    setWorkspaceMode('composition')
  }

  return (
    <li
      className="library-tile"
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(COMPONENT_DRAG_TYPE, component.id)
        e.dataTransfer.effectAllowed = 'copy'
        const img = e.currentTarget.querySelector('img')
        if (img) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2)
      }}
    >
      <button className="library-preview" onClick={place} title="Добавить в центр холста или перетащить на холст">
        <img src={src} alt="" draggable={false} />
      </button>
      {editing ? (
        <input
          className="input library-rename"
          value={draft}
          autoFocus
          maxLength={80}
          aria-label="Новое название"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              setDraft(component.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <span className="library-name" title={component.name}>
          {component.name}
        </span>
      )}
      <span className="library-source" title={source?.title}>
        {component.sourceId.slice(1)} · {source?.title ?? ''}
      </span>
      <span className="library-actions">
        <button
          className="icon-btn"
          title="Переименовать"
          aria-label="Переименовать"
          onClick={() => {
            setDraft(component.name)
            setEditing(true)
          }}
        >
          <PencilIcon />
        </button>
        <button
          className="icon-btn icon-danger"
          title="Удалить из библиотеки"
          aria-label="Удалить"
          onClick={() => void remove(component.id)}
        >
          <TrashIcon />
        </button>
      </span>
    </li>
  )
}

export function LibraryGrid() {
  const { status, error, components, load } = useLibraryStore()
  const loadSources = useSourcesStore((s) => s.load)

  useEffect(() => {
    void load()
    void loadSources()
  }, [load, loadSources])

  if (status === 'error') return <p className="empty">Не удалось открыть библиотеку ({error}).</p>
  if (status !== 'ready') return <p className="empty">Загрузка библиотеки…</p>
  if (components.length === 0) {
    return (
      <p className="empty">
        Библиотека пуста. Откройте исходник, выделите элемент и сохраните его как компонент.
      </p>
    )
  }

  return (
    <ul className="source-grid" aria-label="Компоненты библиотеки">
      {components.map((component) => (
        <LibraryTile key={component.id} component={component} />
      ))}
    </ul>
  )
}
