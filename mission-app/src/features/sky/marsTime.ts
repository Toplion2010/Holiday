// Марсианское время и положение Солнца по алгоритму Mars24 (Allison & McEwen): MSD ведёт все производные величины.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Длительность солнечных суток Марса в земных секундах. */
export const SOL_SECONDS = 88775.244;
/** Длительность сола в марсианских часах. */
export const SOL_HOURS = 24;
/** Солнечная постоянная на 1 а.е., Вт/м². */
export const SOLAR_CONSTANT_WM2 = 1361;

const PERTURBERS: [number, number, number][] = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

/** Поправка TT−UTC в секундах: 32.184 + накопленные високосные секунды (37 с на 2026 год). */
export const TT_MINUS_UTC_S = 69.184;

export function julianTtFromUnixMs(unixMs: number): number {
  return 2440587.5 + unixMs / 86400000 + TT_MINUS_UTC_S / 86400;
}

export function daysSinceJ2000(unixMs: number): number {
  return julianTtFromUnixMs(unixMs) - 2451545.0;
}

/** Марсианская сольная дата: единственные часы, от которых считается всё остальное. */
export function marsSolDate(unixMs: number): number {
  return (daysSinceJ2000(unixMs) - 4.5) / 1.027491252 + 44796.0 - 0.00096;
}

/** Обратный переход: момент UTC, которому соответствует заданная сольная дата. */
export function unixMsFromMarsSolDate(msd: number): number {
  const dtJ2000 = (msd - 44796.0 + 0.00096) * 1.027491252 + 4.5;
  return (dtJ2000 + 2451545.0 - 2440587.5) * 86400000 - TT_MINUS_UTC_S * 1000;
}

export interface SolarGeometry {
  /** Сольная дата — ведущие часы модели. */
  msd: number;
  /** Среднее солнечное время на нулевом меридиане, часы. */
  mtc: number;
  /** Местное среднее солнечное время, часы. */
  lmst: number;
  /** Местное истинное солнечное время, часы. */
  ltst: number;
  /** Ареоцентрическая долгота Солнца (сезон), градусы. */
  ls: number;
  /** Уравнение времени, градусы. */
  eotDeg: number;
  /** Склонение Солнца, градусы. */
  declinationDeg: number;
  /** Часовой угол, градусы. */
  hourAngleDeg: number;
  /** Высота Солнца над горизонтом, градусы. */
  elevationDeg: number;
  /** Азимут Солнца от севера к востоку, градусы. */
  azimuthDeg: number;
  /** Единичный вектор на Солнце в локальной системе: восток, север, зенит. */
  enu: [number, number, number];
  /** Расстояние до Солнца, а.е. */
  distanceAu: number;
  /** Поток на верхней границе атмосферы по нормали, Вт/м². */
  irradianceWm2: number;
  /** Угловой диаметр Солнца, градусы. */
  angularDiameterDeg: number;
}

function equationOfCenter(dtJ2000: number, meanAnomalyDeg: number): number {
  const m = meanAnomalyDeg * D2R;
  const pbs = PERTURBERS.reduce(
    (sum, [amp, tau, phase]) => sum + amp * Math.cos(((0.985626 * dtJ2000) / tau + phase) * D2R),
    0,
  );
  return (
    (10.691 + 3.0e-7 * dtJ2000) * Math.sin(m) +
    0.623 * Math.sin(2 * m) +
    0.05 * Math.sin(3 * m) +
    0.005 * Math.sin(4 * m) +
    0.0005 * Math.sin(5 * m) +
    pbs
  );
}

/** Полная солнечная геометрия для точки и момента; долгота восточная в градусах. */
export function solarGeometry(unixMs: number, latDeg: number, lonEastDeg: number): SolarGeometry {
  const dtJ2000 = daysSinceJ2000(unixMs);
  const meanAnomaly = 19.3871 + 0.52402073 * dtJ2000;
  const fictionMeanSun = 270.3871 + 0.524038496 * dtJ2000;
  const nuMinusM = equationOfCenter(dtJ2000, meanAnomaly);
  const ls = (((fictionMeanSun + nuMinusM) % 360) + 360) % 360;
  const eotDeg =
    2.861 * Math.sin(2 * ls * D2R) - 0.071 * Math.sin(4 * ls * D2R) + 0.002 * Math.sin(6 * ls * D2R) - nuMinusM;
  const msd = marsSolDate(unixMs);
  const mtc = (((24 * msd) % 24) + 24) % 24;
  const westLon = (((360 - lonEastDeg) % 360) + 360) % 360;
  const lmst = (((mtc - (westLon * 24) / 360) % 24) + 24) % 24;
  const ltst = (((lmst + (eotDeg * 24) / 360) % 24) + 24) % 24;
  const declinationDeg = Math.asin(0.42565 * Math.sin(ls * D2R)) * R2D + 0.25 * Math.sin(ls * D2R);
  const hourAngleDeg = 15 * (ltst - 12);

  const phi = latDeg * D2R;
  const dec = declinationDeg * D2R;
  const h = hourAngleDeg * D2R;
  const east = -Math.cos(dec) * Math.sin(h);
  const north = Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(h);
  const up = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(h);
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, up))) * R2D;
  const azimuthDeg = ((Math.atan2(east, north) * R2D) % 360 + 360) % 360;

  const m = meanAnomaly * D2R;
  const distanceAu =
    1.52367934 *
    (1.00436 - 0.09309 * Math.cos(m) - 0.004336 * Math.cos(2 * m) - 0.00031 * Math.cos(3 * m) - 0.00003 * Math.cos(4 * m));

  return {
    msd,
    mtc,
    lmst,
    ltst,
    ls,
    eotDeg,
    declinationDeg,
    hourAngleDeg,
    elevationDeg,
    azimuthDeg,
    enu: [east, north, up],
    distanceAu,
    irradianceWm2: SOLAR_CONSTANT_WM2 / (distanceAu * distanceAu),
    angularDiameterDeg: 2 * Math.atan(0.00465047 / distanceAu) * R2D,
  };
}

/** Номер сола миссии: целая часть сольной даты относительно посадки. */
export function missionSol(msd: number, landingMsd: number): number {
  return Math.floor(msd - landingMsd) + 1;
}

/** Часы сола как «часы:минуты:секунды» марсианского циферблата. */
export function formatSolClock(hours: number): string {
  const total = (((hours % 24) + 24) % 24) * 3600;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Сезон по ареоцентрической долготе Солнца для северного полушария. */
export function seasonLabel(ls: number): string {
  if (ls < 90) return 'северная весна';
  if (ls < 180) return 'северное лето';
  if (ls < 270) return 'северная осень';
  return 'северная зима';
}
