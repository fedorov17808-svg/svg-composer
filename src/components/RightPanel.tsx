import { useState } from 'react'
import { extract } from '../lib/extract'
import { useEditorStore } from '../store/editor'
import { useLibraryStore } from '../store/library'
import { useSourcesStore } from '../store/sources'
import { useUiStore } from '../store/ui'

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU')

function SelectionInfo() {
  const { nodes, selection } = useEditorStore()

  if (selection.length === 0) {
    return (
      <p className="empty">
        Наведите курсор на иллюстрацию и щёлкните по элементу. Shift+клик — добавить ещё, ↑/↓ — уровень
        выше/ниже, Esc — снять выделение.
      </p>
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
    </ul>
  )
}

const newId = () => 'c' + Math.random().toString(36).slice(2, 8)

function AddToLibrary() {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sourceId = useEditorStore((s) => s.openSourceId)
  const sourceTitle = useSourcesStore((s) => s.sources.find((item) => item.id === sourceId)?.title)
  const placeholder = `Элемент из «${sourceTitle ?? sourceId}»`

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { nodes, elements, selection } = useEditorStore.getState()
    if (!sourceId || selection.length === 0) return
    const id = newId()
    setBusy(true)
    setError(null)
    try {
      const result = extract({
        elements: selection.map((item) => elements[item.node]),
        bounds: selection.map((item) => nodes[item.node]),
        prefix: `${id}-`,
      })
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
    </form>
  )
}

export function RightPanel() {
  const isSourceOpen = useEditorStore((s) => s.openSourceId !== null)
  const count = useEditorStore((s) => s.selection.length)

  return (
    <aside className="panel panel-right" aria-label="Слои и свойства">
      {isSourceOpen && (
        <section className="panel-section">
          <h2 className="panel-heading">Выделение{count > 1 ? ` (${count})` : ''}</h2>
          <SelectionInfo />
          {count > 0 && <AddToLibrary />}
        </section>
      )}
      <section className="panel-section">
        <h2 className="panel-heading">Слои</h2>
        <p className="empty">На холсте пока нет объектов.</p>
      </section>
      <section className="panel-section">
        <h2 className="panel-heading">Свойства</h2>
        <p className="empty">Выделите объект, чтобы изменить позицию, масштаб и поворот.</p>
      </section>
    </aside>
  )
}
