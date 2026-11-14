// Страж против расхождения двух моделей марсианского времени: HUD и небо обязаны показывать одно и то же.

import { describe, expect, it } from 'vitest';

import { solarGeometry } from '@/features/sky/marsTime';

import { ltstHours, marsTime, sunPosition } from './mars24';

const CASES = [
  { name: 'Гейл, день', utc: '2026-11-14T12:18:28Z', lat: -5.4, lon: 137.8 },
  { name: 'Гейл, ночь', utc: '2026-11-14T03:03:46Z', lat: -5.4, lon: 137.8 },
  { name: 'Езеро, день', utc: '2026-11-13T19:53:34Z', lat: 18.4, lon: 77.5 },
  { name: 'полюс, лето', utc: '2027-03-02T06:00:00Z', lat: 72.0, lon: 10.0 },
];

describe('две реализации марсианского времени согласованы', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const ms = Date.parse(c.utc);
      const mine = solarGeometry(ms, c.lat, c.lon);
      const t = marsTime(ms);
      const theirs = sunPosition(t, c.lat, c.lon);

      expect(Math.abs(mine.msd - t.msd)).toBeLessThan(1e-6);
      expect(Math.abs(mine.ls - t.lsDeg)).toBeLessThan(0.05);
      expect(Math.abs(mine.declinationDeg - t.subsolarLatDeg)).toBeLessThan(0.3);
      expect(Math.abs(mine.distanceAu - t.heliocentricAu)).toBeLessThan(0.002);
      expect(Math.abs(mine.elevationDeg - theirs.elevationDeg)).toBeLessThan(0.5);

      const ltstDiff = Math.abs(((mine.ltst - ltstHours(t, c.lon)) % 24) + 24) % 24;
      expect(Math.min(ltstDiff, 24 - ltstDiff)).toBeLessThan(0.02);

      const azDiff = Math.abs(((mine.azimuthDeg - theirs.azimuthDeg) % 360) + 360) % 360;
      expect(Math.min(azDiff, 360 - azDiff)).toBeLessThan(1.0);
    });
  }
});
