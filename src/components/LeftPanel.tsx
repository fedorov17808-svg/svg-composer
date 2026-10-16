import { useUiStore, type LeftTab } from '../store/ui'
import { SourcesGrid } from './SourcesGrid'

const TABS: { id: LeftTab; label: string }[] = [
  { id: 'sources', label: 'Исходники' },
  { id: 'library', label: 'Библиотека' },
]

export function LeftPanel() {
  const leftTab = useUiStore((s) => s.leftTab)
  const setLeftTab = useUiStore((s) => s.setLeftTab)

  return (
    <aside className="panel panel-left" aria-label="Исходники и библиотека">
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
      </div>
      <div
        className="panel-body"
        role="tabpanel"
        id={`tabpanel-${leftTab}`}
        aria-labelledby={`tab-${leftTab}`}
      >
        {leftTab === 'sources' ? (
          <SourcesGrid />
        ) : (
          <p className="empty">
            Библиотека пуста. Откройте исходник, выделите элемент и сохраните его как компонент.
          </p>
        )}
      </div>
    </aside>
  )
}
