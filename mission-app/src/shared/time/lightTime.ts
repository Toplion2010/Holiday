// Время прохождения света Земля–Марс: линейная интерполяция по таблице JPL Horizons,
// которая лежит в проекте (`/data/ephemeris/earth_mars_light_time.json`).

export const LIGHT_TIME_URL = '/data/ephemeris/earth_mars_light_time.json';

export interface LightTimeEntry {
  utc: string;
  distance_au: number;
  light_time_s: number;
}

export interface LightTimeTable {
  source: string;
  generated_utc: string;
  step_hours: number;
  entries: LightTimeEntry[];
}

export interface LightTime {
  /** Время света в одну сторону, с. */
  oneWayS: number;
  distanceAu: number;
  source: string;
  generatedUtc: string;
}

interface Prepared {
  table: LightTimeTable;
  times: number[];
}

function prepare(table: LightTimeTable): Prepared | null {
  if (!table || !Array.isArray(table.entries) || table.entries.length < 2) return null;
  const rows = table.entries
    .map(e => ({ e, t: Date.parse(e.utc) }))
    .filter(r => Number.isFinite(r.t) && Number.isFinite(r.e.light_time_s))
    .sort((a, b) => a.t - b.t);
  if (rows.length < 2) return null;
  return { table: { ...table, entries: rows.map(r => r.e) }, times: rows.map(r => r.t) };
}

const preparedCache = new WeakMap<LightTimeTable, Prepared | null>();

/** Интерполяция; null — таблицы нет или момент вне её диапазона. */
export function interpolateLightTime(table: LightTimeTable | null, utcMs: number): LightTime | null {
  if (!table) return null;
  let p = preparedCache.get(table);
  if (p === undefined) {
    p = prepare(table);
    preparedCache.set(table, p);
  }
  if (!p) return null;
  const { times } = p;
  const entries = p.table.entries;
  if (utcMs < times[0] || utcMs > times[times.length - 1]) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= utcMs) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  const f = span > 0 ? (utcMs - times[lo]) / span : 0;
  const a = entries[lo];
  const b = entries[hi];
  return {
    oneWayS: a.light_time_s + (b.light_time_s - a.light_time_s) * f,
    distanceAu: a.distance_au + (b.distance_au - a.distance_au) * f,
    source: table.source,
    generatedUtc: table.generated_utc,
  };
}

let loading: Promise<LightTimeTable | null> | null = null;

/** Загружает таблицу один раз; при ошибке — null (HUD покажет «нет данных»). */
export function loadLightTimeTable(url = LIGHT_TIME_URL): Promise<LightTimeTable | null> {
  if (!loading) {
    loading = fetch(url)
      .then(r => (r.ok ? (r.json() as Promise<LightTimeTable>) : null))
      .then(t => (t && Array.isArray(t.entries) ? t : null))
      .catch(() => null);
  }
  return loading;
}

/** «18 мин 40 с». */
export function formatLightTime(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} мин ${String(s).padStart(2, '0')} с`;
}
