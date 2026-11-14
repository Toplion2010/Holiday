// One EVA as a game: resources come from the ARES engine (consume/inject/rates),
// movement and terrain come from the Martian Map walk scene.

import * as THREE from 'three'
import { consume, initial, inject, record } from '../expedition/engine'
import { ACTIVITIES, rates, scienceValue } from '../expedition/model'
import type { Activity, Config, State, Target, XY } from '../expedition/types'
import { METERS_PER_DEG } from '../lib/site'
import { lonLatToLocal, localToLonLat, type LocalFrame } from '@/features/walk/geo'
import { DEFAULT_TAU } from '@/features/sky/skyDome'
import type { WalkFrameInfo, WalkScene } from '@/features/walk/walkScene'
import { Astronaut } from './astronaut'

export const INTERACT_M = 10
export const BASE_RADIUS_M = 20
const ASSUMED_RETURN_SPEED = 0.7
const ROUTE_FACTOR = 1.4
const REPAIR_S = 5 * 60

export type View = 'third' | 'first'
export type EventKind = 'leak' | 'dust' | 'comms' | 'battery'
export interface GameEvent { kind: EventKind; title: string; text: string; until: number }

export interface GameTarget extends Target { x: number; z: number }

export interface Snapshot {
  state: State
  view: View
  nearTarget: GameTarget | null
  atBase: boolean
  baseDistance: number
  activity: { target: GameTarget; activity: Activity; elapsed: number } | null
  repair: number | null
  choosing: GameTarget | null
  events: GameEvent[]
  returnMargin: number
  returnNow: boolean
  outcome: null | { won: boolean; reason: string }
  distance: number
}

const EVENT_TEXT: Record<EventKind, [string, string]> = {
  leak: ['Suit pressure leak', 'Oxygen use is doubled. Press R to patch the suit (5 min).'],
  dust: ['Dust storm', 'Optical depth is rising, visibility is falling. Consider heading back.'],
  comms: ['Comms blackout', 'No link to the habitat. Navigation data is local only.'],
  battery: ['Rover battery fault', 'Rover battery lost 65 % of its charge.'],
}

export async function loadTargets(frame: LocalFrame): Promise<GameTarget[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/gale/candidate-science-targets.geojson`)
  if (!res.ok) throw new Error('Science targets are missing')
  const json = await res.json()
  // Same mapping as expedition/data.ts loadPackage, plus local scene coordinates.
  return json.features.map((f: { geometry: { coordinates: number[] }; properties: Record<string, unknown> }, i: number) => {
    const p = f.properties
    const [lon, lat] = f.geometry.coordinates
    const xy: XY = [lon * METERS_PER_DEG, lat * METERS_PER_DEG]
    const local = lonLatToLocal(frame, lon, lat)
    return {
      id: p.id, name: String(p.name).replace(' observation station', '').replace(' campaign station', ''),
      xy, observedXY: [...xy], purpose: p.purpose, source: p.evidence_url, uncertainty: p.display_uncertainty_m,
      activities: structuredClone(ACTIVITIES), selected: 'skip', required: i === 0,
      theme: i === 0 ? 'stratigraphy' : i === 4 ? 'geomorphology' : 'groundwater',
      date: p.observation_date, sol: p.observation_sol, locationNote: p.coordinate_role, x: local.x, z: local.z,
    } as GameTarget
  })
}

export class GameSession {
  state: State
  view: View = 'third'
  readonly astronaut = new Astronaut()
  private beacons = new THREE.Group()
  private beaconMats = new Map<string, THREE.MeshBasicMaterial>()
  private baseBeacon: THREE.Mesh | null = null
  private base: { x: number; z: number } | null = null
  private last: { x: number; z: number } | null = null
  private savedCam = new THREE.Vector3()
  private fwd = new THREE.Vector3()
  private labelEls = new Map<string, HTMLDivElement>()
  private addedToScene = false
  /** Tall POI beacons from the walk scene; hidden up close, where they would fill the view. */
  private sceneBeacons: THREE.Object3D[] = []
  private emitTimer = 0
  private nextEventAt: number
  private scene: WalkScene | null = null
  activity: Snapshot['activity'] = null
  repair: number | null = null
  choosing: GameTarget | null = null
  events: GameEvent[] = []
  outcome: Snapshot['outcome'] = null
  distance = 0
  private snap: Snapshot | null = null

  constructor(
    config: Config,
    readonly frame: LocalFrame,
    readonly targets: GameTarget[],
    private labelHost: () => HTMLElement | null,
    private onSnapshot: (s: Snapshot) => void,
  ) {
    this.state = initial(config)
    this.state.running = true
    this.nextEventAt = 20 * 60 + Math.random() * 20 * 60
    void this.astronaut.load(`${import.meta.env.BASE_URL}models/mars_astronaut_animated.glb`)
  }

  attach(scene: WalkScene | null): void {
    this.scene = scene
  }

  // ---------- frame hooks ----------

  beforeRender = (info: WalkFrameInfo): void => {
    if (!this.addedToScene) {
      info.scene.add(this.astronaut.group, this.beacons)
      this.buildBeacons(info)
      info.scene.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.CylinderGeometry | undefined
        if (g?.type === 'CylinderGeometry' && g.parameters.height >= 100 && o.parent === info.scene) this.sceneBeacons.push(o)
      })
      this.addedToScene = true
    }
    if (!this.base) this.base = { x: info.x, z: info.z }
    const last = this.last ?? { x: info.x, z: info.z }
    const dx = info.x - last.x
    const dz = info.z - last.z
    this.last = { x: info.x, z: info.z }
    const moved = Math.hypot(dx, dz)
    this.distance += moved

    if (!this.outcome) this.simulate(info, dx, dz, moved)

    const walking = info.vehicle === 'walk'
    const g = info.ground(info.x, info.z)
    this.astronaut.setVisible(walking && this.view === 'third')
    this.astronaut.update(info.x, g, info.z, dx, dz, info.dt > 0 ? moved / info.dt : 0, info.dt)

    // Third person: pull the camera back along the view direction; restored in afterRender.
    const cam = info.camera
    this.savedCam.copy(cam.position)
    if (this.view === 'third') {
      cam.getWorldDirection(this.fwd)
      const back = walking ? 5 : 10
      const up = walking ? 0.5 : 3.5
      const anchorY = walking && Number.isFinite(g) ? g + 1.55 : cam.position.y
      cam.position.set(info.x - this.fwd.x * back, anchorY - this.fwd.y * back + up, info.z - this.fwd.z * back)
      const floor = info.ground(cam.position.x, cam.position.z)
      if (Number.isFinite(floor) && cam.position.y < floor + 0.6) cam.position.y = floor + 0.6
      cam.updateMatrixWorld()
    }
    for (const b of [...this.beacons.children, ...this.sceneBeacons]) b.visible = Math.hypot(b.position.x - info.x, b.position.z - info.z) > 30
    this.updateLabels(info)

    this.emitTimer -= info.dt
    if (this.emitTimer <= 0) {
      this.emitTimer = 0.2
      this.emit(info)
    }
  }

  afterRender = (info: WalkFrameInfo): void => {
    info.camera.position.copy(this.savedCam)
    info.camera.updateMatrixWorld()
  }

  // ---------- simulation ----------

  private simulate(info: WalkFrameInfo, dx: number, dz: number, moved: number): void {
    const s = this.state
    const dt = info.simDt
    if (dt <= 0) return
    const lonlat = localToLonLat(this.frame, info.x, info.z)
    s.position = [lonlat.lonEast * METERS_PER_DEG, lonlat.lat * METERS_PER_DEG]
    s.aboard = info.vehicle === 'rover'
    if (s.aboard) s.rover = [...s.position]
    if (moved > 0.01) s.heading = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360

    if (moved > 50) {
      // "Go to point" / minimap jump: charged as walking there at the assumed speed.
      consume(s, moved / ASSUMED_RETURN_SPEED, 'walk', 0)
      record(s, 'jump', `Fast-forwarded ${Math.round(moved)} m`)
    }
    const g0 = info.ground(info.x - dx, info.z - dz)
    const g1 = info.ground(info.x, info.z)
    const grade = moved > 0.01 && Number.isFinite(g0) && Number.isFinite(g1) ? (g1 - g0) / moved : 0
    const busy = this.activity || this.repair !== null
    consume(s, dt, busy ? 'work' : moved > 0.001 ? (s.aboard ? 'rover' : 'walk') : 'work', grade)

    if (this.activity) {
      this.activity.elapsed += dt
      if (this.activity.elapsed >= this.activity.activity.seconds) this.finishActivity()
    }
    if (this.repair !== null) {
      this.repair += dt
      if (this.repair >= REPAIR_S) {
        this.repair = null
        delete s.faults.leak
        record(s, 'repair', 'Suit leak patched')
        this.events = this.events.filter((e) => e.kind !== 'leak')
        this.scene?.setInputEnabled(true)
      }
    }

    this.events = this.events.filter((e) => {
      if (e.kind === 'leak' || s.elapsed < e.until) return true
      if (e.kind === 'dust') this.scene?.setTau(DEFAULT_TAU)
      return false
    })
    if (s.elapsed >= this.nextEventAt) {
      this.nextEventAt = s.elapsed + 25 * 60 + Math.random() * 35 * 60
      this.triggerEvent()
    }

    if (s.aboard && s.roverWh <= 0) {
      s.roverWh = 0
      this.scene?.setVehicle('walk')
      record(s, 'rover', 'Rover battery empty: continuing on foot')
    }
    if (s.oxygen <= 0) this.end(false, 'Oxygen ran out before you reached the habitat.')
    else if (s.suitWh <= 0) this.end(false, 'Suit power ran out: life support stopped.')
    else if (s.elapsed >= s.config.duration) this.end(false, 'The EVA time limit was exceeded.')
  }

  private triggerEvent(): void {
    const s = this.state
    const options: EventKind[] = ['dust', 'comms']
    if (!s.faults.leak) options.push('leak')
    if (s.aboard) options.push('battery')
    const kind = options[Math.floor(Math.random() * options.length)]
    const [title, text] = EVENT_TEXT[kind]
    const until = s.elapsed + (kind === 'dust' ? 40 * 60 : kind === 'comms' ? 15 * 60 : 1e12)
    if (kind === 'leak' || kind === 'battery') {
      // Engine fault injection keeps the record and effects (leak doubles O₂ rate).
      const next = inject(s, kind)
      this.state = { ...next, running: true }
    } else {
      record(s, 'event', title)
    }
    if (kind === 'dust') this.scene?.setTau(2.5)
    if (kind !== 'battery') this.events.push({ kind, title, text, until })
    else this.events.push({ kind, title, text, until: s.elapsed + 10 * 60 })
  }

  private finishActivity(): void {
    const a = this.activity
    if (!a) return
    const s = this.state
    const value = scienceValue(a.target, a.activity, s.config.objective, s.completedThemes)
    s.completed[a.target.id] = a.activity.id
    s.science += value
    s.completedThemes[a.target.theme] = (s.completedThemes[a.target.theme] ?? 0) + 1
    record(s, 'science', `Completed simulated ${a.activity.name} at ${a.target.name}`, { target: a.target.id, activity: a.activity.id, value, simulated: true })
    this.beaconMats.get(a.target.id)?.color.set('#8fd0a0')
    this.activity = null
    this.scene?.setInputEnabled(true)
  }

  private end(won: boolean, reason: string): void {
    if (this.outcome) return
    this.outcome = { won, reason }
    this.state.running = false
    this.state.status = won ? 'Completed' : 'Emergency'
    record(this.state, won ? 'completed' : 'emergency', reason)
    this.activity = null
    this.choosing = null
    this.scene?.setInputEnabled(false)
    globalThis.document?.exitPointerLock?.()
    this.emit(null)
  }

  // ---------- player actions ----------

  interact(): void {
    if (this.outcome || this.activity) return
    const snap = this.snap
    if (!snap) return
    if (snap.atBase && this.state.science > 0) {
      this.end(true, 'You returned to the habitat with your science.')
      return
    }
    if (snap.nearTarget && !this.state.completed[snap.nearTarget.id]) {
      this.choosing = snap.nearTarget
      globalThis.document?.exitPointerLock?.()
      this.emit(null)
    }
  }

  startActivity(id: string): void {
    const t = this.choosing
    const a = t?.activities.find((x) => x.id === id)
    if (!t || !a) return
    this.choosing = null
    this.activity = { target: t, activity: a, elapsed: 0 }
    this.scene?.setInputEnabled(false)
    this.emit(null)
  }

  cancelChoice(): void {
    this.choosing = null
    this.emit(null)
  }

  startRepair(): void {
    if (!this.state.faults.leak || this.repair !== null || this.activity || this.outcome) return
    this.repair = 0
    this.scene?.setInputEnabled(false)
    this.emit(null)
  }

  toggleView(): void {
    this.view = this.view === 'third' ? 'first' : 'third'
    this.emit(null)
  }

  // ---------- scene objects ----------

  private buildBeacons(info: WalkFrameInfo): void {
    const geo = new THREE.CylinderGeometry(0.35, 0.35, 80, 12, 1, true)
    geo.translate(0, 40, 0)
    for (const t of this.targets) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ff7a2e', transparent: true, opacity: 0.4, depthWrite: false, fog: false, toneMapped: false })
      const m = new THREE.Mesh(geo, mat)
      m.position.set(t.x, info.ground(t.x, t.z), t.z)
      m.userData.id = t.id
      this.beacons.add(m)
      this.beaconMats.set(t.id, mat)
    }
    const baseMat = new THREE.MeshBasicMaterial({ color: '#5fa8ff', transparent: true, opacity: 0.4, depthWrite: false, fog: false, toneMapped: false })
    this.baseBeacon = new THREE.Mesh(geo, baseMat)
    this.baseBeacon.position.set(info.x, info.ground(info.x, info.z), info.z)
    this.beacons.add(this.baseBeacon)
  }

  private updateLabels(info: WalkFrameInfo): void {
    const host = this.labelHost()
    if (!host) return
    const w = host.clientWidth
    const h = host.clientHeight
    const v = new THREE.Vector3()
    const items: { id: string; text: string; x: number; y: number; z: number; done: boolean }[] = this.targets.map((t) => ({
      id: t.id, text: t.name, x: t.x, y: info.ground(t.x, t.z) + 4, z: t.z, done: !!this.state.completed[t.id],
    }))
    if (this.base) items.push({ id: '__base', text: 'Habitat', x: this.base.x, y: info.ground(this.base.x, this.base.z) + 6, z: this.base.z, done: false })
    for (const it of items) {
      let el = this.labelEls.get(it.id)
      if (!el) {
        el = document.createElement('div')
        el.className = 'game-label'
        host.appendChild(el)
        this.labelEls.set(it.id, el)
      }
      v.set(it.x, it.y, it.z).project(info.camera)
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1 || !Number.isFinite(it.y)) {
        el.style.display = 'none'
        continue
      }
      const d = Math.hypot(it.x - info.x, it.z - info.z)
      el.style.display = 'block'
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`
      el.textContent = `${it.done ? '✓ ' : ''}${it.text} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(2) + ' km'}`
      el.classList.toggle('is-done', it.done)
      el.classList.toggle('is-base', it.id === '__base')
    }
  }

  private emit(info: WalkFrameInfo | null): void {
    const s = this.state
    let nearTarget = this.snap?.nearTarget ?? null
    let baseDistance = this.snap?.baseDistance ?? 0
    if (info) {
      nearTarget = null
      let best = INTERACT_M
      for (const t of this.targets) {
        const d = Math.hypot(t.x - info.x, t.z - info.z)
        if (d < best) {
          best = d
          nearTarget = t
        }
      }
      baseDistance = this.base ? Math.hypot(this.base.x - info.x, this.base.z - info.z) : 0
    }
    // Simple turnaround estimate: straight-line distance × route factor at 0.7 m/s, walking O₂ rate.
    const walkRate = rates(s, 'walk', 0).oxygen
    const need = ((baseDistance * ROUTE_FACTOR) / ASSUMED_RETURN_SPEED) * walkRate
    const reserve = s.config.oxygen * s.config.reserve
    const returnMargin = (s.oxygen - need - reserve) / walkRate
    this.snap = {
      state: s, view: this.view, nearTarget, atBase: baseDistance < BASE_RADIUS_M, baseDistance,
      activity: this.activity ? { ...this.activity } : null, repair: this.repair, choosing: this.choosing,
      events: [...this.events], returnMargin, returnNow: returnMargin < 0, outcome: this.outcome, distance: this.distance,
    }
    this.onSnapshot(this.snap)
  }

  dispose(): void {
    for (const el of this.labelEls.values()) el.remove()
    this.labelEls.clear()
  }
}
