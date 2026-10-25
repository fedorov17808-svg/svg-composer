import { useMemo, useState } from 'react'
import { normalizeAngle, type CanvasObject } from '../lib/canvas'
import { componentSvg, extract, unionRects } from '../lib/extract'
import { parseVersionId, versionId, type ObjectState } from '../lib/libraryObjects'
import { VARIANTS } from '../lib/palette'
import { defaultName, uniqueName } from '../lib/names'
import { useCanvasStore } from '../store/canvas'
import { selectedParts, selectionUnits, useEditorStore, wholeMarkName } from '../store/editor'
import { useLibraryStore } from '../store/library'
import { OBJECT_STATES, STATE_LABELS } from '../store/objectLibrary'
import { useSourcesStore } from '../store/sources'
import { useUiStore } from '../store/ui'
import { LayersPanel } from './LayersPanel'
import { NumberField } from './NumberField'
import { PaletteForm } from './PaletteForm'
import { PanelCollapse, PanelRail } from './PanelToggle'

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU')

/** Above this many selected pieces the panel shows a summary instead of one card per piece. */
const MAX_CARDS = 3

/** "1606,6 × 2423,4 (32 × 48 % иллюстрации)": sources differ in units (viewBox 144, 600, 5000). */
function SizeText({ width, height }: { width: number; height: number }) {
  const sourceId = useEditorStore((s) => s.openSourceId)
  const viewBox = useSourcesStore((s) => s.sources.find((item) => item.id === sourceId)?.viewBox)
  const [, , vw, vh] = (viewBox ?? '').split(/[\s,]+/).map(Number)
  return (
    <>
      {fmt(width)} × {fmt(height)}
      {vw > 0 && vh > 0 && (
        <span className="muted">
          {' '}
          ({Math.round((width / vw) * 100)} × {Math.round((height / vh) * 100)} % иллюстрации)
        </span>
      )}
    </>
  )
}

function SelectionInfo() {
  const state = useEditorStore()
  const { nodes, leaves, selection, selectedLeaves } = state
  // One card per object, however many groups and shapes it is made of.
  const units = selectionUnits(state)

  if (selection.length === 0 && selectedLeaves.length === 0) {
    return (
      <p className="empty">
        Ничего не выделено. Щёлкните по персонажу или предмету на картинке; рамкой — несколько деталей,
        Shift — добавить.
      </p>
    )
  }

  if (units.length > MAX_CARDS) {
    const box = unionRects(selectedParts(state).bounds)
    return (
      <div className="selection-item">
        <dl className="props">
          <dt>Объектов</dt>
          <dd>{units.length}</dd>
          <dt>Групп</dt>
          <dd>{selection.length}</dd>
          <dt>Деталей</dt>
          <dd>{selectedLeaves.length}</dd>
          <dt>Размер</dt>
          <dd>
            <SizeText {...box} />
          </dd>
        </dl>
      </div>
    )
  }

  return (
    <ul className="selection-list">
      {units.map((u) => {
        const groups = u.items.map((item) => nodes[item.node])
        const shapes = u.leaves.map((l) => leaves[l])
        const pieces = groups.length + shapes.length
        const key = u.items.length ? `g${u.items[0].node}` : `l${u.leaves[0]}`
        const depth = groups.length ? Math.min(...groups.map((g) => g.depth)) : null
        const numbers = [...u.items.map((item) => `№${item.node + 1}`), ...u.leaves.map((l) => `деталь №${l + 1}`)].join(', ')
        const plural = (n: number, one: string, few: string, many: string) =>
          `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`
        return (
          <li key={key} className="selection-item">
            <dl className="props">
              {u.mark >= 0 && (
                <>
                  <dt>Название</dt>
                  <dd>{state.marks[u.mark].name}</dd>
                </>
              )}
              {pieces > 1 ? (
                <>
                  <dt>Объект</dt>
                  <dd title={numbers}>
                    {[groups.length && plural(groups.length, 'группа', 'группы', 'групп'), shapes.length && plural(shapes.length, 'деталь', 'детали', 'деталей')]
                      .filter(Boolean)
                      .join(' + ')}
                    {groups.length > 0 && groups.length <= 6 && (
                      <span className="muted"> ({u.items.map((item) => `№${item.node + 1}`).join(', ')})</span>
                    )}
                  </dd>
                </>
              ) : groups.length ? (
                <>
                  <dt>id</dt>
                  <dd>
                    {groups[0].id ? <code>{groups[0].id}</code> : <span className="muted">— (группа №{u.items[0].node + 1})</span>}
                  </dd>
                </>
              ) : (
                <>
                  <dt>Деталь</dt>
                  <dd>
                    <code>{shapes[0].tag}</code> <span className="muted">№{u.leaves[0] + 1}</span>
                  </dd>
                </>
              )}
              <dt>Размер</dt>
              <dd>
                <SizeText {...u.box} />
              </dd>
              {groups.length > 0 && (
                <>
                  <dt>Вложено</dt>
                  <dd>
                    {groups.reduce((n, g) => n + g.elementCount, 0) + shapes.length} эл. (групп:{' '}
                    {groups.reduce((n, g) => n + g.groupCount, 0) + groups.length - (pieces > 1 ? 0 : 1)})
                  </dd>
                </>
              )}
              {depth !== null && (
                <>
                  <dt>Уровень</dt>
                  <dd>{depth + 1}</dd>
                </>
              )}
            </dl>
          </li>
        )
      })}
    </ul>
  )
}

const newId = () => 'c' + Math.random().toString(36).slice(2, 8)

/** Exactly what "Add to library" will store: shows partial picks and clip-path cut-offs. */
function ExtractPreview() {
  const { nodes, elements, leaves, leafElements, selection, selectedLeaves } = useEditorStore()
  const parts = useMemo(
    () => selectedParts({ nodes, elements, leaves, leafElements, selection, selectedLeaves }),
    [nodes, elements, leaves, leafElements, selection, selectedLeaves],
  )
  const preview = useMemo(() => {
    try {
      const result = extract({ ...parts, prefix: 'preview-' })
      return { ...result, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(componentSvg(result))}` }
    } catch {
      return null
    }
  }, [parts])

  if (!preview) return null
  return (
    <figure className="extract-preview">
      <img src={preview.src} alt="Что будет сохранено" draggable={false} />
      <figcaption className="muted">
        Будет сохранено · {fmt(preview.width)} × {fmt(preview.height)}
      </figcaption>
    </figure>
  )
}

function AddToLibrary() {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sourceId = useEditorStore((s) => s.openSourceId)
  const sourceTitle = useSourcesStore((s) => s.sources.find((item) => item.id === sourceId)?.title)
  const names = useLibraryStore((s) => s.components.map((c) => c.name).join('\n'))
  const markName = useEditorStore(wholeMarkName)
  const placeholder = markName
    ? uniqueName(markName, names.split('\n'))
    : defaultName(sourceId ?? '', sourceTitle, names.split('\n'))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parts = selectedParts(useEditorStore.getState())
    if (!sourceId || parts.elements.length === 0) return
    const id = newId()
    setBusy(true)
    setError(null)
    try {
      const result = extract({ ...parts, prefix: `${id}-` })
      await useLibraryStore.getState().add({
        id,
        name: name.trim() || placeholder,
        sourceId,
        ...result,
        createdAt: Date.now(),
      })
      setName('')
      useUiStore.getState().showToast('Добавлено в библиотеку')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Название</span>
        <input
          className="input"
          value={name}
          placeholder={placeholder}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        Добавить в библиотеку
      </button>
      {error && <p className="error">Не удалось извлечь: {error}</p>}
      <ExtractPreview />
    </form>
  )
}

/** Main ↔ background version and the order of the accent colors of a library object. */
function VersionControls({ obj }: { obj: CanvasObject }) {
  const version = parseVersionId(obj.componentId)
  const components = useLibraryStore((s) => s.components)
  if (!version) return null
  const locked = obj.locked === true
  const variant = obj.variant ?? 0

  const setState = (state: ObjectState) => {
    const from = components.find((c) => c.id === obj.componentId)
    const to = components.find((c) => c.id === versionId(version.objectId, version.size, state))
    if (from && to) useCanvasStore.getState().swapComponent(obj.id, from, to)
  }

  return (
    <div className="version-controls">
      <div className="segmented" role="radiogroup" aria-label="Версия объекта">
        {OBJECT_STATES.map((state) => (
          <button
            key={state}
            role="radio"
            aria-checked={version.state === state}
            disabled={locked}
            className={version.state === state ? 'segmented-item segmented-active' : 'segmented-item'}
            onClick={() => setState(state)}
          >
            {STATE_LABELS[state]}
          </button>
        ))}
      </div>
      {version.state === 'main' ? (
        <button
          className="btn"
          disabled={locked}
          title="Переставить акцентные цвета объектов внутри палитры; белый и цвета фона не меняются"
          onClick={() => useCanvasStore.getState().update(obj.id, { variant: (variant + 1) % VARIANTS.length })}
        >
          Вариант цвета {variant + 1} из {VARIANTS.length}
        </button>
      ) : (
        <p className="muted version-note">Фоновый объект — только цвета фона.</p>
      )}
    </div>
  )
}

function ObjectProperties() {
  const obj = useCanvasStore((s) => s.objects.find((o) => o.id === s.selectedId))
  const update = useCanvasStore((s) => s.update)
  if (!obj) return <p className="empty">Ничего не выделено. Щёлкните по объекту на холсте.</p>
  // Typing into one field makes one undo step, not one per keystroke.
  const edit = (field: string, patch: Partial<CanvasObject>) => update(obj.id, patch, `${field}:${obj.id}`)
  const locked = obj.locked === true
  return (
    <>
      <VersionControls obj={obj} />
      <div className="prop-grid">
        <NumberField label="X" value={obj.x} live disabled={locked} onCommit={(x) => edit('x', { x })} />
        <NumberField label="Y" value={obj.y} live disabled={locked} onCommit={(y) => edit('y', { y })} />
        <NumberField
          label="Масштаб"
          suffix="%"
          value={obj.scale * 100}
          min={1}
          max={2000}
          live
          disabled={locked}
          onCommit={(percent) => edit('scale', { scale: percent / 100 })}
        />
        <NumberField
          label="Угол"
          suffix="°"
          value={obj.rotation}
          step={15}
          live
          disabled={locked}
          onCommit={(rotation) => edit('rotation', { rotation: normalizeAngle(rotation) })}
        />
      </div>
    </>
  )
}

export function RightPanel() {
  const isSourceMode = useUiStore((s) => s.workspaceMode === 'source')
  const isSourceOpen = useEditorStore((s) => s.openSourceId !== null)
  const count = useEditorStore((s) => s.selection.length + s.selectedLeaves.length)
  const paletteForm = useUiStore((s) => s.paletteForm)
  const open = useUiStore((s) => s.panels.right)

  if (!open) return <PanelRail side="right" label="Слои и свойства" />
  return (
    <aside className="panel panel-right" aria-label="Слои и свойства">
      <div className="panel-bar">
        <PanelCollapse side="right" />
      </div>
      {paletteForm && (
        <section className="panel-section">
          <h2 className="panel-heading">Новая палитра</h2>
          <PaletteForm />
        </section>
      )}
      {isSourceMode && isSourceOpen && (
        <section className="panel-section">
          <h2 className="panel-heading">Выделение{count > 1 ? ` (${count})` : ''}</h2>
          <SelectionInfo />
          {count > 0 && <AddToLibrary />}
        </section>
      )}
      <section className="panel-section">
        <h2 className="panel-heading">Слои</h2>
        <LayersPanel />
      </section>
      <section className="panel-section">
        <h2 className="panel-heading">Свойства</h2>
        <ObjectProperties />
      </section>
    </aside>
  )
}
