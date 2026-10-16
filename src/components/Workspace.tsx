export function Workspace() {
  return (
    <main className="workspace" aria-label="Рабочая область">
      <div className="workspace-toolbar">
        <span className="workspace-title">Рабочая область</span>
      </div>
      <div className="workspace-stage">
        <p className="empty">
          Выберите исходник слева, чтобы выделять элементы, или добавьте компоненты из библиотеки на
          холст.
        </p>
      </div>
    </main>
  )
}
