import { describe, expect, it } from 'vitest';

import { distanceToGaleKm, evaDose, parseRad } from './radiation';
import { latestRelevantEvent } from './spaceWeather';
import {
  darknessRisk,
  DEFAULT_EVA_BUDGET,
  evaBudget,
  formatDistance,
  formatDuration,
  returnTimeS,
  slopeLevel,
  walkSpeed,
} from './suit';

describe('скорость в скафандре', () => {
  it('V = −0.01·θ + 0.75', () => {
    expect(walkSpeed(0)).toBeCloseTo(0.75, 9);
    expect(walkSpeed(10)).toBeCloseTo(0.65, 9);
    expect(walkSpeed(-10)).toBeCloseTo(0.85, 9);
    expect(walkSpeed(20)).toBeCloseTo(0.55, 9);
    expect(walkSpeed(25)).toBeNull();
  });

  it('возврат по прямой по ровному', () => {
    expect(returnTimeS(750)).toBeCloseTo(1000, 6);
    expect(returnTimeS(-5)).toBe(0);
  });
});

describe('расходники и точка невозврата', () => {
  it('в начале выхода запас большой', () => {
    const b = evaBudget(0, 0);
    expect(b.leftS).toBe(8 * 3600);
    expect(b.pastNoReturn).toBe(false);
    expect(b.extraOutM).toBeCloseTo(((8 * 3600 - 1800) * 0.75) / 2, 6);
  });

  it('точка невозврата: остаток < возврат + резерв', () => {
    // осталось 1 ч, до базы 1500 м → возврат 2000 с + резерв 1800 с = 3800 с > 3600 с
    const b = evaBudget(7 * 3600, 1500);
    expect(b.backS).toBeCloseTo(2000, 6);
    expect(b.pastNoReturn).toBe(true);
    expect(b.extraOutM).toBe(0);
    expect(evaBudget(7 * 3600, 1000).pastNoReturn).toBe(false);
  });

  it('длительность выхода — параметр', () => {
    const b = evaBudget(3600, 0, { ...DEFAULT_EVA_BUDGET, designS: 4 * 3600 });
    expect(b.leftS).toBe(3 * 3600);
  });

  it('темнота', () => {
    expect(darknessRisk(600, 1000)).toBe(true);
    expect(darknessRisk(5000, 1000)).toBe(false);
    expect(darknessRisk(null, 1000)).toBe(false);
  });

  it('цвет уклона', () => {
    expect(slopeLevel(6, 20)).toBe('ok');
    expect(slopeLevel(18, 20)).toBe('warn');
    expect(slopeLevel(-25, 20)).toBe('danger');
    expect(slopeLevel(14, 12)).toBe('danger');
    expect(slopeLevel(11, 12)).toBe('ok');
  });

  it('формат', () => {
    expect(formatDuration(3900)).toBe('1 ч 05 мин');
    expect(formatDuration(720)).toBe('12 мин');
    expect(formatDuration(40)).toBe('40 с');
    expect(formatDistance(680)).toBe('680 м');
    expect(formatDistance(1234)).toBe('1,2 км');
  });
});

describe('радиация', () => {
  it('доза за выход = мощность × время', () => {
    const d = evaDose(86400 / 4);
    expect(d.typicalMSv).toBeCloseTo(0.16, 9);
    expect(d.lowMSv).toBeCloseTo(0.13, 9);
    expect(d.highMSv).toBeCloseTo(0.19, 9);
    expect(d.cycleMinMSv).toBeCloseTo(0.0625, 9);
    expect(d.cycleMaxMSv).toBeCloseTo(0.2375, 9);
  });

  it('расстояние до Гейла: Езеро ≈ 3,7 тыс. км, boxwork в Гейле < 50 км', () => {
    expect(distanceToGaleKm(-4.83, 137.39)).toBeLessThan(50);
    const jezero = distanceToGaleKm(18.44, 77.45);
    expect(jezero).toBeGreaterThan(3600);
    expect(jezero).toBeLessThan(3900);
  });

  it('разбор ответа RAD', () => {
    const r = parseRad({
      dataset: { source_file: 'rad.xlsx', limitations: ['архив'] },
      analysis: {
        status: 'observations_available',
        start_utc: '2021-11-07T00:43:09Z',
        end_utc: '2021-11-08T00:00:00Z',
        selected_observations: 80,
        b: { weighted_mean_rate_microgy_h: 11.4 },
        observations: [{ sol: 3290 }],
      },
    });
    expect(r?.rateMicroGyH).toBe(11.4);
    expect(r?.sol).toBe(3290);
    expect(parseRad(null)).toBeNull();
    expect(parseRad({ analysis: { status: 'no_observations' } })).toBeNull();
  });
});

describe('космическая погода', () => {
  it('берёт самое свежее событие', () => {
    const ev = latestRelevantEvent({
      source: 'NASA DONKI',
      fetched_utc: '',
      note: '',
      events: [
        { type: 'FLR', start_utc: '2026-11-10T12:00:00Z', summary: 'M1', link: '' },
        { type: 'CME', start_utc: '2026-11-12T08:00:00Z', summary: 'CME', link: '' },
        { type: 'XXX', start_utc: '2026-11-13T08:00:00Z', summary: '?', link: '' },
      ],
    });
    expect(ev?.type).toBe('CME');
    expect(latestRelevantEvent(null)).toBeNull();
  });
});
