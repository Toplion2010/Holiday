// One EVA as a game: resources come from the ARES engine (consume/inject/rates),
// movement and terrain come from the Martian Map walk scene. On top: an ordered route
// (A → B → C), autopilot home, a health model, hazards and voice commands.

import * as THREE from 'three'
import { consume, initial, inject, record } from '../expedition/engine'
import { ACTIVITIES, rates, scienceValue } from '../expedition/model'
import type { Activity, Config, State, Target, XY } from '../expedition/types'
import { METERS_PER_DEG } from '../lib/site'
import base from '../data/base.json'
import { lonLatToLocal, localToLonLat, type LocalFrame } from '@/features/walk/geo'
import { DEFAULT_TAU } from '@/features/sky/skyDome'
import type { WalkExtra, WalkFrameInfo, WalkScene } from '@/features/walk/walkScene'
import type { WalkState } from '@/app/modeContract'
import { Astronaut } from './astronaut'

export const INTERACT_M = 10
export const BASE_RADIUS_M = 20
export const ASSUMED_SPEED = 0.7
export const ROUTE_FACTOR = 1.4
const REPAIR_S = 5 * 60
const CRUMB_M = 3
const HR_CRITICAL = 175

export type View = 'third' | 'first'
export type EventKind = 'leak' | 'dust' | 'comms' | 'battery' | 'spe' | 'medical' | 'wheel'
export interface GameEvent { kind: EventKind; title: string; text: string; until: number }
export type AutopilotReason = 'manual' | 'oxygen' | 'medical'

export interface GameTarget extends Target { x: number; z: number }
export interface RouteStop { id: string; activity: string }

export interface Health {
  heartRate: number
  suitTempC: number
  o2Pct: number
  suitPct: number
  roverPct: number
  wheels: 'OK' | 'Degraded'
  status: 'Nominal' | 'Caution' | 'Critical'
}
export interface Hazards {
  doseUGy: number
  rateUGyH: number
  windMs: number
  dust: string
  sunElevationDeg: number | null
  daylightLeftH: number | null
  night: boolean
}

export interface Snapshot {
  state: State
  view: View
  nearTarget: GameTarget | null
  next: { target: GameTarget; index: number; distance: number; activity: string } | null
  route: RouteStop[]
  plannedValue: number
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
  autopilot: AutopilotReason | null
  health: Health
  hazards: Hazards
  message: string | null
}

const EVENT_TEXT: Record<EventKind, [string, string]> = {
  leak: ['Suit pressure leak', 'Oxygen use is doubled. Press R to patch the suit (5 min).'],
  dust: ['Dust storm', 'Wind and dust are rising, visibility is falling. Consider heading back.'],
  comms: ['Comms blackout', 'No link to the habitat. Navigation data is local only.'],
  battery: ['Rover battery fault', 'Rover battery lost 65 % of its charge.'],
  spe: ['Solar particle event', 'Radiation is 30× background. Head back to the habitat.'],
  medical: ['Crew member down', 'Vital signs critical. Autopilot is evacuating to HAB-1.'],
  wheel: ['Rover wheel damage', 'Rover drives slower and uses more power.'],
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

/** Rough plan for the base screen: straight legs × route factor at the assumed walking speed. */
export function estimateRoute(config: Config, targets: GameTarget[], route: RouteStop[], start: { x: number; z: number }) {
  const s = initial(config)
  const walkO2 = rates(s, 'walk', 0).oxygen
  const workO2 = rates(s, 'work', 0).oxygen
  const themes: Record<string, number> = {}
  let at = start
  let distance = 0
  let workS = 0
  let value = 0
  const legs: { id: string; distance: number; value: number }[] = []
  for (const stop of route) {
    const t = targets.find((x) => x.id === stop.id)
    const a = t?.activities.find((x) => x.id === stop.activity)
    if (!t || !a) continue
    const d = Math.hypot(t.x - at.x, t.z - at.z) * ROUTE_FACTOR
    const v = scienceValue(t, a, config.objective, themes)
    themes[t.theme] = (themes[t.theme] ?? 0) + 1
    distance += d
    workS += a.seconds
    value += v
    legs.push({ id: t.id, distance: d, value: v })
    at = t
  }
  distance += Math.hypot(at.x - start.x, at.z - start.z) * ROUTE_FACTOR
  const walkS = distance / ASSUMED_SPEED
  const seconds = walkS + workS
  const oxygen = walkS * walkO2 + workS * workO2
  const suitWh = (seconds * config.suitW) / 3600
  const o2Budget = config.oxygen * (1 - config.reserve)
  return { distance, seconds, oxygen, suitWh, value, legs, feasible: oxygen <= o2Budget && suitWh <= config.suitWh * (1 - config.reserve) && seconds <= config.duration, o2Budget }
}

export class GameSession {
  state: State
  view: View = 'third'
  readonly astronaut = new Astronaut()
  private beacons = new THREE.Group()
  private beaconMats = new Map<string, THREE.MeshBasicMaterial>()
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
  private crumbs: { x: number; z: number }[] = []
  private pilot: { reason: AutopilotReason; path: { x: number; z: number }[]; idx: number; heading: number | null; check: { t: number; d: number }; skips: number } | null = null
  private hrHigh = 0
  /** After the player cancels an oxygen autopilot, do not re-engage for 5 simulated minutes. */
  private autoSuppressUntil = 0
  private fatigue = 0
  private solar: WalkExtra['solar'] | null = null
  private message: { text: string; until: number } | null = null
  activity: Snapshot['activity'] = null
  repair: number | null = null
  choosing: GameTarget | null = null
  events: GameEvent[] = []
  outcome: Snapshot['outcome'] = null
  distance = 0
  health: Health
  hazards: Hazards
  private snap: Snapshot | null = null
  /** Spoken output (alerts and voice replies); set by the voice controller. */
  speak: (text: string) => void = () => {}

  constructor(
    config: Config,
    readonly frame: LocalFrame,
    readonly targets: GameTarget[],
    readonly route: RouteStop[],
    private labelHost: () => HTMLElement | null,
    private onSnapshot: (s: Snapshot) => void,
  ) {
    this.state = initial(config)
    this.state.running = true
    this.nextEventAt = 15 * 60 + Math.random() * 20 * 60
    this.health = { heartRate: 72, suitTempC: 22, o2Pct: 100, suitPct: 100, roverPct: 100, wheels: 'OK', status: 'Nominal' }
    this.hazards = { doseUGy: 0, rateUGyH: base.conditions.radiationUGyH, windMs: base.conditions.windMs, dust: 'Low', sunElevationDeg: null, daylightLeftH: null, night: false }
    void this.astronaut.load(`${import.meta.env.BASE_URL}models/mars_astronaut_animated.glb`)
  }

  attach(scene: WalkScene | null): void {
    this.scene = scene
  }

  onWalkState = (_s: WalkState, extra: WalkExtra): void => {
    this.solar = extra.solar
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
    if (!this.base) {
      this.base = { x: info.x, z: info.z }
      this.crumbs.push({ ...this.base })
    }
    const last = this.last ?? { x: info.x, z: info.z }
    const dx = info.x - last.x
    const dz = info.z - last.z
    this.last = { x: info.x, z: info.z }
    const moved = Math.hypot(dx, dz)
    if (moved < 50) this.distance += moved
    const tail = this.crumbs[this.crumbs.length - 1]
    if (!this.pilot && Math.hypot(info.x - tail.x, info.z - tail.z) > CRUMB_M) this.crumbs.push({ x: info.x, z: info.z })

    if (!this.outcome) {
      this.simulate(info, dx, dz, moved)
      if (this.pilot) this.steer(info, dx, dz)
    }

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
    const nextId = this.nextStop()?.target.id
    for (const b of this.beacons.children) {
      b.visible = Math.hypot(b.position.x - info.x, b.position.z - info.z) > 30
      const mat = (b as THREE.Mesh).material as THREE.MeshBasicMaterial
      if (b.userData.id && !this.state.completed[b.userData.id]) mat.opacity = b.userData.id === nextId ? 0.6 : 0.2
    }
    for (const b of this.sceneBeacons) b.visible = Math.hypot(b.position.x - info.x, b.position.z - info.z) > 30
    this.updateLabels(info, nextId)

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
      consume(s, moved / ASSUMED_SPEED, 'walk', 0)
      record(s, 'jump', `Fast-forwarded ${Math.round(moved)} m`)
    }
    const g0 = info.ground(info.x - dx, info.z - dz)
    const g1 = info.ground(info.x, info.z)
    const grade = moved > 0.01 && moved < 50 && Number.isFinite(g0) && Number.isFinite(g1) ? (g1 - g0) / moved : 0
    const busy = this.activity || this.repair !== null
    const mode = busy ? 'work' : moved > 0.001 ? (s.aboard ? 'rover' : 'walk') : 'work'
    consume(s, dt, mode, grade)
    // Suit heaters work harder without sunlight; a damaged wheel costs extra rover power.
    if (this.hazards.night) s.suitWh -= (dt * 60) / 3600
    if (s.aboard && moved > 0.001 && s.faults.wheel) s.roverWh -= (dt * s.config.driveW * 0.5) / 3600

    this.updateHealth(dt, mode, grade, moved)
    this.updateHazards(dt)

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
        this.say('Suit leak patched.')
      }
    }

    this.events = this.events.filter((e) => {
      if (e.kind === 'leak' || e.kind === 'medical' || s.elapsed < e.until) return true
      if (e.kind === 'dust') this.scene?.setTau(DEFAULT_TAU)
      return false
    })
    if (s.elapsed >= this.nextEventAt) {
      this.nextEventAt = s.elapsed + 20 * 60 + Math.random() * 30 * 60
      this.triggerEvent()
    }

    if (s.aboard && s.roverWh <= 0) {
      s.roverWh = 0
      this.scene?.setVehicle('walk')
      record(s, 'rover', 'Rover battery empty: continuing on foot')
      this.say('Rover battery empty. Continue on foot.')
    }

    // Emergencies: autopilot takes over.
    const margin = this.returnMargin()
    if (!this.pilot && margin < 0 && !this.activity && s.elapsed > this.autoSuppressUntil && this.baseDistance(info) > BASE_RADIUS_M) {
      this.engageAutopilot('oxygen')
    }
    if (this.health.heartRate > HR_CRITICAL) this.hrHigh += dt
    else this.hrHigh = Math.max(0, this.hrHigh - dt)
    if (this.hrHigh > 120 && this.pilot?.reason !== 'medical') this.medicalEmergency('Heart rate stayed above 175 bpm.')

    if (s.oxygen <= 0) this.end(false, 'Oxygen ran out before you reached the habitat.')
    else if (s.suitWh <= 0) this.end(false, 'Suit power ran out: life support stopped.')
    else if (s.elapsed >= s.config.duration) this.end(false, 'The EVA time limit was exceeded.')
  }

  private updateHealth(dt: number, mode: 'walk' | 'rover' | 'work', grade: number, moved: number): void {
    const s = this.state
    const h = this.health
    const effort = this.events.some((e) => e.kind === 'medical')
      ? 0
      : mode === 'walk' ? 1 + Math.max(0, grade) * 6 : mode === 'rover' ? 0.35 : this.activity ? 0.6 : moved > 0 ? 0.4 : 0.25
    this.fatigue = Math.max(0, this.fatigue + (effort > 1 ? (effort - 1) * dt : -dt * 0.5) / 600)
    let target = 62 + 42 * Math.min(2.4, effort) + this.fatigue * 12 + (s.faults.leak ? 14 : 0)
    if (this.events.some((e) => e.kind === 'medical')) target = 38
    // Heart rate follows effort with a ~30 s lag (simulated time).
    h.heartRate += (target - h.heartRate) * Math.min(1, dt / 30)
    const heaterOk = s.suitWh > s.config.suitWh * 0.05
    const tempTarget = heaterOk ? 22 : this.hazards.night ? 4 : 12
    h.suitTempC += (tempTarget - h.suitTempC) * Math.min(1, dt / 600)
    h.o2Pct = (100 * Math.max(0, s.oxygen)) / s.config.oxygen
    h.suitPct = (100 * Math.max(0, s.suitWh)) / s.config.suitWh
    h.roverPct = (100 * Math.max(0, s.roverWh)) / s.config.roverWh
    h.wheels = s.faults.wheel ? 'Degraded' : 'OK'
    const critical = h.heartRate > HR_CRITICAL || h.heartRate < 45 || h.o2Pct < 10 || h.suitPct < 5 || h.suitTempC < 8
    const caution = h.heartRate > 150 || h.o2Pct < 25 || h.suitPct < 20 || !!s.faults.leak || h.suitTempC < 15
    h.status = critical ? 'Critical' : caution ? 'Caution' : 'Nominal'
  }

  private updateHazards(dt: number): void {
    const z = this.hazards
    const spe = this.events.some((e) => e.kind === 'spe')
    const dust = this.events.some((e) => e.kind === 'dust')
    z.rateUGyH = base.conditions.radiationUGyH * (spe ? 30 : 1)
    z.doseUGy += (z.rateUGyH * dt) / 3600
    const gust = Math.sin(this.state.elapsed / 97) * 2 + Math.sin(this.state.elapsed / 23) * 1.2
    z.windMs = Math.max(0, (dust ? 21 : base.conditions.windMs) + gust)
    z.dust = dust ? 'High (storm)' : 'Low'
    if (this.solar) {
      z.sunElevationDeg = this.solar.elevationDeg
      z.night = this.solar.elevationDeg < -2
      // Sun sets near 18:00 local true solar time at Gale (latitude −4.8°); Mars hours shown as hours.
      z.daylightLeftH = this.solar.ltstHours < 6 || this.solar.ltstHours > 18 ? 0 : 18 - this.solar.ltstHours
    }
  }

  private triggerEvent(): void {
    const s = this.state
    const options: EventKind[] = ['dust', 'comms', 'spe']
    if (!s.faults.leak) options.push('leak')
    if (s.aboard) options.push('battery', 'wheel')
    if (Math.random() < 0.15) options.push('medical')
    const kind = options[Math.floor(Math.random() * options.length)]
    if (kind === 'medical') return this.medicalEmergency('Crew member collapsed during the EVA.')
    const [title, text] = EVENT_TEXT[kind]
    const until = s.elapsed + (kind === 'dust' ? 40 * 60 : kind === 'spe' ? 30 * 60 : kind === 'comms' ? 15 * 60 : kind === 'leak' || kind === 'wheel' ? 1e12 : 10 * 60)
    if (kind === 'leak' || kind === 'battery' || kind === 'wheel') {
      // Engine fault injection keeps the record and effects (leak doubles O₂ rate).
      const next = inject(s, kind)
      this.state = { ...next, running: true }
    } else {
      record(s, 'event', title)
    }
    if (kind === 'dust') this.scene?.setTau(2.5)
    this.events.push({ kind, title, text, until })
    this.say(`${title}. ${text.split('.')[0]}.`)
  }

  private medicalEmergency(reason: string): void {
    if (this.events.some((e) => e.kind === 'medical')) return
    const [title, text] = EVENT_TEXT.medical
    this.events.push({ kind: 'medical', title, text, until: 1e12 })
    record(this.state, 'medical', reason)
    this.choosing = null
    this.engageAutopilot('medical')
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
    const next = this.nextStop()
    this.say(`${a.activity.name} complete, ${value} points. ${next ? `Next stop: ${next.target.name}.` : 'Route complete. Return to base.'}`)
  }

  private end(won: boolean, reason: string): void {
    if (this.outcome) return
    this.outcome = { won, reason }
    this.pilot = null
    this.scene?.setJoystick(0, 0)
    this.state.running = false
    this.state.status = won ? 'Completed' : 'Emergency'
    record(this.state, won ? 'completed' : 'emergency', reason)
    this.activity = null
    this.choosing = null
    this.scene?.setInputEnabled(false)
    globalThis.document?.exitPointerLock?.()
    this.say(won ? 'Welcome home. EVA complete.' : `Mission failed. ${reason}`)
    this.emit(null)
  }

  // ---------- autopilot ----------

  /** Retrace the walked path home: every crumb was already crossed safely. */
  engageAutopilot(reason: AutopilotReason): void {
    if (this.outcome || !this.base) return
    if (this.activity) {
      this.activity = null
      this.scene?.setInputEnabled(true)
    }
    if (this.repair !== null) {
      this.repair = null
      this.scene?.setInputEnabled(true)
    }
    const path = [...this.crumbs].reverse()
    this.pilot = { reason, path, idx: 0, heading: null, check: { t: 0, d: Infinity }, skips: 0 }
    globalThis.document?.exitPointerLock?.()
    record(this.state, 'autopilot', `Autopilot home engaged (${reason})`)
    this.say(
      reason === 'oxygen' ? 'Warning. Oxygen reserve reached. Autopilot engaged, returning to base.'
        : reason === 'medical' ? 'Emergency. Crew vital signs critical. Autopilot evacuating to base.'
        : 'Autopilot engaged. Returning to base.',
    )
    this.emit(null)
  }

  cancelAutopilot(): void {
    if (!this.pilot || this.pilot.reason === 'medical') return
    if (this.pilot.reason === 'oxygen') this.autoSuppressUntil = this.state.elapsed + 300
    this.pilot = null
    this.scene?.setJoystick(0, 0)
    record(this.state, 'autopilot', 'Autopilot cancelled')
    this.say('Autopilot off. Manual control.')
    this.emit(null)
  }

  toggleAutopilot(): void {
    if (this.pilot) this.cancelAutopilot()
    else this.engageAutopilot('manual')
  }

  /** Blocks movement keys while the crew member is incapacitated. */
  get inputLocked(): boolean {
    return this.pilot?.reason === 'medical'
  }

  private steer(info: WalkFrameInfo, dx: number, dz: number): void {
    const p = this.pilot!
    let target = p.path[p.idx]
    while (target && Math.hypot(target.x - info.x, target.z - info.z) < 2.5) {
      p.idx++
      target = p.path[p.idx]
    }
    if (!target) return this.arrive()
    const tx = target.x - info.x
    const tz = target.z - info.z
    const d = Math.hypot(tx, tz)
    // Progress check every 4 s of real time: skip a crumb that cannot be reached.
    p.check.t += info.dt
    if (p.check.t > 4) {
      if (p.check.d - d < 0.5) {
        // Stuck: skip an intermediate crumb, but never the habitat itself.
        if (p.idx < p.path.length - 1) p.idx++
        p.skips++
        if (p.skips > 6 && this.base) {
          // Give up retracing: fast-forward home, charged as walking (see simulate).
          record(this.state, 'autopilot', 'Path blocked: fast-forwarding along the safe route home')
          this.scene?.teleport(this.base.x, this.base.z)
          p.skips = 0
        }
      }
      p.check = { t: 0, d }
    }
    if (info.vehicle === 'walk') {
      // Camera looks along −Z at yaw 0, so the yaw facing (tx, tz) is atan2(−tx, −tz).
      const want = Math.atan2(-tx, -tz)
      const r = info.camera.rotation
      const diff = Math.atan2(Math.sin(want - r.y), Math.cos(want - r.y))
      r.y += diff * Math.min(1, info.dt * 4)
      r.x += (-0.12 - r.x) * Math.min(1, info.dt * 2)
      this.scene?.setJoystick(0, 1)
    } else {
      // Rover: steer by the direction it is actually moving.
      if (Math.hypot(dx, dz) > 1e-3) p.heading = Math.atan2(dx, dz)
      const want = Math.atan2(tx, tz)
      const diff = p.heading === null ? 0 : Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading))
      this.scene?.setJoystick(Math.max(-1, Math.min(1, -diff * 2)), Math.abs(diff) > 1.2 ? 0.3 : 1)
    }
  }

  private arrive(): void {
    const reason = this.pilot?.reason
    this.pilot = null
    this.scene?.setJoystick(0, 0)
    record(this.state, 'autopilot', 'Autopilot arrived at HAB-1')
    if (reason === 'medical') {
      this.end(false, 'Evacuated to HAB-1 by autopilot after a medical emergency. Crew is safe; EVA aborted.')
      return
    }
    this.say('Arrived at HAB-1. Press E to enter the habitat.')
    this.flash('Autopilot: arrived at HAB-1')
  }

  // ---------- player actions ----------

  interact(): void {
    if (this.outcome || this.activity || this.inputLocked) return
    const snap = this.snap
    if (!snap) return
    if (snap.atBase && (this.state.science > 0 || this.distance > 50)) {
      this.end(this.state.science > 0, this.state.science > 0 ? 'You returned to the habitat with your science.' : 'You returned to the habitat without science.')
      return
    }
    if (snap.nearTarget && !this.state.completed[snap.nearTarget.id]) {
      if (this.pilot) this.cancelAutopilot()
      this.choosing = snap.nearTarget
      globalThis.document?.exitPointerLock?.()
      this.emit(null)
    }
  }

  plannedActivity(id: string): string | null {
    return this.route.find((r) => r.id === id)?.activity ?? null
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

  // ---------- voice ----------

  /** Handles a spoken command (wake word already removed). Returns the spoken reply. */
  voiceCommand(raw: string): string {
    const c = raw.toLowerCase()
    const snap = this.snap
    const s = this.state
    const has = (...w: string[]) => w.some((x) => c.includes(x))
    if (has('cancel', 'stop autopilot', 'manual')) {
      if (this.pilot?.reason === 'medical') return 'Cannot cancel. Medical evacuation in progress.'
      this.cancelAutopilot()
      return 'Autopilot off.'
    }
    if (has('home', 'base', 'return', 'autopilot', 'evacuat')) {
      this.engageAutopilot('manual')
      return 'Autopilot engaged. Returning to base.'
    }
    if (has('next', 'where', 'destination', 'route')) {
      const n = snap?.next
      return n ? `Next stop ${n.target.name}, ${Math.round(n.distance)} metres, bearing shown on the beacon.` : 'All planned stops are done. Return to base.'
    }
    if (has('health', 'heart', 'vital')) {
      const h = this.health
      return `Heart rate ${Math.round(h.heartRate)}. Suit temperature ${Math.round(h.suitTempC)} degrees. Status ${h.status}.`
    }
    if (has('radiation', 'hazard', 'weather', 'wind', 'dust', 'sun')) {
      const z = this.hazards
      return `Radiation ${z.rateUGyH.toFixed(0)} micrograys per hour, dose ${(z.doseUGy / 1000).toFixed(2)} millisieverts. Wind ${Math.round(z.windMs)} metres per second. Dust ${z.dust}.${z.daylightLeftH !== null ? ` About ${z.daylightLeftH.toFixed(1)} hours of daylight left.` : ''}`
    }
    if (has('science', 'work', 'sample', 'start')) {
      this.interact()
      return snap?.nearTarget ? `Opening work options at ${snap.nearTarget.name}.` : 'No science station within 10 metres.'
    }
    if (has('repair', 'patch', 'leak')) {
      this.startRepair()
      return s.faults.leak ? 'Patching the suit.' : 'No suit leak detected.'
    }
    if (has('status', 'oxygen', 'how much', 'report')) {
      const m = this.returnMargin()
      return `Oxygen ${Math.round(this.health.o2Pct)} percent. Suit battery ${Math.round(this.health.suitPct)} percent. ${m < 0 ? 'Return now.' : `Turn back within ${Math.round(m / 60)} minutes.`} Science ${s.science} points.`
    }
    return 'Commands: status, next stop, health, hazards, start science, repair, go home, cancel autopilot.'
  }

  private say(text: string): void {
    this.flash(text)
    this.speak(text)
  }

  private flash(text: string): void {
    this.message = { text, until: performance.now() + 6000 }
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
    const baseBeacon = new THREE.Mesh(geo, baseMat)
    baseBeacon.position.set(info.x, info.ground(info.x, info.z), info.z)
    this.beacons.add(baseBeacon)
  }

  private updateLabels(info: WalkFrameInfo, nextId: string | undefined): void {
    const host = this.labelHost()
    if (!host) return
    const w = host.clientWidth
    const h = host.clientHeight
    const v = new THREE.Vector3()
    const order = new Map(this.route.map((r, i) => [r.id, i]))
    const items: { id: string; text: string; x: number; y: number; z: number; done: boolean }[] = this.targets.map((t) => {
      const i = order.get(t.id)
      return { id: t.id, text: `${i !== undefined ? String.fromCharCode(65 + i) + ' · ' : ''}${t.name}`, x: t.x, y: info.ground(t.x, t.z) + 4, z: t.z, done: !!this.state.completed[t.id] }
    })
    if (this.base) items.push({ id: '__base', text: 'HAB-1', x: this.base.x, y: info.ground(this.base.x, this.base.z) + 6, z: this.base.z, done: false })
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
      el.classList.toggle('is-next', it.id === nextId)
      el.classList.toggle('is-off-route', !order.has(it.id) && it.id !== '__base')
    }
  }

  // ---------- derived values ----------

  private nextStop(): { target: GameTarget; index: number; activity: string } | null {
    for (let i = 0; i < this.route.length; i++) {
      const r = this.route[i]
      if (this.state.completed[r.id]) continue
      const t = this.targets.find((x) => x.id === r.id)
      if (t) return { target: t, index: i, activity: r.activity }
    }
    return null
  }

  private baseDistance(info: { x: number; z: number }): number {
    return this.base ? Math.hypot(this.base.x - info.x, this.base.z - info.z) : 0
  }

  /** Seconds of walking left before the O₂ reserve is needed for the trip home (simple estimate). */
  private returnMargin(): number {
    const s = this.state
    const walkRate = rates(s, 'walk', 0).oxygen
    const need = ((this.lastBaseDistance * ROUTE_FACTOR) / ASSUMED_SPEED) * walkRate
    const reserve = s.config.oxygen * s.config.reserve
    return (s.oxygen - need - reserve) / walkRate
  }

  private lastBaseDistance = 0

  private emit(info: WalkFrameInfo | null): void {
    const s = this.state
    let nearTarget = this.snap?.nearTarget ?? null
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
      this.lastBaseDistance = this.baseDistance(info)
    }
    const pos = this.last ?? { x: 0, z: 0 }
    const n = this.nextStop()
    const next = n ? { ...n, distance: Math.hypot(n.target.x - pos.x, n.target.z - pos.z) } : null
    const plannedValue = estimateRoute(s.config, this.targets, this.route, this.base ?? pos).value
    const returnMargin = this.returnMargin()
    if (this.message && performance.now() > this.message.until) this.message = null
    this.snap = {
      state: s, view: this.view, nearTarget, next, route: this.route, plannedValue,
      atBase: this.lastBaseDistance < BASE_RADIUS_M, baseDistance: this.lastBaseDistance,
      activity: this.activity ? { ...this.activity } : null, repair: this.repair, choosing: this.choosing,
      events: [...this.events], returnMargin, returnNow: returnMargin < 0, outcome: this.outcome, distance: this.distance,
      autopilot: this.pilot?.reason ?? null, health: { ...this.health }, hazards: { ...this.hazards }, message: this.message?.text ?? null,
    }
    this.onSnapshot(this.snap)
  }

  dispose(): void {
    for (const el of this.labelEls.values()) el.remove()
    this.labelEls.clear()
  }
}
