// Проверка астрономии по трём независимо рассчитанным опорным точкам участков и по положению Галактики.

import { describe, expect, it } from 'vitest';

import { daysSinceJ2000, marsSolDate, solarGeometry, unixMsFromMarsSolDate, formatSolClock } from './marsTime';
import { GALACTIC_CENTRE, GALACTIC_NORTH_POLE, icrfToLocalEnu, radecToAltAz, transpose, applyMat3, radecToVector } from './marsSky';

const REFERENCE = [
  { name: 'gale_day', utc: '2026-11-14T12:18:28Z', lat: -5.4, lon: 137.8, elevation: 56.766, azimuth: 64.2665, ltst: 10.0, au: 1.6083454, toa: 526.1378 },
  { name: 'gale_night', utc: '2026-11-14T03:03:46Z', lat: -5.4, lon: 137.8, elevation: -74.6857, azimuth: 75.4234, ltst: 1.0, au: 1.6079629, toa: 526.3881 },
  { name: 'jezero_day', utc: '2026-11-13T19:53:34Z', lat: 18.4, lon: 77.5, elevation: 59.4208, azimuth: 256.1229, ltst: 14.0, au: 1.6076656, toa: 526.5828 },
];

describe('марсианское время и Солнце', () => {
  for (const r of REFERENCE) {
    it(`${r.name}: сходится с независимым расчётом`, () => {
      const g = solarGeometry(Date.parse(r.utc), r.lat, r.lon);
      expect(g.elevationDeg).toBeCloseTo(r.elevation, 0);
      expect(Math.abs(g.elevationDeg - r.elevation)).toBeLessThan(0.1);
      expect(Math.abs(g.azimuthDeg - r.azimuth)).toBeLessThan(0.5);
      expect(Math.abs(g.ltst - r.ltst)).toBeLessThan(0.01);
      expect(Math.abs(g.distanceAu - r.au)).toBeLessThan(0.001);
      expect(Math.abs(g.irradianceWm2 - r.toa)).toBeLessThan(1);
    });
  }

  it('вектор на Солнце согласован с высотой и азимутом', () => {
    const g = solarGeometry(Date.parse('2026-11-14T12:18:28Z'), -5.4, 137.8);
    const [e, n, u] = g.enu;
    expect(Math.hypot(e, n, u)).toBeCloseTo(1, 6);
    expect(u).toBeCloseTo(Math.sin((g.elevationDeg * Math.PI) / 180), 6);
    expect(e).toBeCloseTo(0.4937, 3);
    expect(n).toBeCloseTo(0.238, 2);
  });

  it('ночью Солнце под горизонтом, днём над ним', () => {
    expect(solarGeometry(Date.parse('2026-11-14T03:03:46Z'), -5.4, 137.8).elevationDeg).toBeLessThan(0);
    expect(solarGeometry(Date.parse('2026-11-14T12:18:28Z'), -5.4, 137.8).elevationDeg).toBeGreaterThan(0);
  });

  it('сольная дата обратима', () => {
    const ms = Date.parse('2026-11-14T12:18:28Z');
    const msd = marsSolDate(ms);
    expect(unixMsFromMarsSolDate(msd)).toBeCloseTo(ms, 0);
  });

  it('сдвиг сольной даты на половину сола переводит полдень в полночь', () => {
    const ms = Date.parse('2026-11-14T12:18:28Z');
    const noon = solarGeometry(ms, -5.4, 137.8);
    const midnight = solarGeometry(unixMsFromMarsSolDate(marsSolDate(ms) + 0.5), -5.4, 137.8);
    const shift = (((midnight.ltst - noon.ltst) % 24) + 24) % 24;
    expect(Math.abs(shift - 12)).toBeLessThan(0.02);
  });

  it('часы сола форматируются', () => {
    expect(formatSolClock(10)).toBe('10:00:00');
    expect(formatSolClock(0.5)).toBe('00:30:00');
  });
});

describe('ориентация звёздного неба', () => {
  it('полюс Галактики над Гейлом совпадает с ориентацией исходной панорамы', () => {
    const ms = Date.parse('2026-11-14T03:03:46Z');
    const m = icrfToLocalEnu(daysSinceJ2000(ms), -5.4, 137.8);
    const pole = radecToAltAz(GALACTIC_NORTH_POLE.raDeg, GALACTIC_NORTH_POLE.decDeg, m);
    expect(Math.abs(pole.altitudeDeg - 30.33)).toBeLessThan(1.5);
    expect(Math.abs(pole.azimuthDeg - 83.01)).toBeLessThan(1.5);
  });

  it('центр Галактики той ночью под горизонтом Гейла', () => {
    const ms = Date.parse('2026-11-14T03:03:46Z');
    const m = icrfToLocalEnu(daysSinceJ2000(ms), -5.4, 137.8);
    expect(radecToAltAz(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg, m).altitudeDeg).toBeLessThan(0);
  });

  it('матрица ортонормирована и обратима транспонированием', () => {
    const m = icrfToLocalEnu(9999.5, 18.4, 77.5);
    const v = radecToVector(123.4, -45.6);
    const back = applyMat3(transpose(m), applyMat3(m, v));
    expect(back[0]).toBeCloseTo(v[0], 10);
    expect(back[1]).toBeCloseTo(v[1], 10);
    expect(back[2]).toBeCloseTo(v[2], 10);
  });

  it('за половину сола небо поворачивается примерно на 180 градусов', () => {
    const ms = Date.parse('2026-11-14T03:03:46Z');
    const a = icrfToLocalEnu(daysSinceJ2000(ms), 0, 0);
    const b = icrfToLocalEnu(daysSinceJ2000(ms + 88775244 / 2), 0, 0);
    const star = radecToVector(45, 0);
    const [ea] = applyMat3(a, star);
    const [eb] = applyMat3(b, star);
    expect(Math.abs(ea + eb)).toBeLessThan(0.25);
  });
});
