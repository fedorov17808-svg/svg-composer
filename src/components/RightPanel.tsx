import { useMemo, useState } from 'react'
import { normalizeAngle, type CanvasObject } from '../lib/canvas'
import { componentSvg, extract, unionRects } from '../lib/extract'
import { useCanvasStore } from '../store/canvas'
import { selectedParts, useEditorStore } from '../store/editor'
import { useLibraryStore } from '../store/library'
import { useSourcesStore } from '../store/sources'
import { useUiStore } from '../store/ui'
import { LayersPanel } from './LayersPanel'
import { NumberField } from './NumberField'

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU')

/** Above this many selected pieces the panel shows a summary instead of one card per piece. */
const MAX_CARDS = 3

function SelectionInfo() {
  const state = useEditorStore()
  const { nodes, leaves, selection, selectedLeaves } = state

  if (selection.length === 0 && selectedLeaves.length === 0) {
    return (
      <p className="empty">
        Щёлкните по элементу или протяните рамку с пустого места (или с Alt) — выделятся детали целиком
        внутри неё. Shift — добавить, Alt+Shift+клик — убрать деталь, ↑/↓ — уровень, Esc — снять.
      </p>
    )
  }

  if (selection.length + selectedLeaves.length > MAX_CARDS) {
    const box = unionRects(selectedParts(state).bounds)
    return (
      <div className="selection-item">
        <dl className="props">
          <dt>Групп</dt>
          <dd>{selection.length}</dd>
          <dt>Деталей</dt>
          <dd>{selectedLeaves.length}</dd>
          <dt>Размер</dt>
          <dd>
            {fmt(box.width)} × {fmt(box.height)}
          </dd>
        </dl>
      </div>
    )
  }

  return (
    <ul className="selection-list">
      {selection.map(({ node: index }) => {
        const node = nodes[index]
        if (!node) return null
        return (
          <li key={index} className="selection-item">
            <dl className="props">
              <dt>id</dt>
              <dd>{node.id ? <code>{node.id}</code> : <span className="muted">— (группа №{index + 1})</span>}</dd>
              <dt>Размер</dt>
              <dd>
                {fmt(node.width)} × {fmt(node.height)}
              </dd>
              <dt>Вложено</dt>
              <dd>
                {node.elementCount} эл. (групп: {node.groupCount})
              </dd>
              <dt>Уровень</dt>
              <dd>{node.depth + 1}</dd>
            </dl>
          </li>
        )
      })}
      {selectedLeaves.map((index) => {
        const leaf = leaves[index]
        if (!leaf) return null
        return (
          <li key={`l${index}`} className="selection-item">
            <dl className="props">
              <dt>Деталь</dt>
              <dd>
                <code>{leaf.tag}</code> <span className="muted">№{index + 1}</span>
              </dd>
              <dt>Размер</dt>
              <dd>
                {fmt(leaf.width)} × {fmt(leaf.height)}
              </dd>
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
  const placeholder = `Элемент из «${sourceTitle ?? sourceId}»`

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

function ObjectProperties() {
  const obj = useCanvasStore((s) => s.objects.find((o) => o.id === s.selectedId))
  const update = useCanvasStore((s) => s.update)
  if (!obj) return <p className="empty">Выделите объект, чтобы изменить позицию, масштаб и поворот.</p>
  // Typing into one field makes one undo step, not one per keystroke.
  const edit = (field: string, patch: Partial<CanvasObject>) => update(obj.id, patch, `${field}:${obj.id}`)
  const locked = obj.locked === true
  return (
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
  )
}

export function RightPanel() {
  const isSourceMode = useUiStore((s) => s.workspaceMode === 'source')
  const isSourceOpen = useEditorStore((s) => s.openSourceId !== null)
  const count = useEditorStore((s) => s.selection.length + s.selectedLeaves.length)

  return (
    <aside className="panel panel-right" aria-label="Слои и свойства">
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
