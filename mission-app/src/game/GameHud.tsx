// Game panels over the walk scene, in the Martian Map HUD style.

import { useState } from 'react'
import type { GameSession, Snapshot } from './session'
import { voiceSupported } from './voice'

const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const fmtMin = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(0, Math.round(s / 60))} min`)

function Bar({ label, pct, text, warn }: { label: string; pct: number; text: string; warn?: boolean }) {
  const f = Math.max(0, Math.min(100, pct))
  return (
    <div className={`game-bar${warn || f < 25 ? ' is-warn' : ''}`}>
      <div className="game-bar-head">
        <span>{label}</span>
        <strong>{text}</strong>
      </div>
      <div className="game-bar-track"><i style={{ width: `${f}%` }} /></div>
    </div>
  )
}

function Row({ k, v, cls = '' }: { k: string; v: string; cls?: string }) {
  return (
    <div className={`game-row ${cls}`}>
      <span>{k}</span>
      <strong>{v}</strong>
    </div>
  )
}

export interface VoiceUi { on: boolean; error?: string; heard?: string; reply?: string | null }

export function GameHud({
  snap,
  session,
  voice,
  onVoiceToggle,
  onVoiceText,
  onExit,
  onRestart,
}: {
  snap: Snapshot
  session: GameSession
  voice: VoiceUi
  onVoiceToggle(): void
  onVoiceText(text: string): void
  onExit(): void
  onRestart(): void
}) {
  const [typed, setTyped] = useState('')
  const s = snap.state
  const c = s.config
  const h = snap.health
  const z = snap.hazards
  const done = Object.keys(s.completed).length
  const leak = !!s.faults.leak
  const medical = snap.autopilot === 'medical'

  const saveLog = () => {
    const blob = new Blob([JSON.stringify({ outcome: snap.outcome, config: c, route: snap.route, log: s.log }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'holysquare-eva-log.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      {/* ---------- left: crew health and suit ---------- */}
      <div className="game-side game-side--left">
        <div className="game-side-head">
          <span className="micro-label">EVA {fmtTime(s.elapsed)}</span>
          <span className={`game-chip is-${h.status.toLowerCase()}`}>{h.status}</span>
        </div>
        <Bar label="Oxygen" pct={h.o2Pct} text={`${Math.max(0, s.oxygen).toFixed(3)} kg`} warn={leak} />
        <Bar label="Suit battery" pct={h.suitPct} text={`${Math.max(0, s.suitWh).toFixed(0)} Wh`} />
        <Row k="Heart rate" v={`${Math.round(h.heartRate)} bpm`} cls={h.heartRate > 150 || h.heartRate < 45 ? 'is-alert' : ''} />
        <Row k="Suit temp" v={`${h.suitTempC.toFixed(1)} °C`} cls={h.suitTempC < 15 ? 'is-alert' : ''} />
        <Row k="Suit seal" v={leak ? 'LEAK' : 'OK'} cls={leak ? 'is-alert' : ''} />
        <div className="game-sep" />
        <span className="micro-label">Rover</span>
        <Bar label="Battery" pct={h.roverPct} text={`${Math.max(0, s.roverWh).toFixed(0)} Wh`} />
        <Row k="Wheels" v={h.wheels} cls={h.wheels !== 'OK' ? 'is-alert' : ''} />
        <Row k="Crew" v={s.aboard ? 'aboard' : 'on foot'} />
        <div className="game-sep" />
        <div className="game-voice">
          <button type="button" className={`walk-btn${voice.on ? ' is-on' : ''}`} onClick={onVoiceToggle} disabled={!voiceSupported()} title={voiceSupported() ? 'Say “Hey Holiday” then a command' : 'Voice input needs Chrome or Edge'}>
            {voice.on ? '● Holiday listening' : 'Hey Holiday: mic off'}
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (typed.trim()) onVoiceText(typed.trim())
              setTyped('')
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="or type: status, go home…" aria-label="Command to Holiday" />
          </form>
          {voice.error && <p className="game-note is-alert">{voice.error}</p>}
          {voice.heard && <p className="game-note">“{voice.heard}”{voice.reply ? ` → ${voice.reply}` : ''}</p>}
        </div>
      </div>

      {/* ---------- right: hazards and route ---------- */}
      <div className="game-side game-side--right">
        <span className="micro-label">Hazards</span>
        <Row k="Radiation" v={`${z.rateUGyH.toFixed(1)} µGy/h`} cls={z.rateUGyH > 50 ? 'is-alert' : ''} />
        <Row k="EVA dose" v={`${(z.doseUGy / 1000).toFixed(3)} mGy`} />
        <Row k="Wind" v={`${z.windMs.toFixed(0)} m/s · dust ${z.dust}`} cls={z.windMs > 15 ? 'is-alert' : ''} />
        <Row
          k="Sun"
          v={z.sunElevationDeg === null ? '—' : `${z.sunElevationDeg.toFixed(0)}° · ${z.night ? 'night, heaters on' : `~${(z.daylightLeftH ?? 0).toFixed(1)} h light`}`}
          cls={z.night || (z.daylightLeftH ?? 9) < 1.5 ? 'is-alert' : ''}
        />
        <div className="game-sep" />
        <span className="micro-label">Route</span>
        <ol className="game-route">
          {snap.route.map((r, i) => {
            const t = session.targets.find((x) => x.id === r.id)
            const isDone = !!s.completed[r.id]
            return (
              <li key={r.id} className={isDone ? 'is-done' : snap.next?.target.id === r.id ? 'is-next' : ''}>
                <b>{String.fromCharCode(65 + i)}</b> {t?.name ?? r.id}
                {snap.next?.target.id === r.id && <em> · {Math.round(snap.next.distance)} m</em>}
                {isDone && <em> ✓</em>}
              </li>
            )
          })}
        </ol>
        <Row k="Science" v={`${s.science} / ~${snap.plannedValue} pts · ${done} done`} />
        <Row
          k="HAB-1"
          v={`${Math.round(snap.baseDistance)} m · ${snap.returnNow ? 'RETURN NOW' : `turn back ≤ ${fmtMin(snap.returnMargin)}`}`}
          cls={snap.returnNow ? 'is-alert' : ''}
        />
        <button type="button" className={`walk-btn game-pilot-btn${snap.autopilot ? ' is-on' : ''}`} onClick={() => session.toggleAutopilot()} disabled={medical || !!snap.outcome}>
          {snap.autopilot ? 'Autopilot ON · B to cancel' : 'Autopilot home · B'}
        </button>
      </div>

      {/* ---------- alerts ---------- */}
      <div className="game-events">
        {snap.autopilot && (
          <div className={`game-event is-pilot${medical ? ' is-medical' : ''}`}>
            <strong>{medical ? 'Medical evacuation' : snap.autopilot === 'oxygen' ? 'O₂ reserve: autopilot home' : 'Autopilot home'}</strong>
            <span>Retracing your safe path to HAB-1.{medical ? '' : ' Press B to take control.'}</span>
          </div>
        )}
        {snap.events.filter((e) => e.kind !== 'medical').map((e) => (
          <div key={e.kind} className={`game-event is-${e.kind}`}>
            <strong>{e.title}</strong>
            <span>{e.text}</span>
          </div>
        ))}
        {snap.repair !== null && <div className="game-event is-leak"><strong>Patching suit…</strong><span>{fmtMin(300 - snap.repair)} left</span></div>}
      </div>

      {snap.message && !snap.outcome && <div className="game-toast">{snap.message}</div>}

      {!snap.outcome && !snap.choosing && (
        <div className="game-prompt">
          {snap.activity ? (
            <>
              <strong>{snap.activity.activity.name}</strong>
              <span>{snap.activity.target.name} · {fmtMin(snap.activity.activity.seconds - snap.activity.elapsed)} left</span>
              <div className="game-bar-track"><i style={{ width: `${(snap.activity.elapsed / snap.activity.activity.seconds) * 100}%` }} /></div>
            </>
          ) : medical ? (
            <>Crew member incapacitated · autopilot in control</>
          ) : snap.atBase && (s.science > 0 || snap.distance > 50) ? (
            <><kbd>E</kbd> Enter HAB-1 and end the EVA</>
          ) : snap.nearTarget && !s.completed[snap.nearTarget.id] ? (
            <><kbd>E</kbd> Work at {snap.nearTarget.name}</>
          ) : snap.nearTarget ? (
            <>{snap.nearTarget.name}: done</>
          ) : leak ? (
            <><kbd>R</kbd> Patch the suit leak</>
          ) : snap.next ? (
            <>Next: <b>{String.fromCharCode(65 + snap.next.index)} · {snap.next.target.name}</b> · {Math.round(snap.next.distance)} m · bright orange beacon</>
          ) : (
            <>Route complete · head back to the blue HAB-1 beacon</>
          )}
        </div>
      )}

      {snap.choosing && (
        <div className="game-modal">
          <div className="game-card">
            <span className="micro-label">Station {snap.choosing.id} · sol {snap.choosing.sol}</span>
            <h3>{snap.choosing.name}</h3>
            <p className="dim">{snap.choosing.purpose}</p>
            <div className="game-choices">
              {snap.choosing.activities.map((a) => {
                const ok = c.tools.includes(a.tool)
                const planned = session.plannedActivity(snap.choosing!.id) === a.id
                return (
                  <button key={a.id} type="button" disabled={!ok} className={planned ? 'is-planned' : ''} onClick={() => session.startActivity(a.id)}>
                    <strong>{a.name}{planned ? ' · planned' : ''}</strong>
                    <span>{fmtMin(a.seconds)} · base {a.value} pts · {a.tool}</span>
                  </button>
                )
              })}
            </div>
            <p className="game-note">Activities and scores are simulated. Real context: <a href={snap.choosing.source} target="_blank" rel="noreferrer">NASA observation ↗</a></p>
            <button type="button" className="game-ghost" onClick={() => session.cancelChoice()}>Cancel</button>
          </div>
        </div>
      )}

      {snap.outcome && (
        <div className="game-modal">
          <div className={`game-card game-end${snap.outcome.won ? ' is-won' : ' is-lost'}`}>
            <span className="micro-label">{snap.outcome.won ? 'Mission complete' : 'Mission ended'}</span>
            <h3>{snap.outcome.won ? 'Welcome home.' : medical || s.log.some((l) => l.kind === 'medical') ? 'Crew evacuated.' : 'EVA lost.'}</h3>
            <p>{snap.outcome.reason}</p>
            <dl className="game-stats">
              <div><dt>Science</dt><dd>{s.science} pts</dd></div>
              <div><dt>Stations</dt><dd>{done}/{snap.route.length} planned</dd></div>
              <div><dt>EVA time</dt><dd>{fmtTime(s.elapsed)}</dd></div>
              <div><dt>Distance</dt><dd>{(snap.distance / 1000).toFixed(2)} km</dd></div>
              <div><dt>O₂ left</dt><dd>{Math.max(0, s.oxygen).toFixed(3)} kg</dd></div>
              <div><dt>Dose</dt><dd>{(z.doseUGy / 1000).toFixed(3)} mGy</dd></div>
            </dl>
            <div className="game-actions">
              <button type="button" className="game-cta" onClick={onRestart}>Play again</button>
              <button type="button" className="game-ghost" onClick={saveLog}>Save action log</button>
              <button type="button" className="game-ghost" onClick={onExit}>Back to base</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
