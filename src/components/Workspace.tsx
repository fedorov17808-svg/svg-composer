import { useEffect } from 'react'
import { useEditorStore } from '../store/editor'
import { useSourcesStore } from '../store/sources'
import { SourceViewer } from './SourceViewer'

export function Workspace() {
  const openSourceId = useEditorStore((s) => s.openSourceId)
  const source = useSourcesStore((s) => s.sources.find((item) => item.id === openSourceId))

  return (
    <main className="workspace" aria-label="Рабочая область">
      {source ? (
        <>
          <SourceToolbar title={source.title} />
          <SourceViewer key={source.id} source={source} />
        </>
      ) : (
        <>
          <div className="workspace-toolbar">
            <span className="workspace-title">Рабочая область</span>
          </div>
          <div className="workspace-stage">
            <p className="empty">
              Выберите исходник слева, чтобы выделять элементы, или добавьте компоненты из библиотеки на
              холст.
            </p>
          </div>
        </>
      )}
    </main>
  )
}

function SourceToolbar({ title }: { title: string }) {
  const { nodes, selection, close, levelUp, levelDown, clearSelection } = useEditorStore()
  const canGoUp = selection.some((item) => nodes[item.node]?.parent >= 0)
  const canGoDown = selection.some((item) => nodes[item.node]?.children.length > 0)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowUp') levelUp()
      else if (e.key === 'ArrowDown') levelDown()
      else if (e.key === 'Escape') clearSelection()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [levelUp, levelDown, clearSelection])

  return (
    <div className="workspace-toolbar">
      <button className="btn" onClick={close}>
        ← Назад к исходникам
      </button>
      <span className="workspace-title" title={title}>
        {title}
      </span>
      <span className="toolbar-spacer" />
      <button className="btn" onClick={levelUp} disabled={!canGoUp} title="Стрелка ↑">
        Уровень выше ↑
      </button>
      <button className="btn" onClick={levelDown} disabled={!canGoDown} title="Стрелка ↓">
        Уровень ниже ↓
      </button>
    </div>
  )
}
