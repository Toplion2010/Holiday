// Дальний план прогулки: обзорный рельеф вокруг участка (например, стены кратера Гейла).
// Рисуется отдельным проходом со своей камерой до 300 км, затем буфер глубины очищается
// и поверх рисуется ближняя сцена. Так дальние сотни километров не отнимают точность
// глубины у рельефа под ногами (дорожка трека, кольца меток).

import * as THREE from 'three';

export const BACKDROP_NEAR_M = 300;
export const BACKDROP_FAR_M = 300_000;
/** Видимость сквозь пыль при τ = 0,5; при большей пыли — меньше. Порядок величины, не измерение. */
const HAZE_FAR_AT_TAU_HALF_M = 60_000;
const HAZE_NEAR_M = 1_000;
const ALBEDO = new THREE.Color('#8f6a52');

export interface BackdropLighting {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  fogColor: THREE.Color;
  tau: number;
}

export class BackdropPass {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, BACKDROP_NEAR_M, BACKDROP_FAR_M);
  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight();
  private fog = new THREE.Fog(0x000000, HAZE_NEAR_M, HAZE_FAR_AT_TAU_HALF_M);
  private background = new THREE.Color();
  private material = new THREE.MeshLambertMaterial({ color: ALBEDO });
  private root: THREE.Object3D | null = null;
  private disposed = false;

  constructor() {
    this.scene.fog = this.fog;
    this.scene.background = this.background;
    this.scene.add(this.hemi, this.sun, this.sun.target);
  }

  /** Загрузка GLB (Draco). Ошибка не ломает прогулку: дальнего плана просто не будет. */
  async load(url: string): Promise<boolean> {
    try {
      const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/loaders/DRACOLoader.js'),
      ]);
      const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
      const loader = new GLTFLoader();
      loader.setDRACOLoader(draco);
      const gltf = await loader.loadAsync(url);
      draco.dispose();
      if (this.disposed) return false;
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const old = mesh.material as THREE.Material | THREE.Material[];
        (Array.isArray(old) ? old : [old]).forEach((m) => m.dispose());
        mesh.material = this.material;
        mesh.frustumCulled = false;
      });
      this.root = gltf.scene;
      this.scene.add(gltf.scene);
      return true;
    } catch (e) {
      console.warn('[walk] дальний план не загрузился', e);
      return false;
    }
  }

  get loaded(): boolean {
    return this.root !== null;
  }

  /** Купол неба живёт в дальнем проходе: он должен быть позади дальнего рельефа. */
  adoptSky(sky: THREE.Object3D): void {
    this.scene.add(sky);
  }

  sync(main: THREE.PerspectiveCamera, light: BackdropLighting): void {
    this.camera.position.copy(main.position);
    this.camera.quaternion.copy(main.quaternion);
    if (this.camera.fov !== main.fov || this.camera.aspect !== main.aspect) {
      this.camera.fov = main.fov;
      this.camera.aspect = main.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.hemi.color.copy(light.hemi.color);
    this.hemi.groundColor.copy(light.hemi.groundColor);
    this.hemi.intensity = light.hemi.intensity;
    this.sun.color.copy(light.sun.color);
    this.sun.intensity = light.sun.intensity;
    this.sun.target.position.copy(main.position);
    this.sun.position.copy(main.position).addScaledVector(light.sunDir, 10_000);
    this.fog.color.copy(light.fogColor);
    this.background.copy(light.fogColor);
    this.fog.far = THREE.MathUtils.clamp((HAZE_FAR_AT_TAU_HALF_M * 0.5) / Math.max(0.05, light.tau), 15_000, 200_000);
    this.fog.near = Math.min(HAZE_NEAR_M, this.fog.far * 0.2);
  }

  /** Дальний проход, очистка глубины, ближняя сцена без фона поверх. */
  render(renderer: THREE.WebGLRenderer, mainScene: THREE.Scene, mainCamera: THREE.PerspectiveCamera): void {
    const autoClear = renderer.autoClear;
    const shadows = renderer.shadowMap.enabled;
    renderer.autoClear = false;
    renderer.clear();
    renderer.shadowMap.enabled = false; // у дальнего плана теней нет; карта теней — для ближней сцены
    renderer.render(this.scene, this.camera);
    renderer.shadowMap.enabled = shadows;
    renderer.clearDepth();
    const bg = mainScene.background;
    mainScene.background = null;
    renderer.render(mainScene, mainCamera);
    mainScene.background = bg;
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.disposed = true;
    this.root?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.material.dispose();
  }
}
