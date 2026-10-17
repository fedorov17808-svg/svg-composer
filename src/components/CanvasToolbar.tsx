import type { ReactNode } from 'react'
import { useCanvasStore } from '../store/canvas'
import {
  BackIcon,
  BackwardIcon,
  DuplicateIcon,
  FlipIcon,
  ForwardIcon,
  FrontIcon,
  RedoIcon,
  TrashIcon,
  UndoIcon,
} from './icons'

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

/** Shortcut text in the platform's notation: ⌘⇧] on a Mac, Ctrl+Shift+] elsewhere. */
const shortcut = (key: string, shift = false) =>
  IS_MAC ? `⌘${shift ? '⇧' : ''}${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`

function ToolButton(props: { label: string; keys: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  const title = `${props.label} (${props.keys})`
  return (
    <button className="tool-btn" title={title} aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

/** Edit actions above the canvas; the same keys work on the canvas itself. */
export function CanvasToolbar() {
  const canvas = useCanvasStore()
  const { objects, selectedId, history } = canvas
  const index = objects.findIndex((o) => o.id === selectedId)
  const obj = objects[index]
  const atTop = !obj || index === objects.length - 1
  const atBottom = !obj || index === 0

  return (
    <div className="toolbar-group" role="toolbar" aria-label="Правка холста">
      <ToolButton label="Отменить" keys={shortcut('Z')} disabled={history.past.length === 0} onClick={canvas.undo}>
        <UndoIcon />
      </ToolButton>
      <ToolButton label="Повторить" keys={shortcut('Z', true)} disabled={history.future.length === 0} onClick={canvas.redo}>
        <RedoIcon />
      </ToolButton>
      <span className="toolbar-divider" />
      <ToolButton label="Дублировать" keys={shortcut('D')} disabled={!obj} onClick={canvas.duplicate}>
        <DuplicateIcon />
      </ToolButton>
      <ToolButton label="Удалить" keys="Delete" disabled={!obj} onClick={() => obj && canvas.remove(obj.id)}>
        <TrashIcon />
      </ToolButton>
      <ToolButton
        label="Отразить по горизонтали"
        keys="H"
        disabled={!obj || obj.locked === true}
        onClick={() => obj && canvas.flip(obj.id)}
      >
        <FlipIcon />
      </ToolButton>
      <span className="toolbar-divider" />
      <ToolButton label="На передний план" keys={shortcut(']', true)} disabled={atTop} onClick={() => canvas.reorder(obj.id, 'front')}>
        <FrontIcon />
      </ToolButton>
      <ToolButton label="На слой выше" keys={shortcut(']')} disabled={atTop} onClick={() => canvas.reorder(obj.id, 'forward')}>
        <ForwardIcon />
      </ToolButton>
      <ToolButton label="На слой ниже" keys={shortcut('[')} disabled={atBottom} onClick={() => canvas.reorder(obj.id, 'backward')}>
        <BackwardIcon />
      </ToolButton>
      <ToolButton label="На задний план" keys={shortcut('[', true)} disabled={atBottom} onClick={() => canvas.reorder(obj.id, 'back')}>
        <BackIcon />
      </ToolButton>
    </div>
  )
}
