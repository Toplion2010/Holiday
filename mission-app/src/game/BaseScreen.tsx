// HAB-1 base screen: the astronaut stands by the rover; set the loadout and pick stops in order.

import { useEffect, useMemo, useRef } from 'react'
import { ACTIVITIES, scienceValue } from '../expedition/model'
import type { Config } from '../expedition/types'
import { BaseScene } from './BaseScene'
import { estimateRoute, type GameTarget, type RouteStop } from './session'

export interface Loadout {
  config: Config
  vehicle: 'walk' | 'rover'
  ltst: number
  route: RouteStop[]
}

const fmtDur = (s: number) => `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`

export function BaseScreen({
  value,
  onChange,
  targets,
  start,
  onGo,
}: {
  value: Loadout
  onChange(l: Loadout): void
  targets: GameTarget[] | null
  start: { x: number; z: number } | null
  onGo(): void
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    let scene: BaseScene | null = null
    try {
      scene = new BaseScene(host.current)
    } catch {
      // No WebGL: the settings panel still works.
    }
    return () => scene?.dispose()
  }, [])

  const c = value.config
  const set = (patch: Partial<Config>) => onChange({ ...value, config: { ...c, ...patch } })
  const route = value.route
  const setRoute = (r: RouteStop[]) => onChange({ ...value, route: r })
  const est = useMemo(() => (targets && start ? estimateRoute(c, targets, route, start) : null), [c, targets, route, start])

  const toggle = (id: string) =>
    setRoute(route.some((r) => r.id === id) ? route.filter((r) => r.id !== id) : [...route, { id, activity: 'survey' }])
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= route.length) return
    const r = [...route]
    ;[r[i], r[j]] = [r[j], r[i]]
    setRoute(r)
  }
  const setActivity = (id: string, activity: string) => setRoute(route.map((r) => (r.id === id ? { ...r, activity } : r)))

  const ordered = targets ? [...route.map((r) => targets.find((t) => t.id === r.id)!).filter(Boolean), ...targets.filter((t) => !route.some((r) => r.id === t.id))] : []

  return (
    <div className="base-screen">
      <div ref={host} className="base3d" />
      <header className="base-top">
        <a className="base-back" href="#/home">← ARES//NAV home</a>
        <div>
          <span className="micro-label">HAB-1 · Gale crater · Mount Sharp boxwork</span>
          <h1 className="base-title">Prepare the EVA</h1>
        </div>
      </header>

      <aside className="base-panel">
        <section>
          <h2>Loadout</h2>
          <div className="base-grid">
            <label>Start
              <select value={value.vehicle} onChange={(e) => onChange({ ...value, vehicle: e.target.value as Loadout['vehicle'], config: { ...c, mode: e.target.value as Config['mode'] } })}>
                <option value="walk">On foot</option>
                <option value="rover">In the rover</option>
              </select>
            </label>
            <label>Objective
              <select value={c.objective} onChange={(e) => set({ objective: e.target.value })}>
                <option value="groundwater">Groundwater history</option>
                <option value="stratigraphy">Layering</option>
                <option value="geomorphology">Surface morphology</option>
              </select>
            </label>
            <label>Exit time (LTST)
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
            <label>Reserve, %
              <input type="number" min={5} max={80} step={5} value={Math.round(c.reserve * 100)} onChange={(e) => set({ reserve: Number(e.target.value) / 100 })} />
            </label>
          </div>
        </section>

        <section>
          <h2>Destinations <small>in order: A → B → C</small></h2>
          {!targets && <p className="base-dim">Loading stations…</p>}
          <ol className="base-stops">
            {ordered.map((t) => {
              const i = route.findIndex((r) => r.id === t.id)
              const on = i >= 0
              const act = on ? route[i].activity : 'survey'
              const a = ACTIVITIES.find((x) => x.id === act)!
              const leg = est?.legs.find((l) => l.id === t.id)
              const fromBase = start ? Math.hypot(t.x - start.x, t.z - start.z) : 0
              return (
                <li key={t.id} className={on ? 'is-on' : ''}>
                  <button type="button" className="base-letter" onClick={() => toggle(t.id)} aria-pressed={on} title={on ? 'Remove from route' : 'Add to route'}>
                    {on ? String.fromCharCode(65 + i) : '+'}
                  </button>
                  <div className="base-stop-main">
                    <strong>{t.name}</strong>
                    <span className="base-dim">
                      {Math.round(fromBase)} m from HAB · {on ? `${leg?.value ?? scienceValue(t, a, c.objective, {})} pts` : `up to ${scienceValue(t, ACTIVITIES[3], c.objective, {})} pts`} · {t.theme}
                    </span>
                    {on && (
                      <select value={act} onChange={(e) => setActivity(t.id, e.target.value)} aria-label={`Activity at ${t.name}`}>
                        {ACTIVITIES.map((x) => (
                          <option key={x.id} value={x.id}>{x.name} · {Math.round(x.seconds / 60)} min</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {on && (
                    <div className="base-order">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Earlier">▲</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === route.length - 1} aria-label="Later">▼</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>

        {est && (
          <section className="base-summary">
            <h2>Expedition value</h2>
            <dl>
              <div><dt>Science</dt><dd>{est.value} pts</dd></div>
              <div><dt>Route</dt><dd>{(est.distance / 1000).toFixed(2)} km</dd></div>
              <div><dt>Time</dt><dd>{fmtDur(est.seconds)}</dd></div>
              <div><dt>O₂ need</dt><dd>{est.oxygen.toFixed(2)} / {est.o2Budget.toFixed(2)} kg</dd></div>
              <div><dt>Suit</dt><dd>{Math.round(est.suitWh)} Wh</dd></div>
              <div><dt>Value / kg O₂</dt><dd>{est.oxygen > 0 ? Math.round(est.value / est.oxygen) : 0}</dd></div>
            </dl>
            <div className={`base-meter${est.feasible ? '' : ' is-bad'}`}>
              <i style={{ width: `${Math.min(100, (est.oxygen / Math.max(1e-6, est.o2Budget)) * 100)}%` }} />
            </div>
            <p className="base-dim">
              {est.feasible ? 'Fits within O₂, suit power and time, keeping the reserve.' : 'Over budget: drop a stop, choose shorter work or carry more O₂.'} Estimate: straight legs × 1.4 at 0.7 m/s.
            </p>
          </section>
        )}

        <button type="button" className="game-cta base-go" onClick={onGo} disabled={!targets || route.length === 0}>
          Exit the airlock →
        </button>
        <p className="base-keys">
          <kbd>WASD</kbd> walk · <kbd>E</kbd> work / end EVA · <kbd>B</kbd> autopilot home · <kbd>R</kbd> patch leak · <kbd>V</kbd> view · <kbd>1 2 3</kbd> time · say <em>“Hey Holiday, status”</em>
        </p>
      </aside>
    </div>
  )
}
