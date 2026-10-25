import { useEffect } from 'react'
import { FileMenu } from './components/FileMenu'
import { LeftPanel } from './components/LeftPanel'
import { RightPanel } from './components/RightPanel'
import { Toast } from './components/Toast'
import { Workspace } from './components/Workspace'
import { useUiStore, WIDE_MIN } from './store/ui'

export default function App() {
  const { left, right } = useUiStore((s) => s.panels)

  // Crossing 1024 px (a resized window, a rotated tablet) opens both panels or collapses both.
  useEffect(() => {
    const query = matchMedia(`(min-width: ${WIDE_MIN}px)`)
    const sync = () => {
      useUiStore.getState().setPanel('left', query.matches)
      useUiStore.getState().setPanel('right', query.matches)
    }
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">SVG Composer</h1>
        <span className="app-subtitle">композиции из объектов библиотеки</span>
        <FileMenu />
      </header>
      <div className={`app-body${left ? '' : ' left-collapsed'}${right ? '' : ' right-collapsed'}`}>
        <LeftPanel />
        <Workspace />
        <RightPanel />
      </div>
      <Toast />
    </div>
  )
}
