// Рельеф кусками: каждый кусок ~128 × 128 м сетки DTM с несколькими уровнями детализации.
// Вблизи — полная сетка (шаг пакета, 1 м у новых пакетов), дальше — реже.
// Треугольники с NoData не строятся.

import * as THREE from 'three';
import { gridToLocal, type LocalFrame } from './geo';
import { gridValue, type HeightGrid } from './heightGrid';

/** Сторона куска в ячейках сетки при шаге 2 м (128 м); при шаге 1 м — 128 ячеек. */
export const CHUNK_CELLS = 64;
const CHUNK_M = 128;
/** Шаг по сетке для уровней (в ячейках). */
export const LOD_STEPS = [1, 2, 4, 8, 16] as const;
/**
 * До какого расстояния (м по горизонтали) нужен уровень с данным шагом по земле, м.
 * Для пакетов с шагом 2 м это прежние 180 / 450 / 950 м для 2 / 4 / 8 м.
 */
const LOD_DIST_BY_SPACING: [spacingM: number, distM: number][] = [
  [1, 130],
  [2, 180],
  [4, 450],
  [8, 950],
];

/** Сторона куска в ячейках для шага сетки pixelM: куски около 128 м, не меньше 64 ячеек. */
export function chunkCellsFor(pixelM: number): number {
  return Math.max(CHUNK_CELLS, Math.round(CHUNK_M / pixelM));
}

/** Пороги дальности для уровней LOD_STEPS при шаге сетки pixelM. */
export function lodDistances(pixelM: number): number[] {
  return LOD_STEPS.map((step, i) => {
    if (i === LOD_STEPS.length - 1) return Infinity;
    const spacing = step * pixelM;
    // Шаг мельче 1 м по земле не строим дальше, чем 1 м; уровни грубее 8 м — до горизонта.
    const row = LOD_DIST_BY_SPACING.find(([s]) => spacing <= s + 1e-6);
    return row ? row[1] : Infinity;
  });
}

export function lodForDistance(distM: number, pixelM = 2): number {
  return lodDistances(pixelM).findIndex((d) => distM < d);
}

interface Chunk {
  c0: number;
  r0: number;
  /** Прямоугольник куска в локальных координатах. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  mesh: THREE.Mesh;
  levels: (THREE.BufferGeometry | null)[];
  level: number;
}

export function buildChunkGeometry(
  grid: HeightGrid,
  frame: LocalFrame,
  c0: number,
  r0: number,
  step: number,
  refY: number,
  origin: { x: number; z: number },
  cells: number = CHUNK_CELLS,
): THREE.BufferGeometry | null {
  const cs: number[] = [];
  const rs: number[] = [];
  const cEnd = Math.min(c0 + cells, grid.width - 1);
  const rEnd = Math.min(r0 + cells, grid.height - 1);
  for (let c = c0; c < cEnd; c += step) cs.push(c);
  cs.push(cEnd);
  for (let r = r0; r < rEnd; r += step) rs.push(r);
  rs.push(rEnd);
  const nc = cs.length;
  const nr = rs.length;
  if (nc < 2 || nr < 2) return null;

  const dxM = frame.pixelM * frame.kx;
  const dzM = frame.pixelM;
  const edgeCount = 2 * (nc + nr);
  const vCount = nc * nr + edgeCount;
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const valid = new Uint8Array(vCount);
  const h = (c: number, r: number) => gridValue(grid, c, r);

  const put = (i: number, c: number, r: number, yOffset: number) => {
    const p = gridToLocal(frame, c, r);
    const z0 = h(c, r);
    const ok = Number.isFinite(z0);
    valid[i] = ok ? 1 : 0;
    pos[i * 3] = p.x - origin.x;
    pos[i * 3 + 1] = ok ? z0 - refY + yOffset : 0;
    pos[i * 3 + 2] = p.z - origin.z;
    uv[i * 2] = (c + 0.5) / grid.width;
    uv[i * 2 + 1] = (r + 0.5) / grid.height;
    // Нормаль по центральным разностям на шаг уровня.
    const s = step;
    let gx = (h(c + s, r) - h(c - s, r)) / (2 * s * dxM);
    let gz = (h(c, r + s) - h(c, r - s)) / (2 * s * dzM);
    if (!Number.isFinite(gx)) gx = 0;
    if (!Number.isFinite(gz)) gz = 0;
    const len = Math.hypot(gx, 1, gz);
    nor[i * 3] = -gx / len;
    nor[i * 3 + 1] = 1 / len;
    nor[i * 3 + 2] = -gz / len;
  };

  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) put(j * nc + i, cs[i], rs[j], 0);

  const index: number[] = [];
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i;
      const b = a + 1;
      const c = a + nc;
      const d = c + 1;
      if (valid[a] && valid[b] && valid[c] && valid[d]) {
        // Против часовой сверху (y вверх, z на юг).
        index.push(a, c, b, b, c, d);
      }
    }
  }

  // «Юбка» по краю куска прячет щели между уровнями детализации.
  const skirt = step * frame.pixelM * 0.6 + 0.5;
  let next = nc * nr;
  const edges: number[][] = [
    cs.map((_, i) => i),
    cs.map((_, i) => (nr - 1) * nc + i),
    rs.map((_, j) => j * nc),
    rs.map((_, j) => j * nc + nc - 1),
  ];
  for (const edge of edges) {
    const low: number[] = [];
    for (const top of edge) {
      const k = next++;
      pos[k * 3] = pos[top * 3];
      pos[k * 3 + 1] = pos[top * 3 + 1] - skirt;
      pos[k * 3 + 2] = pos[top * 3 + 2];
      nor.set(nor.subarray(top * 3, top * 3 + 3), k * 3);
      uv.set(uv.subarray(top * 2, top * 2 + 2), k * 2);
      valid[k] = valid[top];
      low.push(k);
    }
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i];
      const b = edge[i + 1];
      if (!valid[a] || !valid[b]) continue;
      const la = low[i];
      const lb = low[i + 1];
      index.push(a, la, b, b, la, lb, a, b, la, b, lb, la);
    }
  }
  if (index.length === 0) return null;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Набор кусков рельефа с переключением детализации по расстоянию от игрока. */
export class TerrainChunks {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private empty = new THREE.BufferGeometry();
  private readonly cells: number;
  private readonly lodDist: number[];

  constructor(
    private grid: HeightGrid,
    private frame: LocalFrame,
    private refY: number,
    readonly material: THREE.Material,
  ) {
    const cells = (this.cells = chunkCellsFor(frame.pixelM));
    this.lodDist = lodDistances(frame.pixelM);
    for (let r0 = 0; r0 < grid.height - 1; r0 += cells) {
      for (let c0 = 0; c0 < grid.width - 1; c0 += cells) {
        const a = gridToLocal(frame, c0, r0);
        const b = gridToLocal(frame, Math.min(c0 + cells, grid.width - 1), Math.min(r0 + cells, grid.height - 1));
        const mesh = new THREE.Mesh(this.empty, material);
        mesh.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.visible = false;
        this.group.add(mesh);
        this.chunks.push({
          c0, r0, minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z, mesh,
          levels: LOD_STEPS.map(() => null), level: -1,
        });
      }
    }
  }

  private geometry(ch: Chunk, level: number): THREE.BufferGeometry | null {
    let g = ch.levels[level];
    if (!g) {
      g = buildChunkGeometry(this.grid, this.frame, ch.c0, ch.r0, LOD_STEPS[level], this.refY, ch.mesh.position, this.cells);
      ch.levels[level] = g ?? this.empty;
    }
    return g === this.empty ? null : g;
  }

  /** Самый грубый уровень сразу для всех кусков, чтобы сцена была целой с первого кадра. */
  buildAll(): void {
    const coarse = LOD_STEPS.length - 1;
    for (const ch of this.chunks) this.apply(ch, coarse);
  }

  private apply(ch: Chunk, level: number): void {
    const g = this.geometry(ch, level);
    ch.level = level;
    ch.mesh.geometry = g ?? this.empty;
    ch.mesh.visible = !!g;
  }

  /** Обновить детализацию; maxBuilds — сколько новых геометрий можно построить за вызов. */
  update(x: number, z: number, maxBuilds = 4): void {
    const want = this.chunks.map((ch) => {
      const dx = Math.max(ch.minX - x, 0, x - ch.maxX);
      const dz = Math.max(ch.minZ - z, 0, z - ch.maxZ);
      const dist = Math.hypot(dx, dz);
      return { ch, dist, level: this.lodDist.findIndex((d) => dist < d) };
    });
    want.sort((a, b) => a.dist - b.dist);
    let builds = 0;
    for (const w of want) {
      if (w.ch.level === w.level) continue;
      if (!w.ch.levels[w.level]) {
        if (builds >= maxBuilds) continue;
        builds++;
      }
      this.apply(w.ch, w.level);
    }
    // Далёкие подробные уровни не держим в памяти.
    for (const w of want) {
      for (let l = 0; l < w.level; l++) {
        const g = w.ch.levels[l];
        if (g && g !== this.empty && l !== w.ch.level && w.dist > this.lodDist[l] * 1.6) {
          g.dispose();
          w.ch.levels[l] = null;
        }
      }
    }
  }

  dispose(): void {
    for (const ch of this.chunks) {
      for (const g of ch.levels) if (g && g !== this.empty) g.dispose();
    }
    this.empty.dispose();
    this.chunks = [];
  }
}
