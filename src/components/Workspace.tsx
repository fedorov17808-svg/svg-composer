import { useEffect } from 'react'
import { FORMATS, isSmallCanvas, type FormatId } from '../lib/formats'
import { OBJECT_SIZES } from '../store/objectLibrary'
import { useCanvasStore } from '../store/canvas'
import { canLevelDown, canLevelUp, useEditorStore } from '../store/editor'
import { useUiStore, type WorkspaceMode } from '../store/ui'
import { CanvasToolbar } from './CanvasToolbar'
import { ComposePanel } from './ComposePanel'
import { CompositionCanvas } from './CompositionCanvas'
import { NumberField } from './NumberField'
import { PaletteBar } from './PaletteBar'
import { Segmented } from './Segmented'

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
      <ComposePanel />
      <FormatBar />
      <PaletteBar />
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
  const { view, fit } = useCanvasStore()
  return (
    <>
      <CanvasToolbar />
      <span className="canvas-zoom muted">{Math.round(view.zoom * 100)}%</span>
      <button className="btn" onClick={fit} title="Показать холст целиком">
        Вписать
      </button>
    </>
  )
}

const FORMAT_ITEMS: { id: FormatId; label: string }[] = [...FORMATS.map(({ id, label }) => ({ id, label })), { id: 'custom', label: 'Свой' }]

/** Canvas format and the L/S size of the whole composition, over the canvas. */
function FormatBar() {
  const { size, format, objectSize, setFormat, setSize, setObjectSize } = useCanvasStore()
  return (
    <div className="format-bar">
      <span className="muted">Формат</span>
      <Segmented label="Формат холста" items={FORMAT_ITEMS} value={format} onChange={setFormat} />
      {format === 'custom' ? (
        <span className="canvas-size">
          <NumberField label="Ширина" value={size.width} min={16} max={10000} digits={0} onCommit={(width) => setSize({ ...size, width })} />
          <span className="muted">×</span>
          <NumberField label="Высота" value={size.height} min={16} max={10000} digits={0} onCommit={(height) => setSize({ ...size, height })} />
        </span>
      ) : (
        <span className="canvas-size muted" data-testid="canvas-size">
          {size.width} × {size.height}
        </span>
      )}
      <span className="toolbar-divider" />
      <Segmented label="Размер" items={OBJECT_SIZES.map((id) => ({ id, label: `Размер ${id}` }))} value={objectSize} onChange={setObjectSize} />
      {/* A suggestion only: the user decides. */}
      {isSmallCanvas(size) && objectSize === 'L' && (
        <span className="format-hint" role="status">
          Для маленьких форматов рекомендуется размер S
          <button className="btn" onClick={() => setObjectSize('S')}>
            Переключить
          </button>
        </span>
      )}
    </div>
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
