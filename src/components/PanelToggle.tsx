import type { ReactNode } from 'react'
import { useUiStore, type PanelSide } from '../store/ui'

/** The button that collapses a side panel to a rail and the rail that opens it again. */
export function PanelRail({ side, label }: { side: PanelSide; label: string }) {
  return (
    <aside className={`panel panel-rail panel-${side}`} aria-label={label}>
      <button className="rail-button" onClick={() => useUiStore.getState().setPanel(side, true)} aria-expanded={false} title={`Показать: ${label}`}>
        <span aria-hidden="true">{side === 'left' ? '›' : '‹'}</span>
        <span className="rail-label">{label}</span>
      </button>
    </aside>
  )
}

export function PanelCollapse({ side, children }: { side: PanelSide; children?: ReactNode }) {
  return (
    <button className="btn btn-icon panel-collapse" onClick={() => useUiStore.getState().setPanel(side, false)} aria-expanded={true} title="Свернуть панель" aria-label="Свернуть панель">
      {children ?? (side === 'left' ? '‹' : '›')}
    </button>
  )
}
