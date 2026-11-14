// Base screen backdrop: astronaut standing by the rover at HAB-1, camera slowly orbiting.
// Small standalone renderer; the walk scene is only loaded once the EVA starts.

import * as THREE from 'three'
import { RoverRig } from '@/features/walk/roverRig'
import { Astronaut } from './astronaut'

const SKY_TOP = new THREE.Color('#c99a74')
const SKY_LOW = new THREE.Color('#e8c2a0')
const GROUND = new THREE.Color('#9a6a4a')

export class BaseScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000)
  private astronaut = new Astronaut()
  private rover = new RoverRig()
  private raf = 0
  private last = performance.now()
  private angle = -0.5
  private ro: ResizeObserver
  private disposed = false

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.domElement.className = 'base3d-canvas'
    host.appendChild(this.renderer.domElement)

    this.scene.background = SKY_LOW.clone()
    this.scene.fog = new THREE.Fog(SKY_LOW, 40, 260)
    this.scene.add(this.skyDome())

    const hemi = new THREE.HemisphereLight(SKY_TOP, '#5a3420', 1.1)
    const sun = new THREE.DirectionalLight('#fff0d8', 2.6)
    sun.position.set(-30, 40, 20)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 120 })
    sun.shadow.bias = -0.0005
    this.scene.add(hemi, sun)

    this.scene.add(this.ground(), this.habitat())

    // Astronaut a few metres in front of the airlock, rover parked to the side.
    this.astronaut.group.position.set(0.6, 0, 1.2)
    this.scene.add(this.astronaut.group)
    void this.astronaut.load(`${import.meta.env.BASE_URL}models/mars_astronaut_animated.glb`).then(() => {
      this.astronaut.update(0.6, 0, 1.2, 0.35, 1, 0, 1)
    })
    this.scene.add(this.rover.group)
    void this.rover.load(`${import.meta.env.BASE_URL}models/perseverance.glb`).then((ok) => {
      if (!ok || this.disposed) return
      this.rover.place(4.2, -0.6, -2.3, () => 0)
      this.rover.setVisible(true)
    })
    this.scatterRocks()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
    this.raf = requestAnimationFrame(this.frame)
  }

  private skyDome(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(900, 32, 16)
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: SKY_TOP }, low: { value: SKY_LOW } },
      vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 low; varying vec3 v; void main(){ float t = smoothstep(-0.05, 0.6, v.y); gl_FragColor = vec4(mix(low, top, t), 1.0); }',
    })
    return new THREE.Mesh(geo, mat)
  }

  private ground(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(600, 600, 160, 160)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const colors: number[] = []
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const r = Math.hypot(x, z)
      // Flat pad around the base, gentle rolling ground and a ridge line further out.
      const h = r < 14 ? 0 : (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.2 + Math.sin(x * 0.013 + 1) * 4) * Math.min(1, (r - 14) / 30)
      pos.setY(i, h)
      const n = 0.88 + 0.12 * Math.sin(x * 1.7 + z * 2.3) * Math.cos(x * 0.6 - z * 1.1)
      c.copy(GROUND).multiplyScalar(n)
      colors.push(c.r, c.g, c.b)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
    mesh.receiveShadow = true
    return mesh
  }

  private habitat(): THREE.Group {
    const g = new THREE.Group()
    const white = new THREE.MeshStandardMaterial({ color: '#e9e4dc', roughness: 0.6, metalness: 0.1 })
    const grey = new THREE.MeshStandardMaterial({ color: '#8a8580', roughness: 0.7, metalness: 0.3 })
    const orange = new THREE.MeshStandardMaterial({ color: '#e07b39', roughness: 0.6 })
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), white)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.35, 4.5, 0.8, 40), grey)
    ring.position.y = 0.4
    dome.position.y = 0.8
    const lock = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 24, 1, false, 0, Math.PI * 2), white)
    lock.rotation.x = Math.PI / 2
    lock.position.set(0, 1.3, 4.3)
    const hatch = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), orange)
    hatch.position.set(0, 1.3, 5.61)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 1.6), new THREE.MeshStandardMaterial({ color: '#1d2b44', roughness: 0.3, metalness: 0.6 }))
    panel.position.set(-7, 1.4, -1)
    panel.rotation.z = 0.35
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8), grey)
    mast.position.set(-7, 0.7, -1)
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 6, 8), grey)
    antenna.position.set(2.5, 6, -2.5)
    for (const m of [dome, ring, lock, hatch, panel, mast, antenna]) {
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
    }
    g.position.set(-3, 0, -6)
    return g
  }

  private scatterRocks(): void {
    const mat = new THREE.MeshStandardMaterial({ color: '#6e4a34', roughness: 1, flatShading: true })
    const geo = new THREE.DodecahedronGeometry(1, 0)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2
      const r = 9 + rnd() * 60
      const s = 0.15 + rnd() * rnd() * 0.9
      const m = new THREE.Mesh(geo, mat)
      m.scale.set(s * (0.7 + rnd()), s * 0.6, s * (0.7 + rnd()))
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      m.position.set(Math.cos(a) * r, s * 0.15, Math.sin(a) * r)
      m.castShadow = true
      m.receiveShadow = true
      this.scene.add(m)
    }
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reduce) this.angle += dt * 0.08
    const target = new THREE.Vector3(1.6, 1.1, 0)
    const r = 9.5
    this.camera.position.set(target.x + Math.sin(this.angle) * r, 2.6, target.z + Math.cos(this.angle) * r)
    this.camera.lookAt(target)
    // Idle breathing: a slight bob of the suit.
    this.astronaut.group.position.y = Math.sin(now / 900) * 0.01
    this.renderer.render(this.scene, this.camera)
  }

  private resize(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    // On wide screens the settings panel covers the right side; shift the view left.
    this.camera.setViewOffset(w, h, w > 900 ? Math.round(w * 0.16) : 0, 0, w, h)
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
    })
  }
}
