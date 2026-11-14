// Game panels over the walk scene, in the Martian Map HUD style.

import type { GameSession, Snapshot } from './session'

const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const fmtMin = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(0, Math.round(s / 60))} min`)

function Bar({ label, value, max, unit, digits = 0, warn }: { label: string; value: number; max: number; unit: string; digits?: number; warn?: boolean }) {
  const f = Math.max(0, Math.min(1, value / max))
  return (
    <div className={`game-bar${warn || f < 0.25 ? ' is-warn' : ''}`}>
      <div className="game-bar-head">
        <span>{label}</span>
        <strong>{Math.max(0, value).toFixed(digits)} {unit}</strong>
      </div>
      <div className="game-bar-track"><i style={{ width: `${f * 100}%` }} /></div>
    </div>
  )
}

export function GameHud({ snap, session, onExit, onRestart }: { snap: Snapshot; session: GameSession; onExit(): void; onRestart(): void }) {
  const s = snap.state
  const c = s.config
  const done = Object.keys(s.completed).length
  const leak = !!s.faults.leak

  const saveLog = () => {
    const blob = new Blob([JSON.stringify({ outcome: snap.outcome, config: c, log: s.log }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ares-eva-log.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <div className="game-suit">
        <div className="game-suit-head">
          <span className="micro-label">EVA {fmtTime(s.elapsed)}</span>
          <span className="game-chip">{snap.view === 'third' ? '3rd person · V' : 'helmet · V'}</span>
        </div>
        <Bar label="Oxygen" value={s.oxygen} max={c.oxygen} unit="kg" digits={3} warn={leak} />
        <Bar label="Suit battery" value={s.suitWh} max={c.suitWh} unit="Wh" />
        {s.aboard && <Bar label="Rover battery" value={s.roverWh} max={c.roverWh} unit="Wh" />}
        <div className="game-row">
          <span>Science</span>
          <strong>{s.science} pts · {done}/{session.targets.length} stations</strong>
        </div>
        <div className={`game-row${snap.returnNow ? ' is-alert' : ''}`}>
          <span>Habitat</span>
          <strong>
            {Math.round(snap.baseDistance)} m · {snap.returnNow ? 'RETURN NOW' : `turn back within ${fmtMin(snap.returnMargin)}`}
          </strong>
        </div>
        <p className="game-note">Estimate: straight line × 1.4 at 0.7 m/s, keeping {Math.round(c.reserve * 100)} % O₂ reserve.</p>
      </div>

      <div className="game-events">
        {snap.events.map((e) => (
          <div key={e.kind} className={`game-event is-${e.kind}`}>
            <strong>{e.title}</strong>
            <span>{e.text}</span>
          </div>
        ))}
        {snap.repair !== null && <div className="game-event is-leak"><strong>Patching suit…</strong><span>{fmtMin(300 - snap.repair)} left</span></div>}
      </div>

      {!snap.outcome && !snap.choosing && (
        <div className="game-prompt">
          {snap.activity ? (
            <>
              <strong>{snap.activity.activity.name}</strong>
              <span>{snap.activity.target.name} · {fmtMin(snap.activity.activity.seconds - snap.activity.elapsed)} left</span>
              <div className="game-bar-track"><i style={{ width: `${(snap.activity.elapsed / snap.activity.activity.seconds) * 100}%` }} /></div>
            </>
          ) : snap.atBase && s.science > 0 ? (
            <><kbd>E</kbd> Enter the habitat and end the EVA</>
          ) : snap.nearTarget && !s.completed[snap.nearTarget.id] ? (
            <><kbd>E</kbd> Work at {snap.nearTarget.name}</>
          ) : snap.nearTarget ? (
            <>{snap.nearTarget.name}: done</>
          ) : leak ? (
            <><kbd>R</kbd> Patch the suit leak</>
          ) : done === 0 ? (
            <>Walk to an orange beacon: a Curiosity science station</>
          ) : (
            <>More stations, or head back to the blue habitat beacon</>
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
                return (
                  <button key={a.id} type="button" disabled={!ok} onClick={() => session.startActivity(a.id)}>
                    <strong>{a.name}</strong>
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
            <span className="micro-label">{snap.outcome.won ? 'Mission complete' : 'Mission failed'}</span>
            <h3>{snap.outcome.won ? 'Welcome home.' : 'EVA lost.'}</h3>
            <p>{snap.outcome.reason}</p>
            <dl className="game-stats">
              <div><dt>Science</dt><dd>{s.science} pts</dd></div>
              <div><dt>Stations</dt><dd>{done}/{session.targets.length}</dd></div>
              <div><dt>EVA time</dt><dd>{fmtTime(s.elapsed)}</dd></div>
              <div><dt>Distance</dt><dd>{(snap.distance / 1000).toFixed(2)} km</dd></div>
              <div><dt>O₂ left</dt><dd>{Math.max(0, s.oxygen).toFixed(3)} kg</dd></div>
              <div><dt>Suit left</dt><dd>{Math.max(0, s.suitWh).toFixed(0)} Wh</dd></div>
            </dl>
            <div className="game-actions">
              <button type="button" className="game-cta" onClick={onRestart}>Play again</button>
              <button type="button" className="game-ghost" onClick={saveLog}>Save action log</button>
              <button type="button" className="game-ghost" onClick={onExit}>Title screen</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
