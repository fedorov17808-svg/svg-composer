import { useEffect } from 'react'
import { useEditorStore } from '../store/editor'
import { assetUrl, useSourcesStore } from '../store/sources'
import { useUiStore } from '../store/ui'

export function SourcesGrid() {
  const { status, error, sources, load } = useSourcesStore()
  const openSourceId = useEditorStore((s) => s.openSourceId)
  const open = useEditorStore((s) => s.open)

  useEffect(() => {
    void load()
  }, [load])

  if (status === 'error') {
    return (
      <p className="empty">
        Не удалось загрузить список исходников ({error}). Запустите <code>npm run prepare-svg</code>.
      </p>
    )
  }
  if (status !== 'ready') return <p className="empty">Загрузка исходников…</p>

  return (
    <ul className="source-grid" aria-label="Исходные иллюстрации">
      {sources.map((source) => (
        <li key={source.id}>
          <button
            className={source.id === openSourceId ? 'source-tile source-tile-active' : 'source-tile'}
            title={source.title}
            aria-pressed={source.id === openSourceId}
            onClick={() => {
              open(source.id)
              useUiStore.getState().setWorkspaceMode('source')
            }}
          >
            <img src={assetUrl(source.file)} alt={source.title} loading="lazy" draggable={false} />
            <span className="source-caption">
              <span className="source-num">{source.id.slice(1)}</span> {source.title}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
