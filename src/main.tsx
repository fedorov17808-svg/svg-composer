import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { probeAi } from './lib/metaphor'
import { startAutosave } from './store/autosave'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void startAutosave()
void probeAi()
