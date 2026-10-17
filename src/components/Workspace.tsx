import { useEffect } from 'react'
import { useCanvasStore } from '../store/canvas'
import { useEditorStore } from '../store/editor'
import { useSourcesStore } from '../store/sources'
import { useUiStore, type WorkspaceMode } from '../store/ui'
import { CompositionCanvas } from './CompositionCanvas'
import { NumberField } from './NumberField'
import { SourceViewer } from './SourceViewer'

const MODES: { id: WorkspaceMode; label: string }[] = [
  { id: 'source', label: 'Исходник' },
  { id: 'composition', label: 'Композиция' },
]

export function Workspace() {
  const mode = useUiStore((s) => s.workspaceMode)
  const openSourceId = useEditorStore((s) => s.openSourceId)
  const source = useSourcesStore((s) => s.sources.find((item) => item.id === openSourceId))

  return (
    <main className="workspace" aria-label="Рабочая область">
      <div className="workspace-toolbar">
        <ModeSwitch />
        {mode === 'composition' ? <CanvasControls /> : source ? <SourceControls title={source.title} /> : null}
      </div>
      {mode === 'source' && source && (
        <div className="workspace-hint">
          Клик — объект · Протяни рамку — несколько деталей · ↑/↓ — уровень
        </div>
      )}
      {mode === 'composition' ? (
        <CompositionCanvas />
      ) : source ? (
        <SourceViewer key={source.id} source={source} />
      ) : (
        <div className="workspace-stage">
          <p className="empty">Выберите исходник слева, чтобы выделять элементы и сохранять их в библиотеку.</p>
        </div>
      )}
    </main>
  )
}

function ModeSwitch() {
  const mode = useUiStore((s) => s.workspaceMode)
  const setMode = useUiStore((s) => s.setWorkspaceMode)
  return (
    <div className="segmented" role="tablist" aria-label="Режим рабочей области">
      {MODES.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={mode === item.id}
          className={mode === item.id ? 'segmented-item segmented-active' : 'segmented-item'}
          onClick={() => setMode(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function CanvasControls() {
  const { size, view, setSize, fit } = useCanvasStore()
  return (
    <>
      <span className="canvas-size">
        <span className="muted">Холст</span>
        <NumberField label="Ширина" value={size.width} min={16} max={10000} digits={0} onCommit={(width) => setSize({ ...size, width })} />
        <span className="muted">×</span>
        <NumberField label="Высота" value={size.height} min={16} max={10000} digits={0} onCommit={(height) => setSize({ ...size, height })} />
      </span>
      <span className="workspace-title muted">{Math.round(view.zoom * 100)}%</span>
      <button className="btn" onClick={fit} title="Показать холст целиком">
        Вписать
      </button>
    </>
  )
}

function SourceControls({ title }: { title: string }) {
  const { nodes, leaves, selection, selectedLeaves, close, levelUp, levelDown, clearSelection } = useEditorStore()
  const canGoUp =
    selection.some((item) => nodes[item.node]?.parent >= 0) || selectedLeaves.some((l) => leaves[l]?.parent >= 0)
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
    <>
      <button className="btn" onClick={close}>
        ← Назад к исходникам
      </button>
      <button className="btn" onClick={levelUp} disabled={!canGoUp} title="Стрелка ↑">
        ↑ Уровень выше
      </button>
      <button className="btn" onClick={levelDown} disabled={!canGoDown} title="Стрелка ↓">
        ↓ Уровень ниже
      </button>
      <span className="workspace-title" title={title}>
        {title}
      </span>
    </>
  )
}
