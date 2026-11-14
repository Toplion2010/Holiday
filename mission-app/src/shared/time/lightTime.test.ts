import { describe, expect, it } from 'vitest';

import { formatLightTime, interpolateLightTime, type LightTimeTable } from './lightTime';

const table: LightTimeTable = {
  source: 'JPL Horizons',
  generated_utc: '2026-11-01T00:00:00Z',
  step_hours: 24,
  entries: [
    { utc: '2026-11-15T00:00:00Z', distance_au: 1.3, light_time_s: 648.0 },
    { utc: '2026-11-14T00:00:00Z', distance_au: 1.2, light_time_s: 600.0 },
    { utc: '2026-11-16T00:00:00Z', distance_au: 1.4, light_time_s: 700.0 },
  ],
};

describe('время света Земля–Марс', () => {
  it('точно в узле таблицы', () => {
    expect(interpolateLightTime(table, Date.parse('2026-11-14T00:00:00Z'))?.oneWayS).toBe(600);
  });

  it('линейно между узлами (таблица может быть не отсортирована)', () => {
    const r = interpolateLightTime(table, Date.parse('2026-11-14T12:00:00Z'));
    expect(r?.oneWayS).toBeCloseTo(624, 6);
    expect(r?.distanceAu).toBeCloseTo(1.25, 6);
    expect(r?.source).toBe('JPL Horizons');
    expect(interpolateLightTime(table, Date.parse('2026-11-15T18:00:00Z'))?.oneWayS).toBeCloseTo(687, 6);
  });

  it('вне таблицы или без таблицы — null', () => {
    expect(interpolateLightTime(table, Date.parse('2026-11-13T23:59:00Z'))).toBeNull();
    expect(interpolateLightTime(table, Date.parse('2026-11-16T00:00:01Z'))).toBeNull();
    expect(interpolateLightTime(null, Date.now())).toBeNull();
    expect(interpolateLightTime({ ...table, entries: [] }, Date.parse('2026-11-14T00:00:00Z'))).toBeNull();
  });

  it('формат', () => {
    expect(formatLightTime(1120)).toBe('18 мин 40 с');
    expect(formatLightTime(185.4)).toBe('3 мин 05 с');
  });
});
