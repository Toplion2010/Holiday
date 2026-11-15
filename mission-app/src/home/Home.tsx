import { useEffect, useState } from 'react'
import { CrtScreen } from '../design'
import { formatLightTime, oneWayLightTimeS } from '../lib/astro'
import { formatLmst, useStore } from '../state/store'
import './home.css'

/** Home: two ways in. S / 1 starts the simulation, M / 2 opens Mission Control. */
export default function Home({ onStart, onControl }: { onStart: () => void; onControl: () => void }) {
  const mission = useStore((s) => s.mission)
  const [lightTime] = useState(() => oneWayLightTimeS())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'KeyS' || e.code === 'Digit1' || e.code === 'Numpad1') onStart()
      else if (e.code === 'KeyM' || e.code === 'Digit2' || e.code === 'Numpad2') onControl()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStart, onControl])

  return (
    <main className="home">
      <CrtScreen label="HolySquare home" className="home__screen">
        <h1 className="home__title">HolySquare</h1>
        <p className="home__sub">Interplanetary survival guide · Martian map</p>

        <nav className="home__actions" aria-label="Main menu">
          <button type="button" className="home__btn" onClick={onStart} aria-keyshortcuts="S 1" autoFocus>
            <span className="home__key" aria-hidden="true">S · 1</span>
            <span className="home__label">
              <u>S</u>tart simulation
            </span>
            <span className="home__detail">Rehearse today’s EVA on real NASA terrain</span>
          </button>
          <button type="button" className="home__btn" onClick={onControl} aria-keyshortcuts="M 2">
            <span className="home__key" aria-hidden="true">M · 2</span>
            <span className="home__label">
              <u>M</u>ission control
            </span>
            <span className="home__detail">Base status, crew, site and data</span>
          </button>
        </nav>

        <p className="home__status">
          Site: Gale boxwork · Sol {mission.sol} · LMST {formatLmst(mission.lmstMin)} · Earth link {formatLightTime(lightTime)} one way
        </p>
      </CrtScreen>
    </main>
  )
}
