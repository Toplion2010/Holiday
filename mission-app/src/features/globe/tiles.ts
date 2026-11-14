// Тайловая сетка NASA Mars Trek (WMTS default028mm) с ограничением по нативному уровню слоя.
export const MARS_RADIUS_KM = 3396.19;
export const MARS_EQUATOR_M = 2 * Math.PI * MARS_RADIUS_KM * 1000;

export function tileColumns(z: number): number {
  return 2 ** (z + 1);
}

export function tileRows(z: number): number {
  return 2 ** z;
}

export function tileResolutionM(z: number): number {
  return MARS_EQUATOR_M / (256 * tileColumns(z));
}

export function dataResolutionM(nativeResolutionM: number, z: number): number {
  return Math.max(tileResolutionM(z), nativeResolutionM);
}

export interface TileBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export function tileBounds(z: number, x: number, y: number): TileBounds {
  const span = 360 / tileColumns(z);
  return {
    west: -180 + x * span,
    east: -180 + (x + 1) * span,
    north: 90 - y * span,
    south: 90 - (y + 1) * span,
  };
}

export function lonLatToTile(z: number, lonDeg: number, latDeg: number): { x: number; y: number } {
  const span = 360 / tileColumns(z);
  const x = Math.floor((lonDeg + 180) / span);
  const y = Math.floor((90 - latDeg) / span);
  return {
    x: Math.min(Math.max(x, 0), tileColumns(z) - 1),
    y: Math.min(Math.max(y, 0), tileRows(z) - 1),
  };
}

export function ancestorRect(
  z: number,
  x: number,
  y: number,
  zs: number,
): { x: number; y: number; repeat: number; offsetX: number; offsetY: number } {
  const depth = Math.max(0, z - zs);
  const n = 2 ** depth;
  const ax = Math.floor(x / n);
  const ay = Math.floor(y / n);
  return {
    x: ax,
    y: ay,
    repeat: 1 / n,
    offsetX: (x - ax * n) / n,
    offsetY: 1 - (y - ay * n + 1) / n,
  };
}
