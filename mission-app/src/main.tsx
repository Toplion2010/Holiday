import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './expedition/expedition.css'
import App from './expedition/Expedition.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
