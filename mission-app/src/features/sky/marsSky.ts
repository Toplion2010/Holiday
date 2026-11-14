// Ориентация звёздного неба над точкой Марса: модель вращения IAU переводит небесные координаты в локальные.

const D2R = Math.PI / 180;

/** Матрица 3×3 по строкам. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Полюс и нулевой меридиан Марса, IAU/IAG Working Group on Cartographic Coordinates. */
export const MARS_POLE_RA_DEG = 317.68143;
export const MARS_POLE_RA_RATE = -0.1061;
export const MARS_POLE_DEC_DEG = 52.8865;
export const MARS_POLE_DEC_RATE = -0.0609;
export const MARS_PRIME_MERIDIAN_DEG = 176.63;
export const MARS_ROTATION_DEG_PER_DAY = 350.89198226;

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as number[];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out as Mat3;
}

function rotZ(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

function rotX(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/** Матрица перехода от небесных координат ICRF к системе, связанной с телом Марса. */
export function icrfToBodyFixed(daysSinceJ2000: number): Mat3 {
  const centuries = daysSinceJ2000 / 36525;
  const ra = (MARS_POLE_RA_DEG + MARS_POLE_RA_RATE * centuries) * D2R;
  const dec = (MARS_POLE_DEC_DEG + MARS_POLE_DEC_RATE * centuries) * D2R;
  const prime = (((MARS_PRIME_MERIDIAN_DEG + MARS_ROTATION_DEG_PER_DAY * daysSinceJ2000) % 360) + 360) % 360 * D2R;
  return multiply(multiply(rotZ(prime), rotX(Math.PI / 2 - dec)), rotZ(Math.PI / 2 + ra));
}

/** Матрица ICRF → локальные оси точки: строки дают восток, север и зенит. */
export function icrfToLocalEnu(daysSinceJ2000: number, latDeg: number, lonEastDeg: number): Mat3 {
  const body = icrfToBodyFixed(daysSinceJ2000);
  const phi = latDeg * D2R;
  const lam = lonEastDeg * D2R;
  const east: [number, number, number] = [-Math.sin(lam), Math.cos(lam), 0];
  const north: [number, number, number] = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
  const up: [number, number, number] = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const rows = [east, north, up];
  const out = new Array(9).fill(0) as number[];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = rows[r][0] * body[c] + rows[r][1] * body[3 + c] + rows[r][2] * body[6 + c];
    }
  }
  return out as Mat3;
}

/** Обратная матрица: из локальных осей в ICRF. Для ортонормированной матрицы это транспонирование. */
export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function applyMat3(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Единичный вектор по прямому восхождению и склонению, градусы. */
export function radecToVector(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * D2R;
  const dec = decDeg * D2R;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

export interface AltAz {
  altitudeDeg: number;
  azimuthDeg: number;
}

/** Высота и азимут светила над точкой Марса. */
export function radecToAltAz(raDeg: number, decDeg: number, icrfToEnu: Mat3): AltAz {
  const [east, north, up] = applyMat3(icrfToEnu, radecToVector(raDeg, decDeg));
  return {
    altitudeDeg: (Math.asin(Math.max(-1, Math.min(1, up))) * 180) / Math.PI,
    azimuthDeg: (((Math.atan2(east, north) * 180) / Math.PI) % 360 + 360) % 360,
  };
}

/** Полюс Галактики и её центр в экваториальных координатах J2000 — опорные точки для проверок. */
export const GALACTIC_NORTH_POLE = { raDeg: 192.8595, decDeg: 27.1284 };
export const GALACTIC_CENTRE = { raDeg: 266.405, decDeg: -28.936 };
