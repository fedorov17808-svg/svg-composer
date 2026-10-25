import { useState } from 'react'
import { BACKGROUND_AMOUNTS, MAX_MAIN, type BackgroundAmount } from '../lib/autoLayout'
import { isAiEnabled, pickLocal, pickObjects, type Pick } from '../lib/metaphor'
import { normalizeName, parseNames, type NameMatch } from '../lib/objectNames'
import { useCanvasStore } from '../store/canvas'
import { buildComposition, needsRecompose } from '../store/compose'
import { useObjectLibraryStore } from '../store/objectLibrary'
import { Segmented } from './Segmented'

type Mode = 'metaphor' | 'objects'
const MODES: { id: Mode; label: string }[] = [
  { id: 'metaphor', label: 'Метафора' },
  { id: 'objects', label: 'Объекты' },
]
/** Example metaphors under the field: a click puts one in and builds. */
const EXAMPLES = ['Финансовая грамотность', 'Учёба', 'Удалённая работа', 'Идея']

const nameText = (matches: NameMatch[]) => matches.map((m) => m.text).join(', ')

/**
 * Scenario 1 (a metaphor → objects picked by meaning) and scenario 2 (names of objects). Both end
 * in the same editable chips of objects: × removes one, «+ объект» adds one, «Собрать» rebuilds.
 */
export function ComposePanel() {
  const library = useObjectLibraryStore((s) => s.objects)
  const auto = useCanvasStore((s) => s.auto)
  const recompose = useCanvasStore(needsRecompose)
  // Until chosen or edited, all of these follow the built composition: the autosave and the
  // library may arrive after the first render.
  const [chosenMode, setMode] = useState<Mode | null>(null)
  const mode = chosenMode ?? (auto && !auto.metaphor ? 'objects' : 'metaphor')
  const [editedMetaphor, setMetaphor] = useState<string | null>(null)
  const metaphor = editedMetaphor ?? auto?.metaphor?.text ?? ''
  const [edited, setText] = useState<string | null>(null)
  const text = edited ?? (auto ? auto.objectIds.map((id) => library.find((o) => o.id === id)?.name.toLowerCase() ?? id).join(', ') : '')
  const [chosenBackground, setBackground] = useState<BackgroundAmount | null>(null)
  const background = chosenBackground ?? auto?.background ?? 'few'
  const [picking, setPicking] = useState(false)
  const [notFound, setNotFound] = useState<string | null>(null)
  const matches = parseNames(text, library)
  const objectIds = matches.flatMap((m) => (m.objectId ? [m.objectId] : []))
  const name = (id: string) => library.find((o) => o.id === id)?.name ?? id
  // The pick of the metaphor in the field, if the composition was built for it.
  const picked = auto?.metaphor && normalizeName(auto.metaphor.text) === normalizeName(metaphor) ? auto.metaphor : null

  const build = (seed: number, ids = objectIds, pick: Pick | null = null, forText = metaphor) => {
    const kept = pick ?? (mode === 'metaphor' ? picked : null)
    buildComposition({
      objectIds: ids,
      background,
      seed,
      ...(kept ? { metaphor: { text: forText.trim(), reasons: kept.reasons, source: kept.source } } : {}),
    })
  }

  /** Picks objects for the metaphor (Claude if the server has a key, else locally) and builds. */
  const pickAndBuild = async (value = metaphor) => {
    if (!value.trim()) return
    setNotFound(null)
    // Without a key the pick is local: no waiting, no «Подбираю…».
    let pick: Pick
    if (isAiEnabled()) {
      setPicking(true)
      pick = await pickObjects(value, library)
      setPicking(false)
    } else {
      pick = pickLocal(value, library)
    }
    if (pick.objectIds.length === 0) {
      setNotFound(value.trim())
      return
    }
    setText(pick.objectIds.map((id) => name(id).toLowerCase()).join(', '))
    build(auto?.seed ?? 1, pick.objectIds, pick, value)
  }

  // A new metaphor is picked again; the same one rebuilds with the chips as they are now.
  const onBuild = () => (mode === 'metaphor' && !picked ? void pickAndBuild() : build(auto?.seed ?? 1))
  const canBuild = mode === 'metaphor' ? metaphor.trim().length > 0 && !picking : objectIds.length > 0
  const replaceMatch = (match: NameMatch, by: string | null) =>
    setText(nameText(matches.flatMap((m) => (m !== match ? [m] : by ? [{ ...m, text: by }] : []))))
  const showObjects = mode === 'objects' || picked !== null

  return (
    <div className="compose-panel" role="group" aria-label="Собрать композицию">
      <div className="compose-row">
        <Segmented label="Режим сборки" items={MODES} value={mode} onChange={setMode} />
        {mode === 'metaphor' ? (
          <input
            className="input compose-input"
            aria-label="Метафора или заголовок"
            placeholder="Финансовая грамотность"
            value={metaphor}
            onChange={(e) => {
              setMetaphor(e.target.value)
              setNotFound(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && canBuild && onBuild()}
          />
        ) : (
          <input
            className="input compose-input"
            aria-label="Названия объектов"
            placeholder="наушники, лампа, книга"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canBuild && onBuild()}
          />
        )}
        <span className="compose-group">
          <span className="muted">Фоновые объекты</span>
          <Segmented label="Фоновые объекты" items={BACKGROUND_AMOUNTS} value={background} onChange={setBackground} />
        </span>
        <button className="btn btn-primary" disabled={!canBuild} onClick={onBuild}>
          {picking ? 'Подбираю…' : 'Собрать'}
        </button>
        <button className="btn" disabled={objectIds.length === 0 || !auto || picking} onClick={() => build((auto?.seed ?? 0) + 1)} title="Те же объекты, другая раскладка">
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
      {mode === 'metaphor' && (
        <div className="compose-row chips" aria-label="Примеры метафор">
          <span className="muted">Например:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              className="chip chip-add"
              onClick={() => {
                setMetaphor(example)
                void pickAndBuild(example)
              }}
            >
              {example}
            </button>
          ))}
        </div>
      )}
      {mode === 'metaphor' && notFound && (
        <div className="compose-row compose-empty" role="alert">
          Для «{notFound}» в библиотеке ничего не нашлось. Попробуйте другие слова или выберите объекты вручную.
          <button className="btn" onClick={() => setMode('objects')}>
            Выбрать объекты
          </button>
        </div>
      )}
      {mode === 'metaphor' && picked && (
        <div className="compose-row chips" aria-label="Почему эти объекты">
          <span className="muted">Почему эти объекты:</span>
          {picked.reasons
            .filter((r) => objectIds.includes(r.objectId))
            .map((r) => (
              <span key={r.objectId} className="chip chip-reason">
                {name(r.objectId).toLowerCase()} — {r.text}
              </span>
            ))}
          <span className="compose-source muted" title={picked.source === 'ai' ? 'Метафору разобрал Claude через /api/metaphor' : 'Без внешних сервисов: теги, синонимы и таблица метафор'}>
            {picked.source === 'ai' ? 'подбор: Claude' : 'подбор: локальный'}
          </span>
        </div>
      )}
      {showObjects && (
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
      )}
    </div>
  )
}
