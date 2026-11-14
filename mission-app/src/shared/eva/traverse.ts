// Стоимость перехода по модели EVA: скорость от уклона, метаболическая мощность Санти и расход кислорода.

export const FLAT_SPEED_MS = 0.75;
export const SLOPE_DOMAIN_DEG: [number, number] = [-20, 20];
export const MARS_GRAVITY_FACTOR = 0.38;
export const WATTS_PER_LPM_O2 = 348.3;
export const TREADMILL_LIMIT_MS = 1.74;

export type Surface = 'firm' | 'sand';
export type GravityMode = 'nasa_tool' | 'inertial_kept';
export const GRAVITY_MODES: GravityMode[] = ['nasa_tool', 'inertial_kept'];

export interface SpeedResult {
  speedMs: number;
  status: 'ok' | 'outside_model_domain';
}

/** Линейная модель скорости: V = -0.01*уклон + 0.75 м/с, область определения от -20° до +20°. */
export function walkSpeed(slopeDeg: number): SpeedResult {
  const [low, high] = SLOPE_DOMAIN_DEG;
  const inside = slopeDeg >= low && slopeDeg <= high;
  const clamped = Math.min(Math.max(slopeDeg, low), high);
  return { speedMs: -0.01 * clamped + FLAT_SPEED_MS, status: inside ? 'ok' : 'outside_model_domain' };
}

/** Коэффициент грунта: для песка растёт при падении скорости, для плотного грунта это вилка. */
export function terrainFactor(surface: Surface, vMs: number): [number, number] {
  if (surface === 'sand') {
    const eta = 1.5 + 1.3 / (vMs * vMs);
    return [eta, eta];
  }
  return [1.0, 1.2];
}

/** Уклон в процентах из уклона в градусах. */
export function gradePercent(slopeDeg: number): number {
  return Math.tan((slopeDeg * Math.PI) / 180) * 100;
}

function terms(crewKg: number, loadKg: number, vMs: number, gradePct: number, eta: number) {
  const total = crewKg + loadKg;
  const t1 = 1.5 * crewKg;
  const t2 = 2.0 * total * (loadKg / crewKg) ** 2;
  const t3a = eta * total * 1.5 * vMs * vMs;
  const t3b = eta * total * 0.35 * vMs * gradePct;
  const cf =
    gradePct <= 0
      ? eta * ((gradePct * total * vMs) / 3.5 - (total * (gradePct + 6) ** 2) / crewKg + (25 - vMs * vMs))
      : 0;
  return { t1, t2, t3a, t3b, cf };
}

/** Метаболическая мощность, Вт. Поправка спуска применяется только при уклоне вниз. */
export function metabolicPowerW(
  crewKg: number,
  loadKg: number,
  vMs: number,
  gradePct: number,
  eta: number,
  mode: GravityMode,
): number {
  const { t1, t2, t3a, t3b, cf } = terms(crewKg, loadKg, vMs, gradePct, eta);
  if (mode === 'nasa_tool') return MARS_GRAVITY_FACTOR * (t1 + t2 + t3a + t3b - cf);
  return MARS_GRAVITY_FACTOR * (t1 + t2 + t3b - cf) + t3a;
}

/** Коридор мощности между двумя трактовками марсианской тяжести. */
export function marsPowerCorridorW(
  crewKg: number,
  loadKg: number,
  vMs: number,
  gradePct: number,
  eta: number,
): [number, number] {
  const values = GRAVITY_MODES.map((mode) => metabolicPowerW(crewKg, loadKg, vMs, gradePct, eta, mode));
  return [Math.min(...values), Math.max(...values)];
}

export function oxygenLpm(powerW: number): number {
  return powerW / WATTS_PER_LPM_O2;
}

export interface TraverseParams {
  surface: Surface;
  crewKg: number;
  loadKg: number;
}

export const DEFAULT_TRAVERSE: TraverseParams = { surface: 'firm', crewKg: 80, loadKg: 45 };

export interface SegmentCost {
  seconds: number;
  speedMs: number;
  status: SpeedResult['status'];
  powerLowW: number;
  powerHighW: number;
  o2LowL: number;
  o2HighL: number;
  /** Середина коридора кислорода — именно она служит ценой ребра в поиске пути. */
  o2MidL: number;
}

/** Цена участка длиной runM с данным уклоном: время, мощность и кислород по модели. */
export function segmentCost(runM: number, slopeDeg: number, params: TraverseParams = DEFAULT_TRAVERSE): SegmentCost {
  const speed = walkSpeed(slopeDeg);
  const grade = gradePercent(slopeDeg);
  const [etaLow, etaHigh] = terrainFactor(params.surface, speed.speedMs);
  const powers: number[] = [];
  for (const eta of etaLow === etaHigh ? [etaLow] : [etaLow, etaHigh]) {
    powers.push(...marsPowerCorridorW(params.crewKg, params.loadKg, speed.speedMs, grade, eta));
  }
  const powerLowW = Math.max(Math.min(...powers), 0);
  const powerHighW = Math.max(...powers, 0);
  const seconds = speed.speedMs > 0 ? runM / speed.speedMs : Infinity;
  const minutes = seconds / 60;
  const o2LowL = oxygenLpm(powerLowW) * minutes;
  const o2HighL = oxygenLpm(powerHighW) * minutes;
  return {
    seconds,
    speedMs: speed.speedMs,
    status: speed.status,
    powerLowW,
    powerHighW,
    o2LowL,
    o2HighL,
    o2MidL: (o2LowL + o2HighL) / 2,
  };
}

/** Удельная цена метра пути в литрах кислорода — то, что минимизирует поиск маршрута. */
export function costPerMetreL(slopeDeg: number, params: TraverseParams = DEFAULT_TRAVERSE): number {
  return segmentCost(1, slopeDeg, params).o2MidL;
}
