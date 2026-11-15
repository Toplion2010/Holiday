import { useState } from 'react'
import { AnnunciatorPanel, CrtScreen, Panel, type Lamp } from '../design'
import { formatLightTime, oneWayLightTimeS } from '../lib/astro'
import { WAYPOINTS, toLocalMeters } from '../lib/site'
import { formatLmst, useStore } from '../state/store'
import base from '../data/base.json'
import './control.css'

type Risk = 'Low' | 'Med' | 'High'

const fmtLat = (v: number) => `${Math.abs(v).toFixed(5)}° ${v < 0 ? 'S' : 'N'}`
const fmtLon = (v: number) => `${v.toFixed(5)}° E`
const fmtMin = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`

/** Mission Control (#/control): read-only base information hub. Data: src/data/base.json. */
export default function MissionControl() {
  const mission = useStore((s) => s.mission)
  const [lightTime] = useState(() => oneWayLightTimeS())
  const b = base.base
  const c = base.conditions
  const hab = WAYPOINTS.find((w) => w.kind === 'habitat')

  const lamps: Lamp[] = [
    { id: 'base', legend: `BASE ${b.status.toUpperCase()}`, state: b.status === 'Nominal' ? 'advisory' : 'caution' },
    { id: 'power', legend: 'LOW POWER', state: b.powerPct < 30 ? 'warning' : 'off' },
    { id: 'rover', legend: `ROVER ${b.rover.toUpperCase()}`, state: 'advisory' },
    { id: 'suits', legend: 'SUITS SHORT', state: b.suitsReady < 2 ? 'caution' : 'off' },
  ]

  const stops = base.expeditions.map((e) => {
    const w = WAYPOINTS.find((x) => x.id === e.id)
    const d = w && hab ? toLocalMeters(w, hab) : null
    return { ...e, risk: e.risk as Risk, name: w?.name ?? e.id, objective: w?.objective ?? '', distanceM: d ? Math.hypot(d.x, d.y) : null }
  })

  return (
    <div className="control">
      <header className="control__head">
        <a className="control__brand" href="#/home" title="Back to home">
          HolySquare
        </a>
        <h1 className="control__title">Mission control</h1>
        <p className="control__strip">
          Sol {mission.sol} · LMST {formatLmst(mission.lmstMin)} · Earth link {formatLightTime(lightTime)} one way
        </p>
        <nav className="control__nav">
          <a className="btn" href="#/home">
            ← Back to home
          </a>
          <a className="btn btn--primary" href="#/console">
            Open planning console
          </a>
          <a className="btn" href="#/credits">
            Data sources
          </a>
        </nav>
      </header>

      <main className="control__grid">
        <Panel legend="BASE" className="control__base">
          <AnnunciatorPanel lamps={lamps} label="Base status" />
          <CrtScreen label="Base readout">
            <dl className="control__dl">
              <dt>Name</dt>
              <dd>{b.name}</dd>
              <dt>Location</dt>
              <dd>
                {fmtLat(b.lat)}, {fmtLon(b.lon)}
              </dd>
              <dt>Status</dt>
              <dd>{b.status}</dd>
              <dt>Power</dt>
              <dd>{b.powerPct} %</dd>
              <dt>O₂ reserve</dt>
              <dd>{b.o2ReserveKg} kg</dd>
              <dt>Suits ready</dt>
              <dd>
                {b.suitsReady} / {b.suitsTotal}
              </dd>
              <dt>Rover</dt>
              <dd>{b.rover}</dd>
            </dl>
          </CrtScreen>
        </Panel>

        <Panel legend="CREW" className="control__crew">
          <CrtScreen label="Crew readout">
            <table className="control__table">
              <thead>
                <tr>
                  <th>Callsign</th>
                  <th>Suit</th>
                  <th>O₂</th>
                  <th>Batt</th>
                  <th>HR</th>
                </tr>
              </thead>
              <tbody>
                {base.crew.map((m) => (
                  <tr key={m.callsign}>
                    <td>
                      {m.callsign}
                      <span className="control__dim"> · {m.role}</span>
                    </td>
                    <td>{m.suit}</td>
                    <td className={m.o2Pct < 50 ? 'control__warn' : ''}>{m.o2Pct} %</td>
                    <td className={m.batteryPct < 50 ? 'control__warn' : ''}>{m.batteryPct} %</td>
                    <td>{m.heartRateBpm} bpm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CrtScreen>
        </Panel>

        <Panel legend="SITE" className="control__site">
          <CrtScreen label="Site readout" phosphor="green">
            <p className="control__big">
              {base.site.name} · {base.site.area}
            </p>
            <p className="control__dim">{base.site.sizeKm} EVA footprint</p>
            <p className="control__text">{base.site.description}</p>
          </CrtScreen>
        </Panel>

        <Panel legend="CONDITIONS" className="control__cond">
          <CrtScreen label="Conditions readout">
            <p className="control__tag">{c.source}</p>
            <dl className="control__dl">
              <dt>Air temp</dt>
              <dd>
                {c.airTempC.min} … {c.airTempC.max} °C
              </dd>
              <dt>Wind</dt>
              <dd>{c.windMs} m/s</dd>
              <dt>Dust</dt>
              <dd>{c.dust}</dd>
              <dt>Radiation</dt>
              <dd>{c.radiationUGyH} µGy/h background</dd>
              <dt>Sunrise / set</dt>
              <dd>
                {c.sunrise} / {c.sunset} LMST
              </dd>
              <dt>EVA window</dt>
              <dd>{c.evaWindow} daylight</dd>
            </dl>
          </CrtScreen>
        </Panel>

        <Panel legend="TODAY'S EXPEDITIONS" className="control__exp">
          <CrtScreen label="Expeditions readout">
            <table className="control__table">
              <thead>
                <tr>
                  <th>Stop</th>
                  <th>From HAB</th>
                  <th>Science</th>
                  <th>Est. time</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((s) => (
                  <tr key={s.id} title={s.objective}>
                    <td>
                      {s.id} · {s.name}
                    </td>
                    <td>{s.distanceM === null ? '—' : `${(s.distanceM / 1000).toFixed(2)} km`}</td>
                    <td>{s.scienceValue} pts</td>
                    <td>{fmtMin(s.estMinutes)}</td>
                    <td>
                      <span className={`control__risk control__risk--${s.risk.toLowerCase()}`}>{s.risk}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CrtScreen>
        </Panel>
      </main>
    </div>
  )
}
