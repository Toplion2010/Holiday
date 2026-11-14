// Координаты пакета: равнопромежуточная проекция (сфера R = 3396190 м, lon_0 = 0, lat_ts = 0)
// и локальная система сцены в метрах по земле: x — восток, z — юг, начало в центре участка.

export const MARS_R = 3396190;
const DEG = Math.PI / 180;

export function lonLatToEqc(lonEast: number, lat: number): { x: number; y: number } {
  const lon = ((((lonEast + 180) % 360) + 360) % 360) - 180;
  return { x: MARS_R * lon * DEG, y: MARS_R * lat * DEG };
}

export function eqcToLonLat(x: number, y: number): { lonEast: number; lat: number } {
  const lon = ((((x / MARS_R) / DEG) % 360) + 360) % 360;
  return { lonEast: lon, lat: y / MARS_R / DEG };
}

export interface LocalFrame {
  /** Западная и северная граница, м eqc. */
  west: number;
  north: number;
  /** Центр участка, м eqc. */
  cx: number;
  cy: number;
  /** Шаг сетки высот в метрах eqc. */
  pixelM: number;
  cols: number;
  rows: number;
  /**
   * cos(широты центра): в eqc с lat_ts = 0 метры по оси x растянуты в 1/cos(φ) раз.
   * Локальная сцена в метрах по земле, поэтому x умножаем на kx.
   */
  kx: number;
}

export function makeFrame(boundsEqc: [number, number, number, number], pixelM: number, cols: number, rows: number): LocalFrame {
  const [west, south, east, north] = boundsEqc;
  const cy = (south + north) / 2;
  return {
    west,
    north,
    cx: (west + east) / 2,
    cy,
    pixelM,
    cols,
    rows,
    kx: Math.cos(cy / MARS_R),
  };
}

export function eqcToLocal(f: LocalFrame, x: number, y: number): { x: number; z: number } {
  return { x: (x - f.cx) * f.kx, z: -(y - f.cy) };
}

export function localToEqc(f: LocalFrame, x: number, z: number): { x: number; y: number } {
  return { x: f.cx + x / f.kx, y: f.cy - z };
}

export function lonLatToLocal(f: LocalFrame, lonEast: number, lat: number): { x: number; z: number } {
  const e = lonLatToEqc(lonEast, lat);
  return eqcToLocal(f, e.x, e.y);
}

export function localToLonLat(f: LocalFrame, x: number, z: number): { lonEast: number; lat: number } {
  const e = localToEqc(f, x, z);
  return eqcToLonLat(e.x, e.y);
}

/** Дробные индексы пикселя сетки (центры пикселей — целые). */
export function localToGrid(f: LocalFrame, x: number, z: number): { col: number; row: number } {
  const e = localToEqc(f, x, z);
  return { col: (e.x - f.west) / f.pixelM - 0.5, row: (f.north - e.y) / f.pixelM - 0.5 };
}

export function gridToLocal(f: LocalFrame, col: number, row: number): { x: number; z: number } {
  return eqcToLocal(f, f.west + (col + 0.5) * f.pixelM, f.north - (row + 0.5) * f.pixelM);
}

/** Азимут от севера по часовой для смещения (dx на восток, dz на юг), градусы 0–360. */
export function bearingDeg(dx: number, dz: number): number {
  const b = Math.atan2(dx, -dz) / DEG;
  return (b + 360) % 360;
}
