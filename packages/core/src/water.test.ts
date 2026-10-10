import { describe, expect, it } from 'vitest';
import { waterGuidanceMl } from './water.js';

describe('waterGuidanceMl', () => {
  it('uses a 35 ml/kg base', () => {
    const w = waterGuidanceMl({ weightKg: 70, activityLevel: 'sedentary' });
    expect(w.mlPerDay).toBe(2450);
    expect(w.glasses).toBe(10); // 2450 / 250 = 9.8 -> 10
  });

  it('adds 500 ml for active / very_active', () => {
    expect(
      waterGuidanceMl({ weightKg: 70, activityLevel: 'active' }).mlPerDay,
    ).toBe(2950);
    expect(
      waterGuidanceMl({ weightKg: 70, activityLevel: 'very_active' }).mlPerDay,
    ).toBe(2950);
    expect(
      waterGuidanceMl({ weightKg: 70, activityLevel: 'moderate' }).mlPerDay,
    ).toBe(2450);
  });

  it('adds 500 ml for hot climate', () => {
    const w = waterGuidanceMl({
      weightKg: 70,
      activityLevel: 'sedentary',
      hotClimate: true,
    });
    expect(w.mlPerDay).toBe(2950);
  });

  it('stacks activity and climate bonuses', () => {
    const w = waterGuidanceMl({
      weightKg: 80,
      activityLevel: 'very_active',
      hotClimate: true,
    });
    expect(w.mlPerDay).toBe(80 * 35 + 500 + 500);
    expect(w.note.length).toBeGreaterThan(0);
  });

  it('rejects non-positive weight', () => {
    expect(() =>
      waterGuidanceMl({ weightKg: 0, activityLevel: 'light' }),
    ).toThrow(RangeError);
  });
});
