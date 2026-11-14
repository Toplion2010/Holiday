// Марсианское время по алгоритму NASA GISS Mars24 (шаги A–D):
// https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
// Все долготы на входе — восточные 0–360 (как во всём проекте). В алгоритме Mars24 долготы
// западные, перевод делается внутри. Время — миллисекунды UTC.

const DEG = Math.PI / 180;

/** Длина марсианских суток в земных секундах (Mars24: 1.0274912517 сут). */
export const SOL_SECONDS = 1.0274912517 * 86400;

/** Радиус Марса для расстояний по дуге, км (средний). */
export const MARS_RADIUS_KM = 3389.5;

// TAI−UTC, с, по таблице високосных секунд IERS (с 1972 года). Новых секунд после 2017-01-01 нет.
const LEAP_SECONDS: [number, number][] = [
  [Date.UTC(1972, 0, 1), 10], [Date.UTC(1972, 6, 1), 11], [Date.UTC(1973, 0, 1), 12],
  [Date.UTC(1974, 0, 1), 13], [Date.UTC(1975, 0, 1), 14], [Date.UTC(1976, 0, 1), 15],
  [Date.UTC(1977, 0, 1), 16], [Date.UTC(1978, 0, 1), 17], [Date.UTC(1979, 0, 1), 18],
  [Date.UTC(1980, 0, 1), 19], [Date.UTC(1981, 6, 1), 20], [Date.UTC(1982, 6, 1), 21],
  [Date.UTC(1983, 6, 1), 22], [Date.UTC(1985, 6, 1), 23], [Date.UTC(1988, 0, 1), 24],
  [Date.UTC(1990, 0, 1), 25], [Date.UTC(1991, 0, 1), 26], [Date.UTC(1992, 6, 1), 27],
  [Date.UTC(1993, 6, 1), 28], [Date.UTC(1994, 6, 1), 29], [Date.UTC(1996, 0, 1), 30],
  [Date.UTC(1997, 6, 1), 31], [Date.UTC(1999, 0, 1), 32], [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34], [Date.UTC(2012, 6, 1), 35], [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

const PBS_TERMS: [number, number, number][] = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

const mod = (x: number, m: number) => ((x % m) + m) % m;

/** A-4: TT−UTC, с. */
export function ttMinusUtc(utcMs: number): number {
  if (utcMs < LEAP_SECONDS[0][0]) {
    const jdUt = 2440587.5 + utcMs / 8.64e7;
    const t = (jdUt - 2451545.0) / 36525;
    return 64.184 + 59 * t - 51.2 * t ** 2 - 67.1 * t ** 3 - 16.4 * t ** 4;
  }
  let tai = 10;
  for (const [from, value] of LEAP_SECONDS) {
    if (utcMs >= from) tai = value;
    else break;
  }
  return tai + 32.184;
}

export interface MarsTime {
  jdUt: number;
  jdTt: number;
  /** A-6: дни от J2000 (TT). */
  dtJ2000: number;
  /** B-1: средняя аномалия, °. */
  meanAnomalyDeg: number;
  /** B-4: уравнение центра ν−M, °. */
  eqCenterDeg: number;
  /** B-5: солнечная долгота Ls, ° 0–360. */
  lsDeg: number;
  /** C-1: уравнение времени, ° (в часах — /15). */
  eotDeg: number;
  /** Mars Sol Date. */
  msd: number;
  /** C-2: время по нулевому меридиану (AMT/MTC), ч. */
  mtcHours: number;
  /** D-1: склонение Солнца (подсолнечная широта), °. */
  subsolarLatDeg: number;
  /** C-5: подсолнечная долгота, восточная 0–360, °. */
  subsolarLonEastDeg: number;
  /** D-2: расстояние Марс–Солнце, а.е. */
  heliocentricAu: number;
}

/** Шаги A–D для момента UTC. */
export function marsTime(utcMs: number): MarsTime {
  const jdUt = 2440587.5 + utcMs / 8.64e7;
  const jdTt = jdUt + ttMinusUtc(utcMs) / 86400;
  const dt = jdTt - 2451545.0;
  const m = 19.3871 + 0.52402073 * dt;
  const alphaFms = 270.3871 + 0.524038496 * dt;
  let pbs = 0;
  for (const [a, tau, phi] of PBS_TERMS) pbs += a * Math.cos((0.985626 * dt / tau + phi) * DEG);
  const mr = m * DEG;
  const eqCenter =
    (10.691 + 3.0e-7 * dt) * Math.sin(mr) +
    0.623 * Math.sin(2 * mr) +
    0.05 * Math.sin(3 * mr) +
    0.005 * Math.sin(4 * mr) +
    0.0005 * Math.sin(5 * mr) +
    pbs;
  const ls = mod(alphaFms + eqCenter, 360);
  const lsr = ls * DEG;
  const eot =
    2.861 * Math.sin(2 * lsr) - 0.071 * Math.sin(4 * lsr) + 0.002 * Math.sin(6 * lsr) - eqCenter;
  const msd = (jdTt - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mtc = mod(24 * msd, 24);
  const subsolarLonWest = mod(mtc * 15 + eot + 180, 360);
  const decl = Math.asin(0.42565 * Math.sin(lsr)) / DEG + 0.25 * Math.sin(lsr);
  const r =
    1.52367934 *
    (1.00436 - 0.09309 * Math.cos(mr) - 0.004336 * Math.cos(2 * mr) - 0.00031 * Math.cos(3 * mr) -
      0.00003 * Math.cos(4 * mr));
  return {
    jdUt,
    jdTt,
    dtJ2000: dt,
    meanAnomalyDeg: mod(m, 360),
    eqCenterDeg: eqCenter,
    lsDeg: ls,
    eotDeg: eot,
    msd,
    mtcHours: mtc,
    subsolarLatDeg: decl,
    subsolarLonEastDeg: mod(-subsolarLonWest, 360),
    heliocentricAu: r,
  };
}

/** C-3: местное среднее солнечное время, ч, для восточной долготы. */
export function lmstHours(t: MarsTime, lonEastDeg: number): number {
  return mod(t.mtcHours + lonEastDeg / 15, 24);
}

/** C-4: местное истинное солнечное время, ч. */
export function ltstHours(t: MarsTime, lonEastDeg: number): number {
  return mod(lmstHours(t, lonEastDeg) + t.eotDeg / 15, 24);
}

export interface SunPosition {
  /** Высота над математическим горизонтом, ° (без рельефа и рефракции). */
  elevationDeg: number;
  /** Азимут от севера по часовой, ° 0–360. */
  azimuthDeg: number;
}

/** D-5, D-6: высота и азимут Солнца в точке. */
export function sunPosition(t: MarsTime, latDeg: number, lonEastDeg: number): SunPosition {
  const phi = latDeg * DEG;
  const dec = t.subsolarLatDeg * DEG;
  // H = Λ − Λs в западных долготах = Λs(восточн.) − Λ(восточн.)
  const h = (t.subsolarLonEastDeg - lonEastDeg) * DEG;
  const cosZ = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(h);
  const z = Math.acos(Math.max(-1, Math.min(1, cosZ))) / DEG;
  const az = Math.atan2(Math.sin(h), Math.cos(phi) * Math.tan(dec) - Math.sin(phi) * Math.cos(h));
  return { elevationDeg: 90 - z, azimuthDeg: mod(az / DEG, 360) };
}

export interface SunEvent {
  kind: 'sunrise' | 'sunset';
  utcMs: number;
  /** Сколько земных секунд до события. */
  inSeconds: number;
}

/**
 * Ближайшие закат и восход после момента utcMs (геометрический центр диска на горизонте).
 * Поиск шагом ~10 мин до 1.1 сола и уточнение делением пополам. null — полярный день/ночь.
 */
export function nextSunEvents(
  utcMs: number,
  latDeg: number,
  lonEastDeg: number,
): { sunset: SunEvent | null; sunrise: SunEvent | null } {
  const elev = (ms: number) => sunPosition(marsTime(ms), latDeg, lonEastDeg).elevationDeg;
  const step = 600_000;
  const horizon = utcMs + 1.1 * SOL_SECONDS * 1000;
  let sunset: SunEvent | null = null;
  let sunrise: SunEvent | null = null;
  let prevMs = utcMs;
  let prev = elev(prevMs);
  for (let ms = utcMs + step; ms <= horizon && (!sunset || !sunrise); ms += step) {
    const cur = elev(ms);
    if ((prev > 0) !== (cur > 0)) {
      let lo = prevMs;
      let hi = ms;
      const loAbove = prev > 0;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if ((elev(mid) > 0) === loAbove) lo = mid;
        else hi = mid;
      }
      const at = (lo + hi) / 2;
      const ev: SunEvent = {
        kind: loAbove ? 'sunset' : 'sunrise',
        utcMs: at,
        inSeconds: (at - utcMs) / 1000,
      };
      if (ev.kind === 'sunset' && !sunset) sunset = ev;
      if (ev.kind === 'sunrise' && !sunrise) sunrise = ev;
    }
    prevMs = ms;
    prev = cur;
  }
  return { sunset, sunrise };
}

/** Расстояние по дуге большого круга на Марсе, км. */
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// --- Солы миссий ---------------------------------------------------------------------------
//
// Соглашение: сол посадки — sol 0; сол считается по местному среднему солнечному времени
// (LMST) «часов миссии», привязанных к долготе места посадки; новый сол начинается в полночь LMST.
// Источник — NASA GISS, Mars24 «Technical Notes on Mars Solar Time»:
// https://www.giss.nasa.gov/tools/mars24/help/notes.html
// - MSL Curiosity: «Sol 0 — солнечные сутки посадки»; часы миссии — LMST от полуночи
//   для 137.42° в. д. (фактическое место 137.442° в. д.). Посадка 2012-08-06 ~05:18 UTC, MSD 49269.
// - Mars 2020 Perseverance: «Sol 0 — сутки посадки»; часы миссии — LMST для 77.43° в. д.
//   (фактически 77.45° в. д.). Посадка 2021-02-18 20:44 UTC (на Марсе), около 15:53 LMST.
// Проверка по файлам NASA MMGIS на 2026-11-14 (см. mars24.test.ts): последний заезд
// Curiosity — sol 5073, Perseverance — sol 2022.

export interface MissionClock {
  id: 'msl' | 'm2020';
  title: string;
  /** Долгота часов миссии, ° в. д. */
  clockLonEastDeg: number;
  /** Момент посадки (SCET, UTC). */
  landingUtcMs: number;
  /** Место для проверки «рядом с ровером». */
  siteLat: number;
  siteLonEast: number;
}

export const MISSION_CLOCKS: MissionClock[] = [
  {
    id: 'msl',
    title: 'Curiosity',
    clockLonEastDeg: 137.42,
    landingUtcMs: Date.UTC(2012, 7, 6, 5, 17, 57),
    siteLat: -4.6,
    siteLonEast: 137.4,
  },
  {
    id: 'm2020',
    title: 'Perseverance',
    clockLonEastDeg: 77.43,
    landingUtcMs: Date.UTC(2021, 1, 18, 20, 44, 0),
    siteLat: 18.44,
    siteLonEast: 77.45,
  },
];

function localSolNumber(utcMs: number, lonEastDeg: number): number {
  return Math.floor(marsTime(utcMs).msd + lonEastDeg / 360);
}

/** Номер сола миссии на момент utcMs (sol 0 — сол посадки). */
export function missionSol(clock: MissionClock, utcMs: number): number {
  return (
    localSolNumber(utcMs, clock.clockLonEastDeg) -
    localSolNumber(clock.landingUtcMs, clock.clockLonEastDeg)
  );
}

/** Миссия, в районе которой находится точка (в пределах radiusKm), или null. */
export function missionNear(latDeg: number, lonEastDeg: number, radiusKm = 150): MissionClock | null {
  for (const c of MISSION_CLOCKS) {
    if (greatCircleKm(latDeg, lonEastDeg, c.siteLat, c.siteLonEast) <= radiusKm) return c;
  }
  return null;
}

/** «14:32» из часов. */
export function formatHours(hours: number, withSeconds = false): string {
  const totalS = Math.floor(mod(hours, 24) * 3600 + 1e-6);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
}
