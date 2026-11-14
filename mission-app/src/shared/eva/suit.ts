// Модель выхода в скафандре: скорость, время возврата, расходники, точка невозврата.
// Числа — из docs/TZ_EVA_Safety.md, разделы 9.1 и 9.2. Всё здесь — модель, не измерение.

import { walkSpeed as modelSpeed } from './traverse';

/** Скорость на ровном по модели 9.1, м/с. */
export const FLAT_SPEED_MS = 0.75;
/** Область определения модели скорости по уклону, ° (раздел 9.1). */
export const SPEED_MODEL_MAX_SLOPE_DEG = 20;

/**
 * Скорость ходьбы от уклона: V = −0.01·θ + 0.75 м/с (калибровка по трекам Apollo, раздел 9.1).
 * θ — знаковый уклон, °: под гору быстрее, в гору медленнее. Вне области ±20° модель не определена → null.
 */
export function walkSpeed(slopeDeg: number): number | null {
  if (!Number.isFinite(slopeDeg) || Math.abs(slopeDeg) > SPEED_MODEL_MAX_SLOPE_DEG) return null;
  return modelSpeed(slopeDeg).speedMs;
}

/** Время возврата по прямой на базу со скоростью по ровному, с. */
export function returnTimeS(baseDistanceM: number, speedMs = FLAT_SPEED_MS): number {
  return Math.max(0, baseDistanceM) / speedMs;
}

export interface EvaBudgetParams {
  /** Проектная длительность выхода, с (раздел 9.2: 8 ч). */
  designS: number;
  /** Резерв на возврат при одиночном отказе, с (раздел 9.2: 30 мин). */
  reserveS: number;
  /** Скорость возврата, м/с. */
  returnSpeedMs: number;
}

export const DEFAULT_EVA_BUDGET: EvaBudgetParams = {
  designS: 8 * 3600,
  reserveS: 30 * 60,
  returnSpeedMs: FLAT_SPEED_MS,
};

export interface EvaBudget {
  /** Осталось по расходникам, с. */
  leftS: number;
  /** Время возврата на базу, с. */
  backS: number;
  /** Свободный запас: остаток − возврат − резерв, с (может быть < 0). */
  slackS: number;
  /** Сколько ещё можно отойти от базы и успеть вернуться, м (0, если запаса нет). */
  extraOutM: number;
  /** Точка невозврата пройдена: остаток < возврат + резерв. */
  pastNoReturn: boolean;
}

export function evaBudget(
  evaSeconds: number,
  baseDistanceM: number,
  params: EvaBudgetParams = DEFAULT_EVA_BUDGET,
): EvaBudget {
  const leftS = params.designS - Math.max(0, evaSeconds);
  const backS = returnTimeS(baseDistanceM, params.returnSpeedMs);
  const slackS = leftS - backS - params.reserveS;
  // уйти дальше на d и вернуться: 2·d / V
  const extraOutM = slackS > 0 ? (slackS * params.returnSpeedMs) / 2 : 0;
  return { leftS, backS, slackS, extraOutM, pastNoReturn: leftS < backS + params.reserveS };
}

/** Темнота: до заката меньше, чем время возврата. null — нет заката в ближайший сол. */
export function darknessRisk(secondsToSunset: number | null, backS: number): boolean {
  return secondsToSunset !== null && secondsToSunset < backS;
}

export type SlopeLevel = 'ok' | 'warn' | 'danger';

/** Цвет уклона: до 15° — зелёный, до порога — жёлтый, выше — красный (ТЗ 6.2). */
export function slopeLevel(slopeDeg: number, maxSlopeDeg: number): SlopeLevel {
  const s = Math.abs(slopeDeg);
  if (s > maxSlopeDeg) return 'danger';
  if (s > Math.min(15, maxSlopeDeg)) return 'warn';
  return 'ok';
}

/** «1 ч 05 мин», «12 мин», «40 с». */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const sign = seconds < 0 ? '−' : '';
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${sign}${h} ч ${String(m).padStart(2, '0')} мин`;
  if (m > 0) return `${sign}${m} мин`;
  return `${sign}${s} с`;
}

/** «680 м», «1,2 км». */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (Math.abs(m) < 1000) return `${Math.round(m)} м`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} км`;
}
