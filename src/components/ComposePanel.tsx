import { useState } from 'react'
import { BACKGROUND_AMOUNTS, MAX_MAIN, type BackgroundAmount } from '../lib/autoLayout'
import { normalizeName, parseNames, type NameMatch } from '../lib/objectNames'
import { useCanvasStore } from '../store/canvas'
import { buildComposition, needsRecompose } from '../store/compose'
import { useObjectLibraryStore } from '../store/objectLibrary'
import { Segmented } from './Segmented'

const nameText = (matches: NameMatch[]) => matches.map((m) => m.text).join(', ')

/**
 * Scenario 2: names of objects in, a composition out. Chips show what was recognized (× removes
 * it), a hint for an unknown name and the objects not asked for yet.
 */
export function ComposePanel() {
  const library = useObjectLibraryStore((s) => s.objects)
  const auto = useCanvasStore((s) => s.auto)
  const recompose = useCanvasStore(needsRecompose)
  // Until edited, the names of the built composition (the library may load after the first render).
  const [edited, setText] = useState<string | null>(null)
  const text = edited ?? (auto ? auto.objectIds.map((id) => library.find((o) => o.id === id)?.name.toLowerCase() ?? id).join(', ') : '')
  const [background, setBackground] = useState<BackgroundAmount>(auto?.background ?? 'few')
  const matches = parseNames(text, library)
  const objectIds = matches.flatMap((m) => (m.objectId ? [m.objectId] : []))
  const name = (id: string) => library.find((o) => o.id === id)?.name ?? id

  const build = (seed: number) => buildComposition({ objectIds, background, seed })
  const replaceMatch = (match: NameMatch, by: string | null) =>
    setText(nameText(matches.flatMap((m) => (m !== match ? [m] : by ? [{ ...m, text: by }] : []))))

  return (
    <div className="compose-panel" role="group" aria-label="Собрать композицию">
      <div className="compose-row">
        <label className="muted" htmlFor="compose-names">
          Собрать композицию
        </label>
        <input
          id="compose-names"
          className="input compose-input"
          placeholder="наушники, лампа, книга"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && objectIds.length) build(auto?.seed ?? 1)
          }}
        />
        <span className="muted">Фоновые объекты</span>
        <Segmented label="Фоновые объекты" items={BACKGROUND_AMOUNTS} value={background} onChange={setBackground} />
        <button className="btn btn-primary" disabled={objectIds.length === 0} onClick={() => build(auto?.seed ?? 1)}>
          Собрать
        </button>
        <button className="btn" disabled={objectIds.length === 0 || !auto} onClick={() => build((auto?.seed ?? 0) + 1)} title="Та же композиция с другим seed">
          Другой вариант
        </button>
        {recompose && auto && (
          <span className="format-hint" role="status">
            Формат изменился
            <button className="btn" onClick={() => buildComposition(auto)}>
              Перекомпоновать под формат
            </button>
          </span>
        )}
      </div>
      <div className="compose-row chips" aria-label="Объекты композиции">
        {matches.map((m, i) =>
          m.objectId ? (
            <span key={i} className={objectIds.indexOf(m.objectId) < MAX_MAIN ? 'chip chip-main' : 'chip chip-bg'} title={objectIds.indexOf(m.objectId) < MAX_MAIN ? 'Главный объект' : 'Пойдёт фоновым: главных не больше трёх'}>
              {name(m.objectId)}
              {normalizeName(m.text) !== normalizeName(name(m.objectId)) && <span className="muted"> ← {m.text}</span>}
              <button className="chip-remove" aria-label={`Убрать «${name(m.objectId)}»`} onClick={() => replaceMatch(m, null)}>
                ×
              </button>
            </span>
          ) : (
            <span key={i} className="chip chip-unknown" role="alert">
              «{m.text}» — нет в библиотеке
              {m.suggestion && (
                <button className="chip-fix" onClick={() => replaceMatch(m, name(m.suggestion!))}>
                  {name(m.suggestion)}?
                </button>
              )}
              <button className="chip-remove" aria-label={`Убрать «${m.text}»`} onClick={() => replaceMatch(m, null)}>
                ×
              </button>
            </span>
          ),
        )}
        {library
          .filter((o) => !objectIds.includes(o.id))
          .map((o) => (
            <button key={o.id} className="chip chip-add" data-object={o.id} onClick={() => setText(nameText([...matches, { text: o.name.toLowerCase(), objectId: o.id }]))}>
              + {o.name.toLowerCase()}
            </button>
          ))}
      </div>
    </div>
  )
}
