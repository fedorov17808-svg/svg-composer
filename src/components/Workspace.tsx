import { useEffect } from 'react'
import { useCanvasStore } from '../store/canvas'
import { canLevelDown, canLevelUp, useEditorStore } from '../store/editor'
import { useUiStore, type WorkspaceMode } from '../store/ui'
import { CanvasToolbar } from './CanvasToolbar'
import { CompositionCanvas } from './CompositionCanvas'
import { NumberField } from './NumberField'

const MODES: { id: WorkspaceMode; label: string }[] = [
  { id: 'source', label: 'Исходник' },
  { id: 'composition', label: 'Композиция' },
]

// The source mode of v1 (gophers) is off: only the composition is shown; ModeSwitch, SourceControls
// and SourceViewer stay in the code.
export function Workspace() {
  return (
    <main className="workspace" aria-label="Рабочая область">
      <div className="workspace-toolbar">
        <CanvasControls />
      </div>
      <CompositionCanvas />
    </main>
  )
}

export function ModeSwitch() {
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
      <CanvasToolbar />
      <span className="canvas-size">
        <span className="muted">Холст</span>
        <NumberField label="Ширина" value={size.width} min={16} max={10000} digits={0} onCommit={(width) => setSize({ ...size, width })} />
        <span className="muted">×</span>
        <NumberField label="Высота" value={size.height} min={16} max={10000} digits={0} onCommit={(height) => setSize({ ...size, height })} />
      </span>
      <span className="canvas-zoom muted">{Math.round(view.zoom * 100)}%</span>
      <button className="btn" onClick={fit} title="Показать холст целиком">
        Вписать
      </button>
    </>
  )
}

export function SourceControls({ title }: { title: string }) {
  const editor = useEditorStore()
  const { close, levelUp, levelDown, clearSelection } = editor
  const canGoUp = canLevelUp(editor)
  const canGoDown = canLevelDown(editor)

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
