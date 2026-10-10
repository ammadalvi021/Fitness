/**
 * Phase 4 regression: BMR / TDEE / calorie-target / macro math via the pure
 * @fitfusion/core library (the BMI *route* is covered in
 * public-and-gating.test.ts; there are no other calculator routes).
 *
 * These are deterministic unit-level checks of the safety-critical math:
 * deficit caps, calorie floors, and the macro split.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FACTORS,
  calculateCalorieTarget,
  calculateMacros,
  mifflinStJeor,
} from '@fitfusion/core';

const NO_FLAGS = {
  isMinor: false,
  isPregnant: false,
  isBreastfeeding: false,
  eatingDisorderRisk: false,
  medicalCondition: false,
};

describe('mifflinStJeor (BMR)', () => {
  it('male: 10w + 6.25h - 5a + 5', () => {
    // 10*70 + 6.25*175 - 5*30 + 5 = 1648.75
    expect(mifflinStJeor({ sex: 'male', weightKg: 70, heightCm: 175, ageYears: 30 })).toBeCloseTo(
      1648.75,
      2,
    );
  });

  it('female: 10w + 6.25h - 5a - 161', () => {
    // 10*70 + 6.25*175 - 5*30 - 161 = 1482.75
    expect(mifflinStJeor({ sex: 'female', weightKg: 70, heightCm: 175, ageYears: 30 })).toBeCloseTo(
      1482.75,
      2,
    );
  });

  it('other/prefer_not_to_say averages the two formulas', () => {
    const avg = (1648.75 + 1482.75) / 2;
    expect(
      mifflinStJeor({ sex: 'other', weightKg: 70, heightCm: 175, ageYears: 30 }),
    ).toBeCloseTo(avg, 2);
  });
});

describe('TDEE via activity factors', () => {
  it('moderate activity multiplies BMR by 1.55', () => {
    const bmr = mifflinStJeor({ sex: 'male', weightKg: 70, heightCm: 175, ageYears: 30 });
    expect(bmr * ACTIVITY_FACTORS.moderate).toBeCloseTo(1648.75 * 1.55, 1);
  });
});

describe('calculateCalorieTarget safety rules', () => {
  it('lose: deficit is capped at 20% of TDEE', () => {
    const r = calculateCalorieTarget({
      tdee: 2500,
      goal: 'lose',
      sex: 'male',
      flags: NO_FLAGS,
    });
    expect(r.targetKcal).toBeLessThan(2500);
    expect(r.deficitKcal).toBeLessThanOrEqual(500); // 20% of 2500
    expect(r.targetKcal).toBeGreaterThanOrEqual(1500); // male floor
  });

  it('floors hold: male >= 1500, female >= 1200', () => {
    const male = calculateCalorieTarget({ tdee: 1600, goal: 'lose', sex: 'male', flags: NO_FLAGS });
    expect(male.targetKcal).toBeGreaterThanOrEqual(1500);
    const female = calculateCalorieTarget({
      tdee: 1300,
      goal: 'lose',
      sex: 'female',
      flags: NO_FLAGS,
    });
    expect(female.targetKcal).toBeGreaterThanOrEqual(1200);
  });

  it('maintain returns ~TDEE with no deficit', () => {
    const r = calculateCalorieTarget({ tdee: 2200, goal: 'maintain', sex: 'male', flags: NO_FLAGS });
    expect(r.targetKcal).toBe(2200);
    expect(r.deficitKcal).toBe(0);
  });
});

describe('calculateMacros split', () => {
  it('protein scales with weight, fat is 25% of calories, fiber 14g/1000kcal', () => {
    const m = calculateMacros({ calories: 2000, goal: 'lose', weightKg: 70 });
    expect(m.proteinG).toBe(Math.round(2.0 * 70)); // lose -> 2.0 g/kg
    expect(m.fatG).toBe(Math.round((0.25 * 2000) / 9));
    expect(m.fiberG).toBe(Math.round((14 * 2000) / 1000));
    expect(m.carbsG).toBeGreaterThanOrEqual(0);
    expect(m.notes.length).toBeGreaterThan(0);
  });
});
