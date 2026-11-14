// Страж моделей скафандра: все реализации скорости обязаны давать одно число, уклон знаковый.

import { describe, expect, it } from 'vitest';

import { walkSpeed as motionSpeed } from '@/features/walk/motion';

import { SPEED_MODEL_MAX_SLOPE_DEG, walkSpeed as suitSpeed } from './suit';
import { walkSpeed as traverseSpeed } from './traverse';

describe('две модели скорости в скафандре', () => {
  it('на ровном месте дают 0.75 м/с', () => {
    expect(suitSpeed(0)).toBeCloseTo(0.75, 9);
    expect(traverseSpeed(0).speedMs).toBeCloseTo(0.75, 9);
  });

  it('на подъёме и на спуске совпадают', () => {
    for (const slope of [-20, -15, -10, -5, 1, 5, 10, 15, 20]) {
      expect(suitSpeed(slope)).toBeCloseTo(traverseSpeed(slope).speedMs, 9);
      expect(motionSpeed(slope)).toBeCloseTo(traverseSpeed(slope).speedMs, 9);
    }
  });

  it('за пределом ±20° обе отмечают выход за область определения', () => {
    expect(suitSpeed(SPEED_MODEL_MAX_SLOPE_DEG + 1)).toBeNull();
    expect(traverseSpeed(SPEED_MODEL_MAX_SLOPE_DEG + 1).status).toBe('outside_model_domain');
  });

  it('под гору быстрее, чем в гору', () => {
    expect(traverseSpeed(-10).speedMs).toBeCloseTo(0.85, 9);
    expect(traverseSpeed(10).speedMs).toBeCloseTo(0.65, 9);
    expect(suitSpeed(-10)).toBeCloseTo(0.85, 9);
  });

  it('в сцене прогулки спуск не быстрее края области определения модели', () => {
    expect(motionSpeed(-80)).toBeCloseTo(0.95, 9);
    expect(motionSpeed(80)).toBeCloseTo(0.1, 9);
  });
});
