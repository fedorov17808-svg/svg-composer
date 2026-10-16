import { LeftPanel } from './components/LeftPanel'
import { RightPanel } from './components/RightPanel'
import { Toast } from './components/Toast'
import { Workspace } from './components/Workspace'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">SVG Composer</h1>
        <span className="app-subtitle">конструктор векторных композиций</span>
      </header>
      <div className="app-body">
        <LeftPanel />
        <Workspace />
        <RightPanel />
      </div>
      <Toast />
    </div>
  )
}
