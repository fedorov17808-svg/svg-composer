export function RightPanel() {
  return (
    <aside className="panel panel-right" aria-label="Слои и свойства">
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
