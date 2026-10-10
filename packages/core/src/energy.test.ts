import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FACTORS,
  calculateCalorieTarget,
  mifflinStJeor,
} from './energy.js';
import type { SafetyFlags } from './types.js';

describe('ACTIVITY_FACTORS', () => {
  it('matches the contract values', () => {
    expect(ACTIVITY_FACTORS).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    });
  });

  it('computes TDEE factor math', () => {
    const bmr = mifflinStJeor({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 });
    expect(bmr * ACTIVITY_FACTORS.moderate).toBeCloseTo(1780 * 1.55, 6);
  });
});

describe('mifflinStJeor', () => {
  it('matches the known value: male, 30y, 80kg, 180cm ≈ 1780', () => {
    // 10*80 + 6.25*180 − 5*30 + 5 = 1780
    expect(
      mifflinStJeor({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 }),
    ).toBe(1780);
  });

  it('uses −161 for female', () => {
    // 10*80 + 6.25*180 − 5*30 − 161 = 1614
    expect(
      mifflinStJeor({ sex: 'female', weightKg: 80, heightCm: 180, ageYears: 30 }),
    ).toBe(1614);
  });

  it('averages the two formulas for other / prefer_not_to_say', () => {
    const other = mifflinStJeor({ sex: 'other', weightKg: 80, heightCm: 180, ageYears: 30 });
    const pns = mifflinStJeor({
      sex: 'prefer_not_to_say',
      weightKg: 80,
      heightCm: 180,
      ageYears: 30,
    });
    expect(other).toBe((1780 + 1614) / 2);
    expect(pns).toBe((1780 + 1614) / 2);
  });
});

describe('calculateCalorieTarget', () => {
  it('caps the deficit at 20% of TDEE', () => {
    // tdee 2000: min(400, 550, 750) = 400
    const r = calculateCalorieTarget({
      tdee: 2000,
      goal: 'lose',
      sex: 'male',
      flags: {},
    });
    expect(r.deficitKcal).toBe(400);
    expect(r.targetKcal).toBe(1600);
    expect(r.weightLossDisabled).toBe(false);
    expect(r.assumptions.length).toBeGreaterThan(0);
  });

  it('uses the rate-based deficit when it is the binding constraint', () => {
    // tdee 3000: min(600, 550, 750) = 550 (default 0.5 kg/week)
    const r = calculateCalorieTarget({
      tdee: 3000,
      goal: 'lose',
      sex: 'male',
      flags: {},
    });
    expect(r.deficitKcal).toBe(550);
    expect(r.targetKcal).toBe(2450);
  });

  it('caps the deficit at 750 kcal/day', () => {
    // tdee 5000, rate 1.0: min(1000, 1100, 750) = 750
    const r = calculateCalorieTarget({
      tdee: 5000,
      goal: 'lose',
      sex: 'male',
      flags: {},
      targetRateKgPerWeek: 1.0,
    });
    expect(r.deficitKcal).toBe(750);
    expect(r.targetKcal).toBe(4250);
  });

  it('applies the 1500 kcal floor for males', () => {
    // tdee 1600: deficit 320 -> 1280 < 1500 -> floor
    const r = calculateCalorieTarget({
      tdee: 1600,
      goal: 'lose',
      sex: 'male',
      flags: {},
    });
    expect(r.targetKcal).toBe(1500);
    expect(r.deficitKcal).toBe(100);
    expect(r.warnings.some((w) => w.includes('1500'))).toBe(true);
  });

  it('applies the 1200 kcal floor for females', () => {
    // tdee 1300: deficit 260 -> 1040 < 1200 -> floor
    const r = calculateCalorieTarget({
      tdee: 1300,
      goal: 'lose',
      sex: 'female',
      flags: {},
    });
    expect(r.targetKcal).toBe(1200);
    expect(r.warnings.some((w) => w.includes('1200'))).toBe(true);
  });

  it('accepts a user override below the floor, with a warning', () => {
    const r = calculateCalorieTarget({
      tdee: 1600,
      goal: 'lose',
      sex: 'male',
      flags: {},
      userOverrideKcal: 1100,
    });
    expect(r.targetKcal).toBe(1100);
    expect(r.warnings.some((w) => /below the safe minimum/i.test(w))).toBe(true);
  });

  it('accepts a user override above the floor, with a warning', () => {
    const r = calculateCalorieTarget({
      tdee: 2500,
      goal: 'lose',
      sex: 'male',
      flags: {},
      userOverrideKcal: 2000,
    });
    expect(r.targetKcal).toBe(2000);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it.each([
    ['isMinor', { isMinor: true }],
    ['isPregnant', { isPregnant: true }],
    ['isBreastfeeding', { isBreastfeeding: true }],
    ['eatingDisorderRisk', { eatingDisorderRisk: true }],
    ['medicalCondition', { medicalCondition: true }],
  ] as [string, SafetyFlags][])(
    'disables weight loss for safety flag: %s',
    (_name, flags) => {
      const r = calculateCalorieTarget({
        tdee: 2500,
        goal: 'lose',
        sex: 'female',
        flags,
      });
      expect(r.weightLossDisabled).toBe(true);
      expect(r.targetKcal).toBe(2500);
      expect(r.deficitKcal).toBe(0);
      expect(r.professionalGuidance).toMatch(/qualified health professional/);
      expect(
        r.warnings.some((w) => /treated as 'maintain'/i.test(w)),
      ).toBe(true);
    },
  );

  it('disables weight loss even when the goal is not lose', () => {
    const r = calculateCalorieTarget({
      tdee: 2200,
      goal: 'gain',
      sex: 'male',
      flags: { medicalCondition: true },
    });
    expect(r.weightLossDisabled).toBe(true);
    expect(r.targetKcal).toBe(2200);
    expect(r.professionalGuidance).toBeDefined();
  });

  it('adds +300 for gain', () => {
    const r = calculateCalorieTarget({
      tdee: 2500,
      goal: 'gain',
      sex: 'male',
      flags: {},
    });
    expect(r.targetKcal).toBe(2800);
    expect(r.deficitKcal).toBe(0);
  });

  it.each(['maintain', 'improve_fitness', 'eat_healthier'] as const)(
    'targets TDEE for goal %s',
    (goal) => {
      const r = calculateCalorieTarget({
        tdee: 2345.6,
        goal,
        sex: 'other',
        flags: {},
      });
      expect(r.targetKcal).toBe(2346);
      expect(r.deficitKcal).toBe(0);
      expect(r.weightLossDisabled).toBe(false);
    },
  );
});
