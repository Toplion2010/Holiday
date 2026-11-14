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

const fakeScene = () => ({ setInputEnabled: vi.fn(), setVehicle: vi.fn(), setTau: vi.fn() }) as unknown as WalkScene

function session() {
  const t = target()
  const s = new GameSession({ ...DEFAULT_CONFIG }, frame, [t], () => null, () => {})
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

  it('returning to the habitat with science wins', () => {
    const { s } = session()
    s.beforeRender(info(0, 0, 0))
    s.state.science = 8
    s.beforeRender(info(3, 3, 1))
    s.interact()
    expect(s.outcome?.won).toBe(true)
  })
})
