// Проверка вёрстки HUD на поддельном состоянии прогулки (без браузера).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { WalkState } from '@/app/modeContract';

import { angleDelta } from './Compass';
import { HudView } from './Hud';

const gale: WalkState = {
  siteId: 'gale-boxwork',
  siteTitle: 'Гейл, boxwork',
  lat: -4.826,
  lonEast: 137.3889,
  heightM: -3472,
  headingDeg: 205,
  slopeHereDeg: 6,
  slopeAheadDeg: 18,
  walkedM: 120,
  baseDistanceM: 680,
  baseBearingDeg: 30,
  nearestTrackPoint: { sol: 5073, distanceM: 40, mission: 'Curiosity' },
  dataLevel: 'HiRISE DTM 1 м',
  simTimeMs: Date.UTC(2026, 10, 14, 5, 21),
  timeScale: 60,
  evaSeconds: 3600,
  maxSlopeDeg: 20,
};

const rad = {
  rateMicroGyH: 11.4,
  sol: 3290,
  startUtc: '2021-11-07T00:43:09Z',
  endUtc: '2021-11-08T00:00:00Z',
  observations: 80,
  sourceFile: 'rad.xlsx',
  limitations: [],
};

describe('HUD', () => {
  it('полный уровень в Гейле: архив RAD, сол Curiosity, ускорение', () => {
    const html = renderToStaticMarkup(<HudView state={gale} ext={{ rad, lightTable: null, spaceWeather: null }} level="full" />);
    expect(html).toContain('4.8260°S 137.3889°E');
    expect(html).toContain('LMST');
    expect(html).toContain('Curiosity');
    expect(html).toMatch(/sol 50[7-9]\d/);
    expect(html).toContain('×60');
    expect(html).toContain('архив 2021-11-07');
    expect(html).toContain('11,4 мкГр/ч');
    expect(html).toContain('2026-11-14 05:21:00');
    // таблицы света нет → «нет данных», без выдуманного числа
    expect(html).toMatch(/Связь с Землёй.*нет данных/);
    expect(html).toContain('hud-tone--warn');
    expect(html).toContain('Б 680 м');
  });

  it('вне Гейла: местных измерений нет и расстояние до Гейла', () => {
    const jezero = { ...gale, lat: 18.44, lonEast: 77.45, nearestTrackPoint: undefined };
    const html = renderToStaticMarkup(<HudView state={jezero} ext={{ rad, spaceWeather: null }} level="full" />);
    expect(html).toMatch(/местных измерений нет; ближайшие: RAD, кратер Гейл, 3\d{3} км/);
    expect(html).toContain('Perseverance');
    expect(html).not.toContain('мкГр/ч');
  });

  it('событие DONKI с оговоркой про Землю', () => {
    const sw = {
      source: 'NASA DONKI',
      fetched_utc: '2026-11-14T00:00:00Z',
      note: '',
      events: [{ type: 'CME', start_utc: '2026-11-12T08:00:00Z', summary: 'CME', link: '' }],
    };
    const html = renderToStaticMarkup(<HudView state={gale} ext={{ spaceWeather: sw }} level="full" />);
    expect(html).toContain('выброс массы 2026-11-12 08:00 UTC');
    expect(html).toContain('прихода к Марсу оценочное');
  });

  it('минимум и скрыт', () => {
    const min = renderToStaticMarkup(<HudView state={gale} ext={{}} level="min" />);
    expect(min).toContain('LMST');
    expect(min).toContain('Уклон');
    expect(min).not.toContain('Доза за выход');
    const hidden = renderToStaticMarkup(<HudView state={gale} ext={{}} level="hidden" />);
    expect(hidden).not.toContain('LMST');
    expect(hidden).toContain('скрыт');
  });

  it('точка невозврата', () => {
    const late = { ...gale, evaSeconds: 7.5 * 3600, baseDistanceM: 2000 };
    const html = renderToStaticMarkup(<HudView state={late} ext={{}} level="full" />);
    expect(html).toContain('Точка невозврата');
  });

  it('разность углов компаса', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(angleDelta(0, 180)).toBe(180);
  });
});
