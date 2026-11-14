// ARES Expedition as a game: title → loadout → EVA on the Martian Map walk scene.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModeContext } from '@/app/modeContract'
import WalkPanel, { type WalkGameBridge } from '@/features/walk/WalkPanel'
import { fetchManifest } from '@/features/walk/sitePackage'
import { makeFrame, type LocalFrame } from '@/features/walk/geo'
import type { WalkScene } from '@/features/walk/walkScene'
import { DEFAULT_CONFIG } from '../expedition/model'
import type { Config } from '../expedition/types'
import { GameSession, loadTargets, type GameTarget, type Snapshot } from './session'
import { GameHud } from './GameHud'
import './game.css'

const SITE = 'gale-boxwork'

export interface Loadout {
  config: Config
  vehicle: 'walk' | 'rover'
  ltst: number
}

const DEFAULT_LOADOUT: Loadout = { config: { ...DEFAULT_CONFIG }, vehicle: 'walk', ltst: 9 }

export default function Game() {
  const [screen, setScreen] = useState<'title' | 'loadout' | 'play'>('title')
  const [loadout, setLoadout] = useState<Loadout>(DEFAULT_LOADOUT)
  const [run, setRun] = useState(0)

  if (screen === 'play') {
    return <Play key={run} loadout={loadout} onExit={() => setScreen('title')} onRestart={() => setRun((n) => n + 1)} />
  }
  return (
    <div className="page game-front">
      <nav className="topbar">
        <span className="brand">ARES&nbsp;Expedition</span>
        <div className="topbar-links">
          <a href="#/planner">Mission planner</a>
          <a href="./data/gale/gale-data-manifest.json" target="_blank" rel="noreferrer">Sources</a>
        </div>
        <span className="topbar-tag">Space&nbsp;Apps&nbsp;2026</span>
      </nav>
      {screen === 'title' ? <Title onStart={() => setScreen('loadout')} /> : <LoadoutScreen value={loadout} onChange={setLoadout} onBack={() => setScreen('title')} onGo={() => setScreen('play')} />}
    </div>
  )
}

function Title({ onStart }: { onStart(): void }) {
  return (
    <header className="game-hero">
      <div className="game-hero-copy">
        <span className="micro-label">Gale crater · Mount Sharp boxwork · real HiRISE terrain</span>
        <h1>
          MARS
          <br />
          <span className="hero-thin">EVA</span>
        </h1>
        <p>
          Walk out of the habitat on real Martian terrain, reach the stations Curiosity studied, do the science and get
          home before your oxygen runs out. Dust storms, suit leaks and comms blackouts will not wait for you.
        </p>
        <div className="game-actions">
          <button type="button" className="game-cta" onClick={onStart}>Start mission →</button>
          <a className="game-ghost" href="#/planner">Open mission planner</a>
        </div>
        <ul className="game-controls">
          <li><kbd>Click</kbd> capture mouse</li>
          <li><kbd>W A S D</kbd> walk</li>
          <li><kbd>E</kbd> science / end EVA at habitat</li>
          <li><kbd>R</kbd> patch suit leak</li>
          <li><kbd>V</kbd> third / first person</li>
          <li><kbd>1 2 3</kbd> time ×1 ×10 ×60</li>
        </ul>
      </div>
      <img className="game-hero-art" src="./game/astronaut-preview.png" alt="Astronaut and rover models" />
    </header>
  )
}

function LoadoutScreen({ value, onChange, onBack, onGo }: { value: Loadout; onChange(l: Loadout): void; onBack(): void; onGo(): void }) {
  const c = value.config
  const set = (patch: Partial<Config>) => onChange({ ...value, config: { ...c, ...patch } })
  return (
    <section className="game-loadout">
      <span className="micro-label">Prepare at the habitat</span>
      <h2>Loadout</h2>
      <div className="game-grid">
        <label>Start
          <select value={value.vehicle} onChange={(e) => onChange({ ...value, vehicle: e.target.value as Loadout['vehicle'], config: { ...c, mode: e.target.value as Config['mode'] } })}>
            <option value="walk">On foot</option>
            <option value="rover">In the rover</option>
          </select>
        </label>
        <label>Science objective
          <select value={c.objective} onChange={(e) => set({ objective: e.target.value })}>
            <option value="groundwater">Groundwater history</option>
            <option value="stratigraphy">Layering & stratigraphy</option>
            <option value="geomorphology">Surface morphology</option>
          </select>
        </label>
        <label>Local solar time at exit
          <select value={value.ltst} onChange={(e) => onChange({ ...value, ltst: Number(e.target.value) })}>
            {[7, 9, 12, 15, 17].map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <label>Oxygen, kg
          <input type="number" min={0.2} max={3} step={0.1} value={c.oxygen} onChange={(e) => set({ oxygen: Number(e.target.value) })} />
        </label>
        <label>Suit battery, Wh
          <input type="number" min={200} max={4000} step={100} value={c.suitWh} onChange={(e) => set({ suitWh: Number(e.target.value) })} />
        </label>
        <label>Reserve to keep, %
          <input type="number" min={5} max={80} step={5} value={Math.round(c.reserve * 100)} onChange={(e) => set({ reserve: Number(e.target.value) / 100 })} />
        </label>
        <label>EVA time limit, h
          <input type="number" min={1} max={24} step={1} value={c.duration / 3600} onChange={(e) => set({ duration: Number(e.target.value) * 3600 })} />
        </label>
      </div>
      <p className="dim small">
        Consumption model from ARES Expedition (hypothetical equipment): oxygen {c.oxygenRate * 3600 * 1000} g/h at rest, rising with
        uphill grade; suit {c.suitW} W; rover {c.driveW} W while driving.
      </p>
      <div className="game-actions">
        <button type="button" className="game-ghost" onClick={onBack}>← Back</button>
        <button type="button" className="game-cta" onClick={onGo}>Exit the airlock →</button>
      </div>
    </section>
  )
}

function Play({ loadout, onExit, onRestart }: { loadout: Loadout; onExit(): void; onRestart(): void }) {
  const [ready, setReady] = useState<{ frame: LocalFrame; targets: GameTarget[] } | null>(null)
  const [error, setError] = useState('')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const labelsRef = useRef<HTMLDivElement>(null)

  // The walk panel loads the terrain itself; targets only need the same local frame.
  useEffect(() => {
    let alive = true
    fetchManifest(SITE)
      .then(async (m) => {
        const frame = makeFrame(m.bounds_eqc_m, m.height.pixel_m, m.height.width, m.height.height)
        const targets = await loadTargets(frame)
        if (alive) setReady({ frame, targets })
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  const session = useMemo(() => {
    if (!ready) return null
    const s = new GameSession(loadout.config, ready.frame, ready.targets, () => labelsRef.current, setSnap)
    return s
  }, [ready, loadout])

  useEffect(() => () => session?.dispose(), [session])

  useEffect(() => {
    if (!session) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return
      if (e.code === 'KeyE') session.interact()
      else if (e.code === 'KeyR') session.startRepair()
      else if (e.code === 'KeyV') session.toggleView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])

  const ctx: ModeContext = useMemo(
    () => ({
      globe: { flyTo: async () => {}, setLines: () => {}, setMarkers: () => {} },
      params: { site: SITE },
      exit: onExit,
      exitFrom: onExit,
      openMode: () => {},
    }),
    [onExit],
  )

  const bridge: WalkGameBridge | undefined = useMemo(() => {
    if (!session) return undefined
    return {
      hooks: { beforeRender: session.beforeRender, afterRender: session.afterRender },
      onScene: (scene: WalkScene | null) => {
        session.attach(scene)
        // Dev-only handle for testing from the console (stripped from production builds).
        if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ares = { session, scene }
        if (!scene) return
        scene.setVehicle(loadout.vehicle)
        scene.setLtst(loadout.ltst)
      },
    }
  }, [session, loadout])

  if (error) {
    return (
      <div className="game-center">
        <p>Could not load the site: {error}</p>
        <button type="button" className="walk-btn" onClick={onExit}>Back</button>
      </div>
    )
  }
  if (!bridge || !session) return <div className="game-center"><p>Loading HiRISE terrain…</p></div>

  return (
    <WalkPanel
      {...ctx}
      game={{
        ...bridge,
        overlay: (
          <>
            <div ref={labelsRef} className="game-labels" />
            {snap && <GameHud snap={snap} session={session} onExit={onExit} onRestart={onRestart} />}
          </>
        ),
      }}
    />
  )
}
