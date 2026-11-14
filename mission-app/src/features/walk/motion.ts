// Модель движения пешком: скорость в скафандре, уклоны и правило блокировки шага.

import { SLOPE_DOMAIN_DEG, walkSpeed as modelSpeed } from '@/shared/eva/traverse';

import { localToGrid, type LocalFrame } from './geo';
import { sampleBilinear, sourceCode, type HeightGrid } from './heightGrid';

const DEG = 180 / Math.PI;

/** Параметр симуляции (ТЗ EVA 9.1, калибровка по Apollo): V = −0.01·θ + 0.75 м/с, не меньше 0,1. */
export const MIN_SPEED_MS = 0.1;
export function walkSpeed(slopeDeg: number): number {
  if (!Number.isFinite(slopeDeg)) return MIN_SPEED_MS;
  const [domainMin, domainMax] = SLOPE_DOMAIN_DEG;
  const limited = Math.max(slopeDeg, domainMin);
  const beyond = limited > domainMax ? (limited - domainMax) * 0.01 : 0;
  return Math.max(MIN_SPEED_MS, modelSpeed(Math.min(limited, domainMax)).speedMs - beyond);
}

export const SLOPE_THRESHOLDS = [15, 20, 25] as const;
export const DEFAULT_MAX_SLOPE = 20;

/** Минимальная полубаза центральных разностей для уклона, м (как у прежней сетки 2 м). */
export const SLOPE_HALF_BASE_M = 2;

export type BlockReason = 'nodata' | 'slope' | null;

/**
 * Можно ли шагнуть в точку. Нельзя в NoData и на уклон круче порога.
 * Исключение: если уже стоишь на крутом, разрешаем шаг туда, где положе, — чтобы выбраться.
 */
export function stepBlocked(targetHeight: number, targetSlopeDeg: number, hereSlopeDeg: number, maxSlopeDeg: number): BlockReason {
  if (!Number.isFinite(targetHeight) || !Number.isFinite(targetSlopeDeg)) return 'nodata';
  if (targetSlopeDeg > maxSlopeDeg && !(Number.isFinite(hereSlopeDeg) && targetSlopeDeg < hereSlopeDeg)) return 'slope';
  return null;
}

/** Рельеф в локальных метрах сцены. */
export class TerrainSampler {
  /**
   * Полубаза разностей для уклона по земле, м: шаг сетки, но не меньше SLOPE_HALF_BASE_M.
   * При сетке 1 м разность на соседних узлах ловила бы шум DTM (эффективное разрешение
   * HiRISE DTM — несколько метров), а пороги уклона подобраны для базы 4 м.
   */
  readonly dx: number;
  readonly dz: number;

  constructor(readonly grid: HeightGrid, readonly frame: LocalFrame) {
    const half = Math.max(frame.pixelM, SLOPE_HALF_BASE_M);
    this.dx = half * frame.kx;
    this.dz = half;
  }

  /** Код источника высоты под точкой (канал B карты высот). */
  sourceAt(x: number, z: number): number {
    const g = localToGrid(this.frame, x, z);
    return sourceCode(this.grid, g.col, g.row);
  }

  heightAt(x: number, z: number): number {
    const g = localToGrid(this.frame, x, z);
    return sampleBilinear(this.grid, g.col, g.row);
  }

  /** Модуль уклона (крутизна) в градусах по центральным разностям на шаг сетки. */
  slopeDeg(x: number, z: number): number {
    return slopeFromSamples(
      this.heightAt(x - this.dx, z), this.heightAt(x + this.dx, z), this.dx,
      this.heightAt(x, z - this.dz), this.heightAt(x, z + this.dz), this.dz,
      this.heightAt(x, z),
    );
  }

  /** Уклон вдоль направления (dirX, dirZ — единичный) на расстоянии dist, градусы, подъём > 0. */
  slopeAlongDeg(x: number, z: number, dirX: number, dirZ: number, dist: number): number {
    const h0 = this.heightAt(x, z);
    const h1 = this.heightAt(x + dirX * dist, z + dirZ * dist);
    return directionalSlopeDeg(h0, h1, dist);
  }
}

export function directionalSlopeDeg(h0: number, h1: number, dist: number): number {
  if (!Number.isFinite(h0) || !Number.isFinite(h1) || dist <= 0) return NaN;
  return Math.atan2(h1 - h0, dist) * DEG;
}

/** Крутизна по соседям; если с одной стороны NoData, берём одностороннюю разность. */
export function slopeFromSamples(
  xMinus: number, xPlus: number, dx: number,
  zMinus: number, zPlus: number, dz: number,
  center: number,
): number {
  const grad = (a: number, b: number, d: number): number => {
    if (Number.isFinite(a) && Number.isFinite(b)) return (b - a) / (2 * d);
    if (!Number.isFinite(center)) return NaN;
    if (Number.isFinite(b)) return (b - center) / d;
    if (Number.isFinite(a)) return (center - a) / d;
    return NaN;
  };
  const gx = grad(xMinus, xPlus, dx);
  const gz = grad(zMinus, zPlus, dz);
  if (!Number.isFinite(gx) || !Number.isFinite(gz)) return NaN;
  return Math.atan(Math.hypot(gx, gz)) * DEG;
}
