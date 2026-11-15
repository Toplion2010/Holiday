import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { makeFrame, lonLatToLocal, localToLonLat } from '@/features/walk/geo'
import type { WalkFrameInfo, WalkScene } from '@/features/walk/walkScene'
import { DEFAULT_CONFIG } from '../expedition/model'
import { ACTIVITIES } from '../expedition/model'
import { GameSession, type GameTarget } from './session'

vi.mock('./astronaut', () => ({
  Astronaut: class {
    group = new THREE.Group()
    load() { return Promise.resolve(false) }
    update() {}
    setVisible() {}
  },
}))

// Gale boxwork package frame (manifest.json of the copied site package).
const frame = makeFrame([8142407.61, -285968.09, 8144207.61, -283568.09], 1, 1800, 2400)

const target = (): GameTarget => {
  const l = lonLatToLocal(frame, 137.3804498, -4.80250974)
  return {
    id: 'VPB', name: 'Volcán Peña Blanca', xy: [0, 0], observedXY: [0, 0], purpose: '', source: '', uncertainty: 10,
    activities: structuredClone(ACTIVITIES), selected: 'skip', required: true, theme: 'stratigraphy', date: '', sol: 0,
    locationNote: '', x: l.x, z: l.z,
  }
}

const info = (x: number, z: number, simDt: number, vehicle: 'walk' | 'rover' = 'walk'): WalkFrameInfo => ({
  scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 0.1, simDt, x, z, ground: () => 0,
  vehicle, speedMs: 0.7, locked: true,
})

const fakeScene = () => ({ vehicleYaw: 0, setInputEnabled: vi.fn(), setVehicle: vi.fn(), setTau: vi.fn(), setJoystick: vi.fn(), teleport: vi.fn() }) as unknown as WalkScene

function session() {
  const t = target()
  const s = new GameSession({ ...DEFAULT_CONFIG }, frame, [t], [{ id: 'VPB', activity: 'photo' }], () => null, () => {})
  s.attach(fakeScene())
  return { s, t }
}

describe('ARES game session', () => {
  it('scene coordinates round-trip through lon/lat', () => {
    const p = localToLonLat(frame, 120, -340)
    const back = lonLatToLocal(frame, p.lonEast, p.lat)
    expect(back.x).toBeCloseTo(120, 6)
    expect(back.z).toBeCloseTo(-340, 6)
  })

  it('walking drains oxygen and suit power through the engine model', () => {
    const { s } = session()
    s.beforeRender(info(0, 0, 0))
    s.beforeRender(info(0, -7, 600))
    expect(s.state.oxygen).toBeLessThan(DEFAULT_CONFIG.oxygen)
    expect(s.state.suitWh).toBeLessThan(DEFAULT_CONFIG.suitWh)
    expect(s.state.elapsed).toBeCloseTo(600, 6)
  })

  it('a science activity scores once and frees the player', () => {
    const { s, t } = session()
    s.beforeRender(info(t.x + 2, t.z, 0))
    s.interact()
    expect(s.choosing?.id).toBe('VPB')
    s.startActivity('photo')
    s.beforeRender(info(t.x + 2, t.z, 121))
    expect(s.state.completed.VPB).toBe('photo')
    expect(s.state.science).toBeGreaterThan(0)
    expect(s.activity).toBeNull()
  })

  it('running out of oxygen ends the mission as failed', () => {
    const { s } = session()
    s.beforeRender(info(0, 0, 0))
    s.state.oxygen = 1e-9
    s.beforeRender(info(0, -1, 10))
    expect(s.outcome?.won).toBe(false)
  })

  it('oxygen at the reserve engages autopilot home along the walked path', () => {
    const { s } = session()
    s.beforeRender(info(0, 0, 0))
    for (let z = -4; z >= -400; z -= 4) s.beforeRender(info(0, z, 1))
    s.state.oxygen = s.state.config.oxygen * s.state.config.reserve
    s.beforeRender(info(0, -400, 1))
    s.beforeRender(info(0, -400, 1))
    expect(s.state.log.some((l) => l.kind === 'autopilot')).toBe(true)
    expect(s.inputLocked).toBe(false)
  })

  it('a heart rate held above the limit triggers a medical evacuation', () => {
    const { s } = session()
    s.beforeRender(info(0, 0, 0))
    s.beforeRender(info(0, -60, 1))
    s.health.heartRate = 190
    // Keep effort high so the heart rate stays up for 2 simulated minutes.
    for (let i = 0; i < 30; i++) {
      s.health.heartRate = 260
      s.beforeRender(info(0, -60, 5))
    }
    expect(s.inputLocked).toBe(true)
    expect(s.state.log.some((l) => l.kind === 'medical')).toBe(true)
  })

  it('voice commands answer status and start the autopilot', () => {
    const { s } = session()
    s.beforeRender(info(0, 0, 0))
    s.beforeRender(info(0, -30, 1))
    expect(s.voiceCommand('status')).toMatch(/Oxygen \d+ percent/)
    expect(s.voiceCommand('take me home')).toMatch(/Autopilot engaged/)
  })

  it('a blocked autopilot never reports arrival early and falls back to the habitat', () => {
    const { s } = session()
    const scene = fakeScene()
    s.attach(scene)
    s.beforeRender(info(0, 0, 0))
    s.beforeRender(info(0, -300, 1))
    s.engageAutopilot('manual')
    // Stuck on a slope: the position never changes.
    for (let i = 0; i < 400; i++) s.beforeRender(info(0, -300, 0.1))
    expect(s.state.log.some((l) => l.text === 'Autopilot arrived at HAB-1')).toBe(false)
    expect(scene.teleport).toHaveBeenCalledWith(0, 0)
    s.beforeRender(info(0, 0, 0.1))
    expect(s.state.log.some((l) => l.text === 'Autopilot arrived at HAB-1')).toBe(true)
  })

  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    it(`autopilot returns a stationary rover from yaw ${yaw} with independent camera look`, () => {
      const { s } = session()
      let heading = yaw
      let x = 0, z = -30
      const scene = fakeScene()
      Object.defineProperty(scene, 'vehicleYaw', { get: () => heading })
      s.attach(scene)
      s.beforeRender(info(0, 0, 0, 'rover'))
      s.beforeRender(info(x, z, 0, 'rover'))
      s.engageAutopilot('manual')
      for (let i = 0; i < 800 && !s.state.log.some(l => l.text === 'Autopilot arrived at HAB-1'); i++) {
        const frame = info(x, z, 0.1, 'rover')
        frame.camera.rotation.y = 1.2 // looking elsewhere must not steer the rover
        s.beforeRender(frame)
        const [turn, forward] = vi.mocked(scene.setJoystick).mock.calls.at(-1)!
        heading -= turn * 0.6 * frame.dt
        x -= Math.sin(heading) * forward * frame.dt
        z -= Math.cos(heading) * forward * frame.dt
      }
      expect(Math.hypot(x, z)).toBeLessThan(2.5)
      expect(s.state.log.some(l => l.text === 'Autopilot arrived at HAB-1')).toBe(true)
      expect(scene.teleport).not.toHaveBeenCalled()
    })
  }

  it('returning to the habitat with science wins', () => {
    const { s } = session()
    s.beforeRender(info(0, 0, 0))
    s.state.science = 8
    s.beforeRender(info(3, 3, 1))
    s.interact()
    expect(s.outcome?.won).toBe(true)
  })
})
