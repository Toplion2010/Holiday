import { StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './app/styles.css'
import Game from './game/Game.tsx'

// The original ARES planner console stays available at #/planner.
const Planner = lazy(async () => {
  await import('./expedition/expedition.css')
  return import('./expedition/Expedition.tsx')
})

function Root() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (hash.startsWith('#/planner')) {
    return (
      <Suspense fallback={null}>
        <Planner />
      </Suspense>
    )
  }
  return <Game />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
