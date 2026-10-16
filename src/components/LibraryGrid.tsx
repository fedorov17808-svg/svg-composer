import { useEffect, useMemo, useState } from 'react'
import { componentSvg } from '../lib/extract'
import { useLibraryStore, type LibraryComponent } from '../store/library'
import { useSourcesStore } from '../store/sources'

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

  return (
    <li className="library-tile">
      <img src={src} alt={component.name} draggable={false} />
      {editing ? (
        <input
          className="input"
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
        из {component.sourceId.slice(1)} {source?.title ?? ''}
      </span>
      <span className="library-actions">
        <button
          className="link-btn"
          onClick={() => {
            setDraft(component.name)
            setEditing(true)
          }}
        >
          Переименовать
        </button>
        <button className="link-btn link-danger" onClick={() => void remove(component.id)}>
          Удалить
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
