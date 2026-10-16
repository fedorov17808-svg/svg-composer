import { useEffect } from 'react'
import { assetUrl, useSourcesStore } from '../store/sources'

export function SourcesGrid() {
  const { status, error, sources, load } = useSourcesStore()

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
        <li key={source.id} className="source-tile" title={source.title}>
          <img src={assetUrl(source.file)} alt={source.title} loading="lazy" draggable={false} />
          <span className="source-caption">
            <span className="source-num">{source.id.slice(1)}</span> {source.title}
          </span>
        </li>
      ))}
    </ul>
  )
}
