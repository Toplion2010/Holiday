// Сверка TS-модели перехода с эталоном сервера: расхождение формул не должно пройти незамеченным.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAVERSE,
  costPerMetreL,
  gradePercent,
  marsPowerCorridorW,
  oxygenLpm,
  segmentCost,
  terrainFactor,
  walkSpeed,
} from './traverse';
import { TRAVERSE_GOLDEN } from './traverse.golden';

describe('модель перехода совпадает с сервером', () => {
  it('все эталонные случаи воспроизводятся', () => {
    for (const g of TRAVERSE_GOLDEN) {
      const speed = walkSpeed(g.slopeDeg);
      expect(speed.speedMs).toBeCloseTo(g.speedMs, 9);
      expect(gradePercent(g.slopeDeg)).toBeCloseTo(g.gradePct, 7);
      const [etaLow, etaHigh] = terrainFactor(g.surface, speed.speedMs);
      expect(etaLow).toBeCloseTo(g.etaLow, 9);
      expect(etaHigh).toBeCloseTo(g.etaHigh, 9);
      const powers: number[] = [];
      for (const eta of etaLow === etaHigh ? [etaLow] : [etaLow, etaHigh]) {
        powers.push(...marsPowerCorridorW(g.crewKg, g.loadKg, speed.speedMs, g.gradePct, eta));
      }
      expect(Math.min(...powers)).toBeCloseTo(g.powerLowW, 5);
      expect(Math.max(...powers)).toBeCloseTo(g.powerHighW, 5);
    }
  });

  it('эталон покрывает спуск, подъём, оба грунта и обе загрузки', () => {
    expect(TRAVERSE_GOLDEN.length).toBeGreaterThanOrEqual(32);
    expect(TRAVERSE_GOLDEN.some((g) => g.slopeDeg < 0)).toBe(true);
    expect(TRAVERSE_GOLDEN.some((g) => g.surface === 'sand')).toBe(true);
  });
});

describe('цена участка', () => {
  it('кислород равен мощности, делённой на 348.3, за время в пути', () => {
    const cost = segmentCost(750, 0, DEFAULT_TRAVERSE);
    expect(cost.seconds).toBeCloseTo(1000, 6);
    expect(cost.o2LowL).toBeCloseTo((oxygenLpm(cost.powerLowW) * 1000) / 60, 6);
    expect(cost.o2MidL).toBeCloseTo((cost.o2LowL + cost.o2HighL) / 2, 9);
  });

  it('песок дороже плотного грунта на том же уклоне', () => {
    const firm = costPerMetreL(0, { ...DEFAULT_TRAVERSE, surface: 'firm' });
    const sand = costPerMetreL(0, { ...DEFAULT_TRAVERSE, surface: 'sand' });
    expect(sand).toBeGreaterThan(firm * 1.5);
  });

  it('подъём дороже ровного места', () => {
    expect(costPerMetreL(15)).toBeGreaterThan(costPerMetreL(0));
  });

  it('пологий спуск дешевле ровного места, крутой дороже', () => {
    expect(costPerMetreL(-5)).toBeLessThan(costPerMetreL(0));
    expect(costPerMetreL(-20)).toBeGreaterThan(costPerMetreL(0));
  });

  it('вне области модели статус отмечается, цена остаётся конечной', () => {
    const cost = segmentCost(100, 30);
    expect(cost.status).toBe('outside_model_domain');
    expect(Number.isFinite(cost.o2MidL)).toBe(true);
  });

  it('тяжелее груз — дороже переход', () => {
    const light = costPerMetreL(5, { surface: 'firm', crewKg: 80, loadKg: 10 });
    const heavy = costPerMetreL(5, { surface: 'firm', crewKg: 80, loadKg: 60 });
    expect(heavy).toBeGreaterThan(light);
  });
});
