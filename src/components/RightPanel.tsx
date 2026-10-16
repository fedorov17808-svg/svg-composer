import { useEditorStore } from '../store/editor'

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

export function RightPanel() {
  const isSourceOpen = useEditorStore((s) => s.openSourceId !== null)
  const count = useEditorStore((s) => s.selection.length)

  return (
    <aside className="panel panel-right" aria-label="Слои и свойства">
      {isSourceOpen && (
        <section className="panel-section">
          <h2 className="panel-heading">Выделение{count > 1 ? ` (${count})` : ''}</h2>
          <SelectionInfo />
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
