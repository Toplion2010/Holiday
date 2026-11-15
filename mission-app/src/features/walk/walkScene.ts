// Сцена прогулки от первого лица: свой renderer, рельеф HiRISE, трек ровера, метки, мини-карта.
// Всё императивно, React получает только состояние для HUD ~5 раз в секунду.

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { WalkState } from '@/app/modeContract';
import { icrfToLocalEnu } from '@/features/sky/marsSky';
import { daysSinceJ2000, solarGeometry, type SolarGeometry } from '@/features/sky/marsTime';
import { SkyDome, DEFAULT_TAU } from '@/features/sky/skyDome';
import { dayPhase, daylightWeight, smoothstep, unixMsForLtst, unixMsForSunCrossing, enuToScene, type DayPhase } from '@/features/sky/skyMath';
import { bearingDeg, gridToLocal, localToLonLat, lonLatToLocal } from './geo';
import { DEFAULT_MAX_SLOPE, stepBlocked, TerrainSampler, walkSpeed, type BlockReason } from './motion';
import { BackdropPass } from './backdrop';
import { dataLevelLabel, siteBaseUrl, type SitePackage } from './sitePackage';
import { MAST_HEIGHT_M, RoverRig } from './roverRig';
import { TerrainChunks } from './terrainMesh';
import { createTerrainMaterial, orthoHiPlacement } from './terrainMaterial';

export const EYE_HEIGHT_M = 1.7;
/** Высота, на которую камера поднимается перед переходом на шар. */
export const ASCENT_M = 2500;
/**
 * Скорость ровера в сцене. Реальный Perseverance ходит ~4,2 см/с (максимум ~12 см/с):
 * здесь ускорено, чтобы по участку можно было проехать; подпись в настройках.
 */
export const ROVER_SPEED_MS = 1.0;
export const ROVER_REAL_SPEED_MS = 0.042;
const ROVER_TURN_RAD_S = 0.6;

export type Vehicle = 'rover' | 'walk';

interface LiftPose {
  h: number;
  pitch: number;
  yaw: number;
}

/** Спуск с шара к старту. */
const ARRIVE_MS = 2600;

const TOP_VIEW: LiftPose = { h: ASCENT_M, pitch: -Math.PI / 2 + 0.001, yaw: 0 };
export const TIME_SCALES = [1, 10, 60] as const;
const TRACK_LABEL_RADIUS_M = 50;
const FOG_DAY = new THREE.Color('#cfa47e');
const FOG_NIGHT = new THREE.Color('#0b0908');
const SUN_NOON = new THREE.Color('#fff0d8');
const SUN_LOW = new THREE.Color('#ff7a4a');
const HEMI_SKY_DAY = new THREE.Color('#f6d6b4');
const HEMI_SKY_NIGHT = new THREE.Color('#2a3350');
// Пыльная дымка только на дальнем плане: с 300 м она съедала контраст всего участка.
const FOG_FAR_DAY_M = 6000;
const FOG_NEAR_FRACTION = 0.3;
const SUN_LIGHT_DAY = 2.4;
const SKY_LIGHT_DAY = 1.2;
const SKY_LIGHT_NIGHT = 0.3;
const WALK_EXPOSURE = 1.5;

export interface SolarState {
  ltstHours: number;
  msd: number;
  ls: number;
  elevationDeg: number;
  azimuthDeg: number;
  irradianceWm2: number;
  phase: DayPhase;
  tau: number;
}

export interface WalkExtra {
  fps: number;
  blocked: BlockReason;
  blockedSlopeDeg: number;
  speedMs: number;
  locked: boolean;
  /** Камера в подъёме/спуске между шаром и сценой. */
  lifting: boolean;
  solar: SolarState;
}

export interface TeleportTarget {
  id: string;
  label: string;
  x: number;
  z: number;
}

export interface WalkSceneOptions {
  container: HTMLElement;
  labels: HTMLElement;
  minimap: HTMLCanvasElement | null;
  pkg: SitePackage;
  touch: boolean;
  /** Прибытие с шара: камера начинает сверху (ASCENT_M) и опускается к старту. */
  arrive?: boolean;
  onState(state: WalkState, extra: WalkExtra): void;
  onExit(): void;
  /** Hooks for the ARES game layer (astronaut, third-person camera). Optional. */
  hooks?: WalkSceneHooks;
}

/** What the game layer sees each frame, just before the scene is rendered. */
export interface WalkFrameInfo {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Real seconds since the last frame and simulated seconds (× time scale). */
  dt: number;
  simDt: number;
  x: number;
  z: number;
  /** Ground height in scene units at local (x, z). */
  ground(x: number, z: number): number;
  vehicle: Vehicle;
  speedMs: number;
  locked: boolean;
}

export interface WalkSceneHooks {
  /** May move the camera (third-person view); afterRender is called after labels are drawn. */
  beforeRender?(info: WalkFrameInfo): void;
  afterRender?(info: WalkFrameInfo): void;
}

interface Label {
  el: HTMLDivElement;
  pos: THREE.Vector3;
}

interface LocalPoi {
  id: string;
  title: string;
  x: number;
  z: number;
  y: number;
  label: Label;
}

interface LocalTrackPoint {
  sol: number;
  x: number;
  z: number;
  y: number;
}

export class WalkScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls | null = null;
  private sampler: TerrainSampler;
  private terrain: TerrainChunks;
  private sun: THREE.DirectionalLight;
  private sky: SkyDome;
  /** Дальний план (стены кратера и т.п.), если он есть в пакете участка. */
  private backdrop: BackdropPass | null = null;
  private lift: { from: LiftPose; to: LiftPose; start: number; duration: number; resolve: () => void } | null = null;
  /** Поза камеры, пока она в воздухе (над грунтом на h, взгляд pitch/yaw). null — обычное управление. */
  private liftHold: LiftPose | null = null;
  private startYaw = 0;
  private vehicle: Vehicle = 'rover';
  private rover = new RoverRig();
  private roverYaw = 0;
  private hemi: THREE.HemisphereLight;
  private fog: THREE.Fog;
  private geo: SolarGeometry;
  private tau = DEFAULT_TAU;
  private clockRunning = true;
  private evaMs = 0;
  private orthoTexture: THREE.Texture;
  private orthoHiTexture: THREE.Texture | null = null;
  private refY: number;
  private raf = 0;
  private lastFrame = performance.now();
  private resizeObserver: ResizeObserver;
  private disposers: (() => void)[] = [];

  // Игрок
  private px = 0;
  private pz = 0;
  private walkedM = 0;
  private baseX = 0;
  private baseZ = 0;
  private keys = new Set<string>();
  private joyX = 0;
  private joyY = 0;
  private speedMs = 0;
  private blocked: BlockReason = null;
  private blockedSlopeDeg = NaN;
  private blockedAt = 0;
  private lastUnlockAt = 0;
  private inputEnabled = true;

  // Настройки
  timeScale = 1;
  maxSlopeDeg = DEFAULT_MAX_SLOPE;
  private simTimeMs = Date.now();

  // Наложения
  private pois: LocalPoi[] = [];
  private trackPoints: LocalTrackPoint[] = [];
  private trackLabels: Label[] = [];
  private minimapBase: HTMLCanvasElement | null = null;
  private minimapScale = 1;
  readonly teleports: TeleportTarget[] = [];

  // Таймеры
  private lodTimer = 0;
  private stateTimer = 0;
  private minimapTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  private tmp = new THREE.Vector3();
  private sunDir = new THREE.Vector3(0, 1, 0);

  private get latDeg(): number {
    return this.opts.pkg.manifest.center.lat;
  }

  private get lonEastDeg(): number {
    return this.opts.pkg.manifest.center.lon_east;
  }

  constructor(private opts: WalkSceneOptions) {
    const { pkg, container } = opts;
    this.sampler = new TerrainSampler(pkg.grid, pkg.frame);
    this.refY = pkg.manifest.height.base_m;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.touch ? 1.25 : 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = !opts.touch;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Без тонмаппинга солнце + небо выбивали снимок в ровный оранжевый: детали HiRISE пропадали.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = WALK_EXPOSURE;
    this.renderer.domElement.className = 'walk-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 6000);
    this.camera.rotation.order = 'YXZ';

    this.geo = solarGeometry(this.simTimeMs, this.latDeg, this.lonEastDeg);
    this.fog = new THREE.Fog(FOG_DAY, FOG_FAR_DAY_M * FOG_NEAR_FRACTION, FOG_FAR_DAY_M);
    this.scene.fog = this.fog;
    this.scene.background = FOG_DAY.clone();
    this.sky = new SkyDome(import.meta.env.BASE_URL);
    this.scene.add(this.sky.mesh);
    if (pkg.manifest.backdrop) {
      this.backdrop = new BackdropPass();
      this.backdrop.adoptSky(this.sky.mesh);
      void this.backdrop.load(siteBaseUrl(pkg.manifest.id) + pkg.manifest.backdrop.file);
    }

    this.hemi = new THREE.HemisphereLight('#f6d6b4', '#7a4a30', SKY_LIGHT_DAY);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d8', SUN_LIGHT_DAY);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -220;
    sc.right = 220;
    sc.top = 220;
    sc.bottom = -220;
    sc.near = 10;
    sc.far = 4000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.orthoTexture = this.makeOrthoTexture(pkg.ortho);
    this.renderer.toneMappingExposure = WALK_EXPOSURE * orthoExposureGain(pkg.ortho);
    const hiMeta = pkg.manifest.ortho_hi;
    if (pkg.orthoHi && hiMeta) this.orthoHiTexture = this.makeOrthoTexture(pkg.orthoHi);
    const material = createTerrainMaterial(
      this.orthoTexture,
      this.orthoHiTexture && hiMeta
        ? { texture: this.orthoHiTexture, placement: orthoHiPlacement(pkg.manifest.bounds_eqc_m, hiMeta.bounds_eqc_m, hiMeta.blend_m) }
        : null,
    );
    this.terrain = new TerrainChunks(pkg.grid, pkg.frame, this.refY, material);
    this.terrain.buildAll();
    this.scene.add(this.terrain.group);

    this.applyLighting();
    this.buildTrack();
    this.buildPois();
    this.buildTeleports();
    this.placeAtStart();
    this.scene.add(this.rover.group);
    void this.rover.load(`${import.meta.env.BASE_URL}models/perseverance.glb`).then((ok) => {
      if (ok) this.rover.setVisible(true);
    });
    this.terrain.update(this.px, this.pz, Infinity);
    this.buildMinimap();
    this.setupInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.raf = requestAnimationFrame(this.frame);
    if (opts.arrive) void this.arrive(ARRIVE_MS);
  }

  // ---------- построение сцены ----------

  private makeOrthoTexture(bitmap: ImageBitmap): THREE.Texture {
    const max = this.renderer.capabilities.maxTextureSize;
    let image: ImageBitmap | HTMLCanvasElement = bitmap;
    if (bitmap.width > max || bitmap.height > max) {
      const k = max / Math.max(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(bitmap.width * k);
      canvas.height = Math.floor(bitmap.height * k);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      image = canvas;
    }
    const tex = new THREE.Texture(image);
    // Первая строка снимка — северный край, как и у сетки высот; v = row / rows.
    tex.flipY = false;
    // 8-битный снимок после растяжки рассчитан на экран (как в мини-карте), поэтому sRGB:
    // в линейном виде средние тона поднимались и рельеф выглядел мутным.
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private groundY(x: number, z: number): number {
    return this.sampler.heightAt(x, z) - this.refY;
  }

  private buildTrack(): void {
    const track = this.opts.pkg.track;
    if (!track) return;
    const frame = this.opts.pkg.frame;
    // Линия кладётся на DTM (высоты ровера смещены по датуму, см. паспорт).
    const pts = track.line.map((p) => lonLatToLocal(frame, p.lonEast, p.lat));
    const samples: { x: number; z: number; dx: number; dz: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-3) continue;
      const n = Math.max(1, Math.ceil(len / 1.0));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len });
      }
    }
    const last = pts[pts.length - 1];
    if (samples.length) samples.push({ ...last, dx: samples[samples.length - 1].dx, dz: samples[samples.length - 1].dz });

    const half = 0.3;
    const pos = new Float32Array(samples.length * 6);
    const ok = new Uint8Array(samples.length);
    samples.forEach((s, i) => {
      const lx = s.x - s.dz * half;
      const lz = s.z + s.dx * half;
      const rx = s.x + s.dz * half;
      const rz = s.z - s.dx * half;
      const ly = this.groundY(lx, lz);
      const ry = this.groundY(rx, rz);
      ok[i] = Number.isFinite(ly) && Number.isFinite(ry) ? 1 : 0;
      pos.set([lx, (ly || 0) + 0.12, lz, rx, (ry || 0) + 0.12, rz], i * 6);
    });
    const index: number[] = [];
    for (let i = 0; i < samples.length - 1; i++) {
      if (!ok[i] || !ok[i + 1]) continue;
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(index);
    const ribbon = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: '#ff6a2b', transparent: true, opacity: 0.85, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8, depthWrite: false,
      }),
    );
    ribbon.renderOrder = 2;
    this.scene.add(ribbon);

    // Столбики в точках остановок ровера.
    for (const p of track.points) {
      const l = lonLatToLocal(frame, p.lonEast, p.lat);
      const y = this.groundY(l.x, l.z);
      if (Number.isFinite(y)) this.trackPoints.push({ sol: p.sol, x: l.x, z: l.z, y });
    }
    const post = new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6);
    post.translate(0, 0.6, 0);
    const posts = new THREE.InstancedMesh(post, new THREE.MeshLambertMaterial({ color: '#ffd2a8', emissive: '#7a2c0c' }), this.trackPoints.length);
    const m = new THREE.Matrix4();
    this.trackPoints.forEach((p, i) => posts.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    posts.castShadow = true;
    this.scene.add(posts);

    for (let i = 0; i < 8; i++) this.trackLabels.push(this.makeLabel('walk-label walk-label-track'));
  }

  private makeLabel(className: string): Label {
    const el = document.createElement('div');
    el.className = className;
    el.style.display = 'none';
    this.opts.labels.appendChild(el);
    return { el, pos: new THREE.Vector3() };
  }

  private buildPois(): void {
    const { pkg } = this.opts;
    const beaconGeo = new THREE.CylinderGeometry(0.6, 0.6, 140, 12, 1, true);
    beaconGeo.translate(0, 70, 0);
    const ringGeo = new THREE.RingGeometry(2.2, 3, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const colors = ['#5fe3ff', '#ffe066', '#9dff8a', '#ff9de2'];
    (pkg.manifest.pois ?? []).forEach((p, i) => {
      const l = lonLatToLocal(pkg.frame, p.lon_east, p.lat);
      const y = this.groundY(l.x, l.z);
      if (!Number.isFinite(y)) return;
      const color = colors[i % colors.length];
      const beacon = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, fog: false, depthWrite: false }));
      beacon.position.set(l.x, y, l.z);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
      ring.position.set(l.x, y + 0.1, l.z);
      this.scene.add(beacon, ring);
      const label = this.makeLabel('walk-label walk-label-poi');
      label.el.style.setProperty('--poi', color);
      label.pos.set(l.x, y + 6, l.z);
      this.pois.push({ id: p.id, title: p.title, x: l.x, z: l.z, y, label });
    });
  }

  private buildTeleports(): void {
    for (const p of this.pois) this.teleports.push({ id: `poi-${p.id}`, label: p.title, x: p.x, z: p.z });
    const rover = this.opts.pkg.track?.rover ?? '';
    this.trackPoints.forEach((p, i) => {
      if (i % 20 === 0 || i === this.trackPoints.length - 1) {
        this.teleports.push({ id: `track-${i}`, label: `${rover}, sol ${p.sol}`, x: p.x, z: p.z });
      }
    });
  }

  private placeAtStart(): void {
    const [first, second] = this.pois;
    let x = first?.x ?? 0;
    let z = first?.z ?? 0;
    const start = this.nearestValid(x, z);
    x = start.x;
    z = start.z;
    let target = second;
    // Если первая метка лежит в заполнении (CTX 20 м), стартуем на ближайшем подробном
    // рельефе HiRISE и смотрим на метку: у ног тогда реальные детали, а не размытое заполнение.
    if (first && this.sampler.sourceAt(x, z) !== 0) {
      const hi = this.nearestHirise(x, z);
      if (hi) {
        this.teleports.unshift({ id: 'hirise-start', label: 'Начало подробного рельефа HiRISE', x: hi.x, z: hi.z });
        x = hi.x;
        z = hi.z;
        target = first;
      }
    }
    this.px = x;
    this.pz = z;
    this.baseX = x;
    this.baseZ = z;
    const look = target ? { dx: target.x - x, dz: target.z - z } : { dx: 0, dz: -1 };
    this.startYaw = Math.atan2(-look.dx, -look.dz);
    this.roverYaw = this.startYaw;
    this.camera.rotation.set(0, this.startYaw, 0);
    this.updateCameraHeight();
  }

  /**
   * Ближайшая точка с рельефом HiRISE (код источника 0), отступив от границы на 40 м внутрь,
   * чтобы у ног не было переходной полосы. null — подробного рельефа на участке нет.
   */
  private nearestHirise(x: number, z: number): { x: number; z: number } | null {
    const isHi = (qx: number, qz: number) => this.sampler.sourceAt(qx, qz) === 0 && Number.isFinite(this.sampler.heightAt(qx, qz));
    const step = 10;
    for (let r = step; r < 4000; r += step) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        if (!isHi(x + Math.cos(a) * r, z + Math.sin(a) * r)) continue;
        for (const extra of [40, 20, 0]) {
          const qx = x + Math.cos(a) * (r + extra);
          const qz = z + Math.sin(a) * (r + extra);
          if (isHi(qx, qz)) return { x: qx, z: qz };
        }
      }
    }
    return null;
  }

  /** Ближайшая точка с данными рельефа (поиск по спирали с шагом сетки). */
  private nearestValid(x: number, z: number): { x: number; z: number } {
    if (Number.isFinite(this.sampler.heightAt(x, z))) return { x, z };
    const step = this.opts.pkg.frame.pixelM;
    for (let r = step; r < 3000; r += step) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const qx = x + Math.cos(a) * r;
        const qz = z + Math.sin(a) * r;
        if (Number.isFinite(this.sampler.heightAt(qx, qz))) return { x: qx, z: qz };
      }
    }
    const c = gridToLocal(this.opts.pkg.frame, this.opts.pkg.grid.width / 2, this.opts.pkg.grid.height / 2);
    return c;
  }

  private buildMinimap(): void {
    const canvas = this.opts.minimap;
    if (!canvas) return;
    const { frame, grid, ortho } = this.opts.pkg;
    const a = gridToLocal(frame, -0.5, -0.5);
    const b = gridToLocal(frame, grid.width - 0.5, grid.height - 0.5);
    const wM = b.x - a.x;
    const hM = b.z - a.z;
    const size = 200;
    this.minimapScale = size / Math.max(wM, hM);
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.round(wM * this.minimapScale * dpr);
    canvas.height = Math.round(hM * this.minimapScale * dpr);
    canvas.style.width = `${Math.round(wM * this.minimapScale)}px`;
    canvas.style.height = `${Math.round(hM * this.minimapScale)}px`;
    const base = document.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    const ctx = base.getContext('2d')!;
    ctx.drawImage(ortho, 0, 0, base.width, base.height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#e0a070';
    ctx.fillRect(0, 0, base.width, base.height);
    ctx.globalCompositeOperation = 'source-over';
    const k = this.minimapScale * dpr;
    const toMap = (x: number, z: number) => [(x - a.x) * k, (z - a.z) * k] as const;
    const track = this.opts.pkg.track;
    if (track) {
      ctx.strokeStyle = '#ff6a2b';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      track.line.forEach((p, i) => {
        const l = lonLatToLocal(frame, p.lonEast, p.lat);
        const [mx, my] = toMap(l.x, l.z);
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.lineTo(mx, my);
      });
      ctx.stroke();
    }
    for (const p of this.pois) {
      const [mx, my] = toMap(p.x, p.z);
      ctx.fillStyle = p.label.el.style.getPropertyValue('--poi') || '#5fe3ff';
      ctx.beginPath();
      ctx.arc(mx, my, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(p.id, mx + 6 * dpr, my + 4 * dpr);
    }
    this.minimapBase = base;
    const onDown = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = a.x + (e.clientX - r.left) / this.minimapScale;
      const z = a.z + (e.clientY - r.top) / this.minimapScale;
      this.teleport(x, z);
      e.stopPropagation();
    };
    canvas.addEventListener('pointerdown', onDown);
    this.disposers.push(() => canvas.removeEventListener('pointerdown', onDown));
    this.minimapOrigin = a;
  }
  private minimapOrigin = { x: 0, z: 0 };

  private drawMinimap(): void {
    const canvas = this.opts.minimap;
    if (!canvas || !this.minimapBase) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = canvas.width / parseFloat(canvas.style.width || '1');
    ctx.drawImage(this.minimapBase, 0, 0);
    const k = this.minimapScale * dpr;
    const mx = (this.px - this.minimapOrigin.x) * k;
    const my = (this.pz - this.minimapOrigin.z) * k;
    this.headingDirection(this.tmp);
    const ang = Math.atan2(this.tmp.z, this.tmp.x);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(9 * dpr, 0);
    ctx.lineTo(-6 * dpr, 5.5 * dpr);
    ctx.lineTo(-3 * dpr, 0);
    ctx.lineTo(-6 * dpr, -5.5 * dpr);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  // ---------- ввод ----------

  private setupInput(): void {
    const canvas = this.renderer.domElement;
    if (!this.opts.touch) {
      const controls = new PointerLockControls(this.camera, canvas);
      controls.addEventListener('lock', () => this.emitState(true));
      controls.addEventListener('unlock', () => {
        this.lastUnlockAt = performance.now();
        this.keys.clear();
        this.emitState(true);
      });
      this.controls = controls;
      const onClick = () => this.lock();
      canvas.addEventListener('click', onClick);
      this.disposers.push(() => canvas.removeEventListener('click', onClick));
    }
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Escape') {
        if (!this.controls?.isLocked && performance.now() - this.lastUnlockAt > 400) this.opts.onExit();
        return;
      }
      if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
        this.setTimeScale(TIME_SCALES[Number(e.code.slice(5)) - 1]);
        return;
      }
      if (MOVE_KEYS.has(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => this.keys.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.disposers.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  lock(): void {
    try {
      this.controls?.lock();
    } catch {
      // Браузер может отказать в захвате указателя — тогда просто остаёмся без него.
    }
  }

  /** Джойстик: x вправо, y вперёд, длина до 1. */
  setJoystick(x: number, y: number): void {
    this.joyX = x;
    this.joyY = y;
  }

  /** Поворот взгляда пальцем (пиксели экрана). */
  lookBy(dxPx: number, dyPx: number): void {
    const e = this.camera.rotation;
    e.y -= dxPx * 0.005;
    e.x = THREE.MathUtils.clamp(e.x - dyPx * 0.005, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  setTimeScale(scale: number): void {
    this.timeScale = scale;
    this.emitState(true);
  }

  setSimTime(unixMs: number): void {
    this.simTimeMs = unixMs;
    this.applyLighting();
    this.emitState(true);
  }

  getSimTime(): number {
    return this.simTimeMs;
  }

  setLtst(hours: number): void {
    this.setSimTime(unixMsForLtst(this.simTimeMs, this.latDeg, this.lonEastDeg, hours));
  }

  setSunCrossing(rising: boolean): void {
    this.setSimTime(unixMsForSunCrossing(this.simTimeMs, this.latDeg, this.lonEastDeg, rising));
  }

  setClockRunning(running: boolean): void {
    this.clockRunning = running;
  }

  setTau(tau: number): void {
    this.tau = tau;
    this.applyLighting();
    this.emitState(true);
  }

  solarState(): SolarState {
    const g = this.geo;
    return {
      ltstHours: g.ltst,
      msd: g.msd,
      ls: g.ls,
      elevationDeg: g.elevationDeg,
      azimuthDeg: g.azimuthDeg,
      irradianceWm2: g.irradianceWm2,
      phase: dayPhase(g.elevationDeg),
      tau: this.tau,
    };
  }

  /** Свет, туман и купол неба по положению Солнца в текущий модельный момент. */
  private applyLighting(): void {
    const g = (this.geo = solarGeometry(this.simTimeMs, this.latDeg, this.lonEastDeg));
    const el = g.elevationDeg;
    const day = daylightWeight(el);
    const [sx, sy, sz] = enuToScene(g.enu);
    this.sunDir.set(sx, sy, sz);
    this.sun.color.copy(SUN_LOW).lerp(SUN_NOON, smoothstep(0, 25, el));
    this.sun.intensity = SUN_LIGHT_DAY * smoothstep(-1, 10, el);
    this.sun.castShadow = el > 0.5;
    this.hemi.intensity = THREE.MathUtils.lerp(SKY_LIGHT_NIGHT, SKY_LIGHT_DAY, day);
    this.hemi.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_DAY, day);
    this.fog.color.copy(FOG_NIGHT).lerp(FOG_DAY, day);
    this.fog.far = THREE.MathUtils.clamp((FOG_FAR_DAY_M * DEFAULT_TAU) / this.tau, 1500, 8000);
    this.fog.near = this.fog.far * FOG_NEAR_FRACTION;
    (this.scene.background as THREE.Color).copy(this.fog.color);
    this.sky.update({
      sunEnu: g.enu,
      sunElevationDeg: el,
      angularDiameterDeg: g.angularDiameterDeg,
      icrfToEnuMatrix: icrfToLocalEnu(daysSinceJ2000(this.simTimeMs), this.latDeg, this.lonEastDeg),
      tau: this.tau,
    });
  }

  setMaxSlope(deg: number): void {
    this.maxSlopeDeg = deg;
    this.emitState(true);
  }

  setShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.terrain.material.needsUpdate = true;
  }

  get shadows(): boolean {
    return this.renderer.shadowMap.enabled;
  }

  /**
   * Подъём перед выходом на шар: камера уходит вверх на ASCENT_M и разворачивается взглядом
   * вниз и на север. Шар потом появляется над той же точкой на той же высоте (см. exitOrigin).
   */
  ascend(durationMs: number): Promise<void> {
    if (this.controls?.isLocked) this.controls.unlock();
    this.keys.clear();
    this.joyX = 0;
    this.joyY = 0;
    const yaw = this.camera.rotation.y;
    const fromYaw = yaw - Math.round(yaw / (2 * Math.PI)) * 2 * Math.PI;
    return this.startLift({ h: 0, pitch: this.camera.rotation.x, yaw: fromYaw }, TOP_VIEW, durationMs);
  }

  /** Обратный ход: с высоты ASCENT_M, взгляд вниз — к земле, к курсу старта. Для прибытия с шара. */
  arrive(durationMs: number): Promise<void> {
    return this.startLift(TOP_VIEW, { h: 0, pitch: 0, yaw: this.startYaw }, durationMs);
  }

  private startLift(from: LiftPose, to: LiftPose, durationMs: number): Promise<void> {
    this.lift?.resolve();
    return new Promise((resolve) => {
      this.lift = { from, to, start: performance.now(), duration: Math.max(1, durationMs), resolve };
      this.liftHold = from;
      if (durationMs <= 0) this.stepLift(performance.now() + 1);
    });
  }

  /** Точка игрока и высота камеры над рельефом — для перехода на шар. */
  exitOrigin(): { lon: number; lat: number; altitudeKm: number } {
    const ll = localToLonLat(this.opts.pkg.frame, this.px, this.pz);
    const eye = this.vehicle === 'rover' ? MAST_HEIGHT_M : EYE_HEIGHT_M;
    return { lon: ll.lonEast, lat: ll.lat, altitudeKm: (eye + (this.liftHold?.h ?? 0)) / 1000 };
  }

  /** Камера «в полёте» (подъём/спуск или зависла сверху): ходить нельзя. */
  get lifting(): boolean {
    return this.liftHold !== null;
  }

  private stepLift(now: number): void {
    const a = this.lift;
    const hold = this.liftHold;
    if (!a && !hold) return;
    let pose: LiftPose;
    if (a) {
      const t = Math.min(1, (now - a.start) / a.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      pose = {
        h: THREE.MathUtils.lerp(a.from.h, a.to.h, e),
        pitch: THREE.MathUtils.lerp(a.from.pitch, a.to.pitch, e),
        yaw: THREE.MathUtils.lerp(a.from.yaw, a.to.yaw, e),
      };
      if (t >= 1) {
        this.lift = null;
        this.liftHold = a.to.h > 0 ? a.to : null;
        a.resolve();
      }
    } else {
      pose = hold!;
    }
    this.camera.position.y += pose.h;
    this.camera.rotation.set(pose.pitch, pose.yaw, 0);
    if (this.vehicle === 'rover' && !this.liftHold) this.roverYaw = pose.yaw;
  }

  /** Ровер или пешком. Ровер ставится туда, где стоит игрок, курсом по взгляду. */
  setVehicle(vehicle: Vehicle): void {
    if (vehicle === this.vehicle || this.liftHold) return;
    this.vehicle = vehicle;
    if (vehicle === 'rover') {
      // Ровер подъезжает туда, где стоит человек, курсом по взгляду.
      this.roverYaw = this.camera.rotation.y;
    } else {
      // Выходим из ровера вбок, чтобы не стоять внутри корпуса.
      const side = this.nearestValid(this.px + Math.cos(this.roverYaw) * 2.5, this.pz - Math.sin(this.roverYaw) * 2.5);
      this.px = side.x;
      this.pz = side.z;
    }
    this.updateCameraHeight();
    this.emitState(true);
  }

  get currentVehicle(): Vehicle {
    return this.vehicle;
  }

  teleport(x: number, z: number): void {
    const p = this.nearestValid(x, z);
    this.px = p.x;
    this.pz = p.z;
    this.terrain.update(this.px, this.pz, Infinity);
    this.updateCameraHeight();
    this.emitState(true);
  }

  // ---------- кадр ----------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.evaMs += dt * 1000 * this.timeScale;
    if (this.clockRunning) this.simTimeMs += dt * 1000 * this.timeScale;
    this.applyLighting();
    this.move(dt);
    this.updateCameraHeight();
    this.stepLift(now);

    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.2;
      this.terrain.update(this.px, this.pz);
    }
    this.sun.target.position.set(this.px, this.camera.position.y, this.pz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 1500);
    this.sky.mesh.position.copy(this.camera.position);

    const hookInfo: WalkFrameInfo | null = this.opts.hooks
      ? {
          scene: this.scene, camera: this.camera, dt, simDt: dt * this.timeScale, x: this.px, z: this.pz,
          ground: this.groundAt, vehicle: this.vehicle, speedMs: this.speedMs, locked: !!this.controls?.isLocked,
        }
      : null;
    if (hookInfo) this.opts.hooks?.beforeRender?.(hookInfo);

    if (this.backdrop) {
      this.backdrop.sync(this.camera, {
        hemi: this.hemi, sun: this.sun, sunDir: this.sunDir, fogColor: this.fog.color, tau: this.tau,
      });
      this.backdrop.render(this.renderer, this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.updateLabels();
    if (hookInfo) this.opts.hooks?.afterRender?.(hookInfo);

    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1;
      this.drawMinimap();
    }
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (this.blocked && now - this.blockedAt > 1200) this.blocked = null;
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) this.emitState(true);
  };

  /** The game layer pauses player movement (science activity, mission end). */
  setInputEnabled(on: boolean): void {
    this.inputEnabled = on;
    if (!on) this.keys.clear();
  }

  private move(dt: number): void {
    if (this.liftHold) return;
    if (!this.inputEnabled) {
      this.speedMs = 0;
      return;
    }
    if (this.vehicle === 'rover') return this.drive(dt);
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.joyY;
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.joyX;
    const mag = Math.min(1, Math.hypot(f, s));
    if (mag < 0.05) {
      this.speedMs = 0;
      return;
    }
    this.camera.getWorldDirection(this.tmp);
    let fx = this.tmp.x;
    let fz = this.tmp.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    let mx = fx * f - fz * s;
    let mz = fz * f + fx * s;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;

    // Скорость — параметр симуляции по модели Apollo, от уклона вдоль шага.
    const theta = this.sampler.slopeAlongDeg(this.px, this.pz, mx, mz, 1);
    const v = walkSpeed(theta) * mag;
    this.speedMs = v;
    let remaining = v * dt * this.timeScale;
    while (remaining > 1e-4) {
      const d = Math.min(remaining, 0.5);
      remaining -= d;
      if (!this.tryStep(mx * d, mz * d) && !this.tryStep(mx * d, 0) && !this.tryStep(0, mz * d)) {
        this.speedMs = 0;
        break;
      }
    }
  }

  private tryStep(dx: number, dz: number): boolean {
    if (Math.abs(dx) + Math.abs(dz) < 1e-6) return false;
    const qx = this.px + dx;
    const qz = this.pz + dz;
    const hq = this.sampler.heightAt(qx, qz);
    const sq = this.sampler.slopeDeg(qx, qz);
    const sp = this.sampler.slopeDeg(this.px, this.pz);
    const reason = stepBlocked(hq, sq, sp, this.maxSlopeDeg);
    if (reason) {
      this.blocked = reason;
      this.blockedSlopeDeg = sq;
      this.blockedAt = performance.now();
      return false;
    }
    const hp = this.sampler.heightAt(this.px, this.pz);
    this.walkedM += Math.hypot(dx, dz, Number.isFinite(hp) ? hq - hp : 0);
    this.px = qx;
    this.pz = qz;
    return true;
  }

  /** Ровер: W/S — вперёд/назад по курсу, A/D — поворот на месте; взгляд мышью свободный. */
  private drive(dt: number): void {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.joyY;
    const turn = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.joyX;
    if (Math.abs(turn) > 0.05) {
      const dyaw = -turn * ROVER_TURN_RAD_S * dt * Math.min(this.timeScale, 10);
      this.roverYaw += dyaw;
      this.camera.rotation.y += dyaw;
    }
    if (Math.abs(f) < 0.05) {
      this.speedMs = 0;
      return;
    }
    const dir = Math.sign(f);
    const mx = -Math.sin(this.roverYaw) * dir;
    const mz = -Math.cos(this.roverYaw) * dir;
    const v = ROVER_SPEED_MS * Math.min(1, Math.abs(f));
    this.speedMs = v;
    let remaining = v * dt * this.timeScale;
    while (remaining > 1e-4) {
      const d = Math.min(remaining, 0.5);
      remaining -= d;
      if (!this.tryStep(mx * d, mz * d)) {
        this.speedMs = 0;
        break;
      }
    }
  }

  /** Vehicle heading is independent of mouse look. Walking still follows the camera. */
  get vehicleYaw(): number { return this.roverYaw; }

  private headingDirection(target: THREE.Vector3): THREE.Vector3 {
    if (this.vehicle === 'rover') return target.set(-Math.sin(this.roverYaw), 0, -Math.cos(this.roverYaw));
    return this.camera.getWorldDirection(target);
  }

  private groundAt = (x: number, z: number): number => this.sampler.heightAt(x, z) - this.refY;

  private updateCameraHeight(): void {
    if (this.vehicle === 'rover') {
      this.rover.place(this.px, this.pz, this.roverYaw, this.groundAt);
      if (this.rover.loaded) {
        this.rover.mastPosition(this.camera.position);
        return;
      }
      const g = this.groundAt(this.px, this.pz);
      if (Number.isFinite(g)) this.camera.position.set(this.px, g + MAST_HEIGHT_M, this.pz);
      return;
    }
    const h = this.sampler.heightAt(this.px, this.pz);
    // Стоим только на данных; если вдруг NaN — оставляем прежнюю высоту.
    const y = Number.isFinite(h) ? h - this.refY + EYE_HEIGHT_M : this.camera.position.y;
    this.camera.position.set(this.px, y, this.pz);
  }

  private project(label: Label, text: string, visible: boolean): void {
    if (!visible) {
      label.el.style.display = 'none';
      return;
    }
    const v = this.tmp.copy(label.pos).project(this.camera);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
      label.el.style.display = 'none';
      return;
    }
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    label.el.style.display = '';
    if (label.el.textContent !== text) label.el.textContent = text;
    label.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
  }

  private updateLabels(): void {
    for (const p of this.pois) {
      const d = Math.hypot(p.x - this.px, p.z - this.pz);
      p.label.pos.y = p.y + Math.min(60, 4 + d * 0.05);
      this.project(p.label, `${p.title} · ${formatDistance(d)}`, true);
    }
    const near = this.trackPoints
      .map((p) => ({ p, d: Math.hypot(p.x - this.px, p.z - this.pz) }))
      .filter((n) => n.d <= TRACK_LABEL_RADIUS_M)
      .sort((a, b) => a.d - b.d);
    const rover = this.opts.pkg.track?.rover ?? '';
    this.trackLabels.forEach((label, i) => {
      const n = near[i];
      if (n) label.pos.set(n.p.x, n.p.y + 1.6, n.p.z);
      this.project(label, n ? `${rover}, sol ${n.p.sol}` : '', !!n);
    });
  }

  private emitState(force = false): void {
    if (!force && this.stateTimer > 0) return;
    this.stateTimer = 0.2;
    const { pkg } = this.opts;
    const ll = localToLonLat(pkg.frame, this.px, this.pz);
    this.headingDirection(this.tmp);
    const hx = this.tmp.x;
    const hz = this.tmp.z;
    const hl = Math.hypot(hx, hz) || 1;
    let nearest: WalkState['nearestTrackPoint'];
    if (pkg.track) {
      let best = Infinity;
      let sol = 0;
      for (const p of this.trackPoints) {
        const d = Math.hypot(p.x - this.px, p.z - this.pz);
        if (d < best) {
          best = d;
          sol = p.sol;
        }
      }
      if (Number.isFinite(best)) nearest = { sol, distanceM: best, mission: pkg.track.rover };
    }
    const state: WalkState = {
      siteId: pkg.manifest.id,
      siteTitle: pkg.manifest.title,
      lat: ll.lat,
      lonEast: ll.lonEast,
      heightM: this.sampler.heightAt(this.px, this.pz),
      headingDeg: bearingDeg(hx, hz),
      slopeHereDeg: this.sampler.slopeDeg(this.px, this.pz),
      slopeAheadDeg: this.sampler.slopeAlongDeg(this.px, this.pz, hx / hl, hz / hl, 10),
      walkedM: this.walkedM,
      baseDistanceM: Math.hypot(this.baseX - this.px, this.baseZ - this.pz),
      baseBearingDeg: bearingDeg(this.baseX - this.px, this.baseZ - this.pz),
      nearestTrackPoint: nearest,
      dataLevel: dataLevelLabel(pkg.manifest, this.sampler.sourceAt(this.px, this.pz)),
      simTimeMs: this.simTimeMs,
      timeScale: this.timeScale,
      evaSeconds: this.evaMs / 1000,
      maxSlopeDeg: this.maxSlopeDeg,
      vehicle: this.vehicle,
    };
    this.opts.onState(state, {
      fps: this.fps,
      blocked: this.blocked,
      blockedSlopeDeg: this.blockedSlopeDeg,
      speedMs: this.speedMs,
      locked: !!this.controls?.isLocked,
      lifting: this.liftHold !== null,
      solar: this.solarState(),
    });
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.opts.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const d of this.disposers) d();
    if (this.controls) {
      if (this.controls.isLocked) this.controls.unlock();
      this.controls.dispose();
    }
    this.terrain.dispose();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => materials.add(x));
      else if (m) materials.add(m);
    });
    materials.forEach((m) => m.dispose());
    this.sky.dispose();
    this.rover.dispose();
    this.backdrop?.dispose();
    this.orthoTexture.dispose();
    this.orthoHiTexture?.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.opts.labels.replaceChildren();
  }
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Снимки HiRISE растянуты по-разному: медиана Ares 3 — 65 из 255, Гейла — 129.
 * Выравниваем экспозицию к средне-серому, чтобы тёмный продукт не выглядел ночью.
 * Только яркость кадра, сами данные снимка не меняются.
 */
export function orthoExposureGain(bitmap: ImageBitmap | HTMLCanvasElement): number {
  try {
    const n = 128;
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 1;
    ctx.drawImage(bitmap, 0, 0, n, n);
    const px = ctx.getImageData(0, 0, n, n).data;
    const values: number[] = [];
    for (let i = 0; i < px.length; i += 4) if (px[i] > 0) values.push(px[i]);
    if (values.length < 100) return 1;
    values.sort((x, y) => x - y);
    const median = values[values.length >> 1] / 255;
    return THREE.MathUtils.clamp(srgbToLinear(0.5) / srgbToLinear(median), 0.8, 2.2);
  } catch {
    return 1;
  }
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(2).replace('.', ',')} км`;
}
