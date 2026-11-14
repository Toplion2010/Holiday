import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

// Three groups of screens with their own global stylesheets. ARES//NAV (index.css) and the
// Martian Map game (app/styles.css) define the same CSS variables, so only one group is
// loaded per page; moving between groups reloads the page.
type World = 'nav' | 'game' | 'planner'

const worldOf = (hash: string): World =>
  hash.startsWith('#/game') ? 'game' : hash.startsWith('#/planner') ? 'planner' : 'nav'

const LOADERS: Record<World, () => Promise<ComponentType>> = {
  nav: async () => {
    await import('./index.css')
    return (await import('./App.tsx')).default
  },
  game: async () => {
    await import('./app/styles.css')
    return (await import('./game/Game.tsx')).default
  },
  planner: async () => {
    await import('./expedition/expedition.css')
    return (await import('./expedition/Expedition.tsx')).default
  },
}

const world = worldOf(window.location.hash)
window.addEventListener('hashchange', () => {
  if (worldOf(window.location.hash) !== world) window.location.reload()
})

void LOADERS[world]().then((Root) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
})
