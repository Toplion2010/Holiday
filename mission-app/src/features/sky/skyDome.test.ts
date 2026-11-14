// Проверка чистых функций неба: подбор момента по LTST, фаза дня, перевод осей сцены и ENU, ориентация Млечного Пути.

import { describe, expect, it } from 'vitest';
import { daysSinceJ2000, solarGeometry } from './marsTime';
import { GALACTIC_CENTRE, applyMat3, icrfToLocalEnu, radecToAltAz, radecToVector, transpose } from './marsSky';
import { dayPhase, daylightWeight, enuToScene, sceneToEnu, starWeight, unixMsForLtst, unixMsForSunCrossing } from './skyMath';

const LAT = -5.4;
const LON = 137.8;
const NOW = Date.parse('2026-11-14T12:00:00Z');

describe('подбор момента по LTST', () => {
  for (const hours of [0, 3.5, 6, 12, 17.25, 23.9]) {
    it(`LTST ${hours} ч`, () => {
      const t = unixMsForLtst(NOW, LAT, LON, hours);
      const got = solarGeometry(t, LAT, LON).ltst;
      const diff = ((((got - hours + 12) % 24) + 24) % 24) - 12;
      expect(Math.abs(diff)).toBeLessThan(0.01);
      expect(Math.abs(t - NOW)).toBeLessThan(13 * 3600 * 1000);
    });
  }

  it('восход и закат дают высоту Солнца около 0°', () => {
    for (const rising of [true, false]) {
      const t = unixMsForSunCrossing(NOW, LAT, LON, rising);
      expect(Math.abs(solarGeometry(t, LAT, LON).elevationDeg)).toBeLessThan(0.01);
    }
    const rise = solarGeometry(unixMsForSunCrossing(NOW, LAT, LON, true), LAT, LON).ltst;
    const set = solarGeometry(unixMsForSunCrossing(NOW, LAT, LON, false), LAT, LON).ltst;
    expect(rise).toBeLessThan(7);
    expect(set).toBeGreaterThan(17);
  });
});

describe('фаза дня', () => {
  it('классифицирует по высоте Солнца', () => {
    expect(dayPhase(40)).toBe('day');
    expect(dayPhase(5.1)).toBe('day');
    expect(dayPhase(0)).toBe('twilight');
    expect(dayPhase(-17.9)).toBe('twilight');
    expect(dayPhase(-18.1)).toBe('night');
  });

  it('веса неба монотонны и ограничены', () => {
    expect(daylightWeight(5)).toBe(1);
    expect(daylightWeight(-18)).toBe(0);
    expect(starWeight(-18)).toBe(1);
    expect(starWeight(10)).toBe(0);
    expect(daylightWeight(-6)).toBeGreaterThan(daylightWeight(-12));
  });
});

describe('оси сцены и ENU', () => {
  it('юг сцены — это минус север, взаимно обратны', () => {
    expect(sceneToEnu([0, 0, 1])).toEqual([0, -1, 0]);
    expect(sceneToEnu([0, 1, 0])).toEqual([0, 0, 1]);
    const v: [number, number, number] = [0.3, 0.5, -0.8];
    const back = enuToScene(sceneToEnu(v));
    back.forEach((x, i) => expect(x).toBeCloseTo(v[i], 12));
  });
});

describe('ориентация Млечного Пути', () => {
  it('направление на Солнце в ICRF и обратно совпадает с высотой по солнечной геометрии', () => {
    const g = solarGeometry(NOW, LAT, LON);
    const m = icrfToLocalEnu(daysSinceJ2000(NOW), LAT, LON);
    const icrf = applyMat3(transpose(m), g.enu);
    const ra = ((Math.atan2(icrf[1], icrf[0]) * 180) / Math.PI + 360) % 360;
    const dec = (Math.asin(icrf[2]) * 180) / Math.PI;
    const back = radecToAltAz(ra, dec, m);
    expect(back.altitudeDeg).toBeCloseTo(g.elevationDeg, 6);
    const v = radecToVector(ra, dec);
    v.forEach((x, i) => expect(x).toBeCloseTo(icrf[i], 9));
  });

  it('шейдерный путь: вектор сцены → ENU → ICRF → (u, v) текстуры даёт центр Галактики в её пикселе', () => {
    const m = icrfToLocalEnu(daysSinceJ2000(NOW), LAT, LON);
    const alt = radecToAltAz(GALACTIC_CENTRE.raDeg, GALACTIC_CENTRE.decDeg, m);
    const az = (alt.azimuthDeg * Math.PI) / 180;
    const el = (alt.altitudeDeg * Math.PI) / 180;
    const enu: [number, number, number] = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
    const scene = enuToScene(enu);
    const icrf = applyMat3(transpose(m), sceneToEnu(scene));
    const u = (((Math.atan2(icrf[1], icrf[0]) / (2 * Math.PI)) % 1) + 1) % 1;
    const v = 0.5 - Math.asin(icrf[2]) / Math.PI;
    expect(u * 360).toBeCloseTo(GALACTIC_CENTRE.raDeg, 6);
    expect(v).toBeCloseTo(0.5 - GALACTIC_CENTRE.decDeg / 180, 6);
  });
});
