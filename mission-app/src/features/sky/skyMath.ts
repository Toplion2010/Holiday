// Чистые функции неба: оси сцены и ENU, фаза дня по высоте Солнца, подбор момента по местному истинному солнечному времени.

import { marsSolDate, solarGeometry, unixMsFromMarsSolDate } from './marsTime';

export type DayPhase = 'day' | 'twilight' | 'night';

export const TWILIGHT_TOP_DEG = 5;
export const TWILIGHT_BOTTOM_DEG = -18;

export function dayPhase(elevationDeg: number): DayPhase {
  if (elevationDeg > TWILIGHT_TOP_DEG) return 'day';
  if (elevationDeg > TWILIGHT_BOTTOM_DEG) return 'twilight';
  return 'night';
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Доля дневного неба: 1 при Солнце выше +5°, 0 ниже −18°. */
export function daylightWeight(elevationDeg: number): number {
  return smoothstep(TWILIGHT_BOTTOM_DEG, TWILIGHT_TOP_DEG, elevationDeg);
}

/** Доля видимости звёзд: 0 днём, 1 в полную ночь. */
export function starWeight(elevationDeg: number): number {
  return 1 - smoothstep(TWILIGHT_BOTTOM_DEG, TWILIGHT_TOP_DEG - 5, elevationDeg);
}

/** Оси сцены (x восток, y вверх, z юг) → ENU (восток, север, зенит). */
export function sceneToEnu(v: [number, number, number]): [number, number, number] {
  return [v[0], 0 - v[2], v[1]];
}

/** ENU → оси сцены. */
export function enuToScene(v: [number, number, number]): [number, number, number] {
  return [v[0], v[2], 0 - v[1]];
}

function wrapHours(h: number): number {
  return ((((h + 12) % 24) + 24) % 24) - 12;
}

/** Момент UTC (мс), когда местное истинное солнечное время участка равно заданному; ищется возле опорного момента. */
export function unixMsForLtst(nearUnixMs: number, latDeg: number, lonEastDeg: number, ltstHours: number): number {
  const msdNow = marsSolDate(nearUnixMs);
  let msd = msdNow;
  for (let i = 0; i < 4; i += 1) {
    const g = solarGeometry(unixMsFromMarsSolDate(msd), latDeg, lonEastDeg);
    msd += wrapHours(ltstHours - g.ltst) / 24;
  }
  return unixMsFromMarsSolDate(msd);
}

/** Момент ближайшего (по времени суток) восхода или заката: высота Солнца = 0°. */
export function unixMsForSunCrossing(nearUnixMs: number, latDeg: number, lonEastDeg: number, rising: boolean): number {
  const noon = unixMsForLtst(nearUnixMs, latDeg, lonEastDeg, 12);
  const noonMsd = marsSolDate(noon);
  let lo = rising ? noonMsd - 0.5 : noonMsd;
  let hi = rising ? noonMsd : noonMsd + 0.5;
  const el = (msd: number) => solarGeometry(unixMsFromMarsSolDate(msd), latDeg, lonEastDeg).elevationDeg;
  if (el(noonMsd) <= 0) return noon;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (el(mid) > 0 === rising) hi = mid;
    else lo = mid;
  }
  return unixMsFromMarsSolDate((lo + hi) / 2);
}
