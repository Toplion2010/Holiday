// Ровер в сцене прогулки: модель Perseverance (NASA), посаженная на рельеф, и камера на мачте.
// Размеры — по описанию миссии Mars 2020: длина ~3 м, ширина ~2,7 м, мачта ~2,2 м над грунтом.

import * as THREE from 'three';

export const ROVER_LENGTH_M = 3.0;
/** Камеры Mastcam-Z над грунтом. */
export const MAST_HEIGHT_M = 2.0;
/** Мачта стоит в передней правой части корпуса. */
const MAST_FORWARD_M = 0.75;
const MAST_RIGHT_M = 0.55;
/** Полуколея и полубаза для посадки корпуса на рельеф по четырём точкам. */
const HALF_TRACK_M = 1.15;
const HALF_BASE_M = 1.3;
/** The bundled Perseverance GLB faces +Z (front hazcams +Z, rear hazcams/RTG −Z).
 * Rotate only the visual child to the scene's −Z forward; physics, mast and yaw stay unchanged.
 */
export const MODEL_YAW_FIX = Math.PI;

export class RoverRig {
  /** Точка на грунте под центром ровера; курс в rotation.y (как у камеры прогулки). */
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private disposed = false;
  private tmp = new THREE.Vector3();

  constructor() {
    this.group.add(this.body);
    this.group.visible = false;
  }

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

      const model = gltf.scene;
      const turn = new THREE.Group();
      turn.rotation.y = MODEL_YAW_FIX;
      turn.add(model);
      turn.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(turn);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const k = ROVER_LENGTH_M / Math.max(size.z, 1e-6);
      const fit = new THREE.Group();
      fit.scale.setScalar(k);
      fit.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
      fit.add(turn);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const std = m as THREE.MeshStandardMaterial;
          if (!std.isMeshStandardMaterial) continue;
          // Без карты окружения металл выходит чёрным: приглушаем металличность.
          std.metalness = Math.min(std.metalness, 0.3);
          std.roughness = Math.max(std.roughness, 0.5);
        }
      });
      this.body.add(fit);
      return true;
    } catch (e) {
      console.warn('[walk] модель ровера не загрузилась', e);
      return false;
    }
  }

  get loaded(): boolean {
    return this.body.children.length > 0;
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  /**
   * Поставить ровер в точку (x, z) с курсом yaw и наклонить корпус по рельефу.
   * groundY возвращает высоту грунта в локальных метрах сцены (NaN — нет данных).
   */
  place(x: number, z: number, yaw: number, groundY: (x: number, z: number) => number): void {
    const y0 = groundY(x, z);
    if (!Number.isFinite(y0)) return;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const at = (f: number, r: number) => {
      const h = groundY(x + fx * f + rx * r, z + fz * f + rz * r);
      return Number.isFinite(h) ? h : y0;
    };
    const front = (at(HALF_BASE_M, HALF_TRACK_M) + at(HALF_BASE_M, -HALF_TRACK_M)) / 2;
    const back = (at(-HALF_BASE_M, HALF_TRACK_M) + at(-HALF_BASE_M, -HALF_TRACK_M)) / 2;
    const right = (at(HALF_BASE_M, HALF_TRACK_M) + at(-HALF_BASE_M, HALF_TRACK_M)) / 2;
    const left = (at(HALF_BASE_M, -HALF_TRACK_M) + at(-HALF_BASE_M, -HALF_TRACK_M)) / 2;
    const pitch = Math.atan2(front - back, 2 * HALF_BASE_M);
    const roll = Math.atan2(left - right, 2 * HALF_TRACK_M);
    this.group.position.set(x, (front + back + left + right) / 4, z);
    this.group.rotation.set(0, yaw, 0, 'YXZ');
    this.body.rotation.set(pitch, 0, roll, 'XYZ');
    this.group.updateMatrixWorld(true);
  }

  /** Мировая точка камеры на мачте. */
  mastPosition(target: THREE.Vector3): THREE.Vector3 {
    this.tmp.set(MAST_RIGHT_M, MAST_HEIGHT_M, -MAST_FORWARD_M);
    return target.copy(this.tmp).applyMatrix4(this.body.matrixWorld);
  }

  dispose(): void {
    this.disposed = true;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    });
  }
}
