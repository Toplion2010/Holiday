// Mars EVA game: HAB-1 base screen (astronaut, loadout, ordered stops) → EVA on the
// Martian Map walk scene with autopilot, health, hazards and the "Hey Holiday" voice assistant.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModeContext } from '@/app/modeContract'
import WalkPanel, { type WalkGameBridge } from '@/features/walk/WalkPanel'
import { fetchManifest } from '@/features/walk/sitePackage'
import { lonLatToLocal, makeFrame, type LocalFrame } from '@/features/walk/geo'
import type { WalkScene } from '@/features/walk/walkScene'
import { DEFAULT_CONFIG } from '../expedition/model'
import { BaseScreen, type Loadout } from './BaseScreen'
import { GameSession, loadTargets, type GameTarget, type Snapshot } from './session'
import { GameHud } from './GameHud'
import { VoiceAssistant } from './voice'
import './game.css'

const SITE = 'gale-boxwork'
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

const DEFAULT_LOADOUT: Loadout = {
  config: { ...DEFAULT_CONFIG },
  vehicle: 'walk',
  ltst: 9,
  route: [
    { id: 'VPB', activity: 'survey' },
    { id: 'NODULE', activity: 'sample' },
    { id: 'POLYGON', activity: 'photo' },
  ],
}

interface Site { frame: LocalFrame; targets: GameTarget[]; start: { x: number; z: number } }

export default function Game() {
  const [screen, setScreen] = useState<'base' | 'play'>('base')
  const [loadout, setLoadout] = useState<Loadout>(DEFAULT_LOADOUT)
  const [run, setRun] = useState(0)
  const [site, setSite] = useState<Site | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetchManifest(SITE)
      .then(async (m) => {
        const frame = makeFrame(m.bounds_eqc_m, m.height.pixel_m, m.height.width, m.height.height)
        const targets = await loadTargets(frame)
        // The walk scene starts at the first POI (camp A); use it for base-screen estimates.
        const poi = m.pois?.[0]
        const start = poi ? lonLatToLocal(frame, poi.lon_east, poi.lat) : { x: 0, z: 0 }
        if (alive) setSite({ frame, targets, start })
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div className="game-center">
        <p>Could not load the site: {error}</p>
        <a className="walk-btn" href="#/home">Back</a>
      </div>
    )
  }
  if (screen === 'play' && site) {
    return <Play key={run} loadout={loadout} site={site} onExit={() => setScreen('base')} onRestart={() => setRun((n) => n + 1)} />
  }
  return <BaseScreen value={loadout} onChange={setLoadout} targets={site?.targets ?? null} start={site?.start ?? null} onGo={() => setScreen('play')} />
}

function Play({ loadout, site, onExit, onRestart }: { loadout: Loadout; site: Site; onExit(): void; onRestart(): void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [voice, setVoice] = useState<{ on: boolean; error?: string; heard?: string; reply?: string | null }>({ on: false })
  const labelsRef = useRef<HTMLDivElement>(null)
  const hudCompacted = useRef(false)

  const session = useMemo(
    () => new GameSession(loadout.config, site.frame, site.targets, loadout.route, () => labelsRef.current, setSnap),
    [loadout, site],
  )
  const assistant = useMemo(
    () =>
      new VoiceAssistant(
        (text) => session.voiceCommand(text),
        (heard, reply) => setVoice((v) => ({ ...v, heard, reply })),
        (on, error) => setVoice((v) => ({ ...v, on, error })),
      ),
    [session],
  )

  useEffect(() => {
    session.speak = (t) => assistant.speak(t)
    return () => {
      session.dispose()
      assistant.dispose()
    }
  }, [session, assistant])

  useEffect(() => {
    // Capture phase on window runs before the walk scene's own key handler, so movement
    // keys can be blocked while the crew member is incapacitated.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (session.inputLocked && MOVE_KEYS.has(e.code)) {
        e.stopImmediatePropagation()
        return
      }
      if (e.code === 'KeyE') session.interact()
      else if (e.code === 'KeyR') session.startRepair()
      else if (e.code === 'KeyV') session.toggleView()
      else if (e.code === 'KeyB') session.toggleAutopilot()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
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

  const bridge: WalkGameBridge = useMemo(
    () => ({
      hooks: { beforeRender: session.beforeRender, afterRender: session.afterRender },
      onState: (state, extra) => {
        session.onWalkState(state, extra)
        // Start the Martian Map HUD in its compact level ("минимум") to leave room for game panels:
        // press its own toggle button until it reads that level. Runs once per session.
        if (!hudCompacted.current) {
          hudCompacted.current = true
          let tries = 0
          let clickedAt: string | null = null
          const tick = () => {
            const btn = labelsRef.current?.parentElement?.querySelector<HTMLButtonElement>('.hud-toggle')
            const text = btn?.textContent ?? null
            if (text?.includes('минимум') || tries++ > 40) return
            // Click only once the label shows a new level, so a slow render cannot skip past "min".
            if (btn && text !== clickedAt) {
              clickedAt = text
              btn.click()
            }
            setTimeout(tick, 250)
          }
          setTimeout(tick, 250)
        }
      },
      onScene: (scene: WalkScene | null) => {
        session.attach(scene)
        // Dev-only handle for testing from the console (stripped from production builds).
        if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ares = { session, scene }
        if (!scene) return
        scene.setVehicle(loadout.vehicle)
        scene.setLtst(loadout.ltst)
      },
    }),
    [session, loadout],
  )

  return (
    <WalkPanel
      {...ctx}
      game={{
        ...bridge,
        overlay: (
          <>
            <div ref={labelsRef} className="game-labels" />
            {snap && (
              <GameHud
                snap={snap}
                session={session}
                voice={voice}
                onVoiceToggle={() => assistant.toggle()}
                onVoiceText={(t) => assistant.handleText(t)}
                onExit={onExit}
                onRestart={onRestart}
              />
            )}
          </>
        ),
      }}
    />
  )
}
