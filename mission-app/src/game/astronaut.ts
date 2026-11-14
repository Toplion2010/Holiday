// Animated astronaut from mars-exploration-3d (Walk / WalkLeft / WalkRight clips).
// Root motion is stripped: the walk scene owns the position, the clips only move limbs.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const ROOT = 'ASTRONAUT'

export class Astronaut {
  readonly group = new THREE.Group()
  private mixer: THREE.AnimationMixer | null = null
  private walk: THREE.AnimationAction | null = null
  /** Metres the root moves in one Walk cycle; used to match stride to ground speed. */
  private strideSpeed = 0.75
  private yaw = 0
  /** Bind (standing) pose of animated joints, so idle returns to standing, not mid-stride. */
  private rest: { obj: THREE.Object3D; q: THREE.Quaternion }[] = []
  private moving = false
  loaded = false

  async load(url: string): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url)
      const model = gltf.scene
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.castShadow = true
          mesh.receiveShadow = true
        }
      })
      this.group.add(model)
      model.traverse((o) => {
        if (/^(HIP|KNEE|SHOULDER)_/.test(o.name)) this.rest.push({ obj: o, q: o.quaternion.clone() })
      })
      this.mixer = new THREE.AnimationMixer(model)
      const clip = THREE.AnimationClip.findByName(gltf.animations, 'Walk')
      if (clip) {
        const root = clip.tracks.find((t) => t.name === `${ROOT}.position`)
        if (root && root.times.length > 1) {
          const v = root.values
          const n = v.length - 3
          const dist = Math.hypot(v[n] - v[0], v[n + 2] - v[2])
          const dur = root.times[root.times.length - 1] - root.times[0]
          if (dist > 0.1 && dur > 0) this.strideSpeed = dist / dur
        }
        const limbs = new THREE.AnimationClip(
          clip.name,
          -1,
          clip.tracks.filter((t) => !t.name.startsWith(`${ROOT}.`)).map((t) => shiftToZero(t)),
        )
        limbs.resetDuration()
        this.walk = this.mixer.clipAction(limbs)
      }
      this.loaded = true
      return true
    } catch {
      return false
    }
  }

  /**
   * Feet at (x, groundY, z). Model faces +Z, so heading toward (dx, dz) is atan2(dx, dz).
   * speedMs is real ground speed (time scale included), dt is real seconds.
   */
  update(x: number, groundY: number, z: number, dx: number, dz: number, speedMs: number, dt: number): void {
    if (Number.isFinite(groundY)) this.group.position.set(x, groundY, z)
    if (Math.hypot(dx, dz) > 1e-4) {
      const target = Math.atan2(dx, dz)
      let d = target - this.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.yaw += d * Math.min(1, dt * 10)
    }
    this.group.rotation.set(0, this.yaw, 0)
    if (!this.walk || !this.mixer) return
    const moving = speedMs > 0.02
    if (moving !== this.moving) {
      this.moving = moving
      if (moving) {
        this.walk.reset()
        this.walk.play()
      } else {
        this.walk.stop()
      }
    }
    if (moving) {
      // Faster than ×3 the legs become a blur; past that the cycle just stays at ×3.
      this.walk.timeScale = Math.min(3, speedMs / this.strideSpeed)
      this.mixer.update(dt)
    } else {
      const k = Math.min(1, dt * 8)
      for (const r of this.rest) r.obj.quaternion.slerp(r.q, k)
    }
  }

  setVisible(on: boolean): void {
    this.group.visible = on
  }
}

/** Blender exports each NLA clip at its timeline offset; shift to start at 0. */
function shiftToZero(track: THREE.KeyframeTrack): THREE.KeyframeTrack {
  const t = track.clone()
  const t0 = t.times[0] ?? 0
  if (t0 !== 0) for (let i = 0; i < t.times.length; i++) t.times[i] -= t0
  return t
}
