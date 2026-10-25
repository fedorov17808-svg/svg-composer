import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { probeAi } from './lib/metaphor'
import { migrateData } from './store/migrate'
import { startAutosave } from './store/autosave'

// Old (v1) data goes before anything reads it.
void migrateData().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  void startAutosave()
  void probeAi()
})
