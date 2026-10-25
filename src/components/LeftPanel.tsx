import { useUiStore, type LeftTab } from '../store/ui'
import { ObjectLibraryGrid } from './ObjectLibraryGrid'
import { PanelCollapse, PanelRail } from './PanelToggle'

// The gopher tabs of v1 («Исходники», «Библиотека») are off: SourcesGrid and LibraryGrid stay in the code.
const TABS: { id: LeftTab; label: string }[] = [{ id: 'objects', label: 'Библиотека объектов' }]

export function LeftPanel() {
  const leftTab = useUiStore((s) => s.leftTab)
  const setLeftTab = useUiStore((s) => s.setLeftTab)
  const open = useUiStore((s) => s.panels.left)

  if (!open) return <PanelRail side="left" label="Библиотека объектов" />

  return (
    <aside className="panel panel-left" aria-label="Библиотека объектов">
      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={leftTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            className={leftTab === tab.id ? 'tab tab-active' : 'tab'}
            onClick={() => setLeftTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <PanelCollapse side="left" />
      </div>
      <div
        className="panel-body"
        role="tabpanel"
        id={`tabpanel-${leftTab}`}
        aria-labelledby={`tab-${leftTab}`}
      >
        <ObjectLibraryGrid />
      </div>
    </aside>
  )
}
