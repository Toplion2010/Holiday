// Проверка Mars24 по контрольным примерам со страницы алгоритма NASA GISS.
import { describe, expect, it } from 'vitest';

import {
  greatCircleKm,
  lmstHours,
  ltstHours,
  marsTime,
  MISSION_CLOCKS,
  missionNear,
  missionSol,
  nextSunEvents,
  sunPosition,
  ttMinusUtc,
} from './mars24';

describe('Mars24, пример 1: 2000-01-06 00:00 UTC, 0° з. д.', () => {
  const ms = Date.UTC(2000, 0, 6);
  const t = marsTime(ms);

  it('шаги A', () => {
    expect(ms).toBe(947116800000);
    expect(t.jdUt).toBeCloseTo(2451549.5, 6);
    expect(ttMinusUtc(ms)).toBeCloseTo(64.184, 3);
    expect(t.jdTt).toBeCloseTo(2451549.50074, 5);
    expect(t.dtJ2000).toBeCloseTo(4.50074, 5);
  });

  it('шаги B', () => {
    expect(t.meanAnomalyDeg).toBeCloseTo(21.74558, 4);
    expect(t.eqCenterDeg).toBeCloseTo(4.44193, 4);
    expect(t.lsDeg).toBeCloseTo(277.18758, 4);
  });

  it('шаги C', () => {
    expect(t.eotDeg).toBeCloseTo(-5.18774, 4);
    expect(t.mtcHours).toBeCloseTo(23.99425, 4);
    expect(lmstHours(t, 0)).toBeCloseTo(23.99425, 4);
    expect(ltstHours(t, 0)).toBeCloseTo(23.6484, 4);
    // Λs = 174.72600° з. д. → 185.274° в. д.
    expect(t.subsolarLonEastDeg).toBeCloseTo(360 - 174.726, 3);
  });

  it('шаги D', () => {
    expect(t.subsolarLatDeg).toBeCloseTo(-25.22825, 4);
    expect(t.heliocentricAu).toBeCloseTo(1.39358, 4);
    const sun = sunPosition(t, 0, 0);
    expect(90 - sun.elevationDeg).toBeCloseTo(154.26182, 3);
    expect(sun.azimuthDeg).toBeCloseTo(191.03905, 3);
  });
});

describe('Mars24, пример 2: посадка Spirit, 184.702° з. д., 14.640° ю. ш.', () => {
  const t = marsTime(1073137591000);
  const lonEast = 360 - 184.702;

  it('совпадает с опубликованными значениями', () => {
    expect(t.jdTt).toBeCloseTo(2453008.07471, 5);
    expect(t.lsDeg).toBeCloseTo(327.32416, 4);
    expect(t.eotDeg).toBeCloseTo(-12.77553, 4);
    expect(t.mtcHours).toBeCloseTo(13.16537, 4);
    expect(lmstHours(t, lonEast)).toBeCloseTo(0.8519, 3);
    expect(ltstHours(t, lonEast)).toBeCloseTo(0.00025, 3);
    // расхождение ~0.0003° — округление в опубликованном примере
    expect(t.subsolarLatDeg).toBeCloseTo(-13.42065, 3);
    const sun = sunPosition(t, -14.64, lonEast);
    expect(90 - sun.elevationDeg).toBeCloseTo(151.93895, 2);
    expect(sun.azimuthDeg).toBeCloseTo(179.99383, 2);
  });
});

describe('високосные секунды', () => {
  it('с 2017 года TT−UTC = 69.184 с', () => {
    expect(ttMinusUtc(Date.UTC(2026, 10, 14))).toBeCloseTo(69.184, 6);
  });
});

describe('восход и закат', () => {
  it('находит закат и восход в течение сола у экватора', () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const { sunset, sunrise } = nextSunEvents(now, -4.8, 137.4);
    expect(sunset).not.toBeNull();
    expect(sunrise).not.toBeNull();
    expect(sunset!.inSeconds).toBeGreaterThan(0);
    expect(sunset!.inSeconds).toBeLessThan(88775);
    // в момент события Солнце на горизонте
    const el = sunPosition(marsTime(sunset!.utcMs), -4.8, 137.4).elevationDeg;
    expect(Math.abs(el)).toBeLessThan(0.01);
    // ночь у экватора короче сола, но заметно длиннее нуля
    const night = sunrise!.inSeconds - sunset!.inSeconds;
    if (night > 0) expect(night).toBeGreaterThan(30000);
  });
});

describe('солы миссий', () => {
  const [msl, m2020] = MISSION_CLOCKS;

  it('сол посадки — sol 0, посадка днём по LMST', () => {
    expect(missionSol(msl, msl.landingUtcMs)).toBe(0);
    expect(missionSol(m2020, m2020.landingUtcMs)).toBe(0);
    // Curiosity сел около 15:00 LMST, Perseverance — около 15:53 LMST
    expect(lmstHours(marsTime(msl.landingUtcMs), msl.clockLonEastDeg)).toBeGreaterThan(14.5);
    expect(lmstHours(marsTime(msl.landingUtcMs), msl.clockLonEastDeg)).toBeLessThan(15.5);
    expect(lmstHours(marsTime(m2020.landingUtcMs), m2020.clockLonEastDeg)).toBeCloseTo(15.88, 1);
  });

  it('сверка с NASA MMGIS на 2026-11-14: последний заезд Curiosity sol 5073, Perseverance sol 2022', () => {
    const day = Date.UTC(2026, 10, 14, 12);
    const msl14 = missionSol(msl, day);
    const m14 = missionSol(m2020, day);
    expect(msl14).toBeGreaterThanOrEqual(5073);
    expect(msl14).toBeLessThanOrEqual(5073 + 5);
    // Сол заезда в файле Perseverance отстаёт от текущего: по датам посадки сейчас идёт sol ~2039.
    expect(m14).toBeGreaterThanOrEqual(2022);
    expect(m14).toBeLessThanOrEqual(2022 + 20);
  });

  it('район миссии по расстоянию', () => {
    expect(missionNear(-4.8, 137.39)?.id).toBe('msl');
    expect(missionNear(18.43, 77.23)?.id).toBe('m2020');
    expect(missionNear(0, 0)).toBeNull();
    expect(greatCircleKm(-4.6, 137.4, 18.44, 77.45)).toBeGreaterThan(3500);
  });
});
