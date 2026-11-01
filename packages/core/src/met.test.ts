import { describe, expect, it } from 'vitest';
import {
  AEROBICS_MET,
  YOGA_MET,
  estimateCaloriesKcal,
  routineDurationSeconds,
  sequenceDurationSeconds,
} from './met.js';

describe('YOGA_MET / AEROBICS_MET reference values', () => {
  it('matches the approved category values', () => {
    expect(YOGA_MET).toEqual({
      beginner: 2.5,
      morning: 3.0,
      flexibility: 2.5,
      strength: 4.0,
      balance: 3.0,
      'relaxation-breathing': 2.0,
      'full-body': 3.5,
    });
    expect(AEROBICS_MET).toEqual({
      beginner: 5.0,
      'low-impact': 4.5,
      dance: 6.5,
      'moderate-cardio': 7.0,
      'full-body': 7.5,
      advanced: 8.5,
    });
  });
});

describe('estimateCaloriesKcal', () => {
  it('computes MET × kg × hours, rounded', () => {
    // 5.0 MET × 70 kg × 0.5 h = 175 kcal
    expect(estimateCaloriesKcal({ met: 5.0, weightKg: 70, durationSeconds: 1800 })).toBe(175);
    // 2.5 MET × 60 kg × 1 h = 150 kcal
    expect(estimateCaloriesKcal({ met: 2.5, weightKg: 60, durationSeconds: 3600 })).toBe(150);
  });

  it('returns null when weight is missing', () => {
    expect(estimateCaloriesKcal({ met: 5.0, weightKg: null, durationSeconds: 1800 })).toBeNull();
    expect(estimateCaloriesKcal({ met: 5.0, durationSeconds: 1800 })).toBeNull();
    expect(estimateCaloriesKcal({ met: 5.0, weightKg: undefined, durationSeconds: 1800 })).toBeNull();
  });

  it('returns null for non-positive weight', () => {
    expect(estimateCaloriesKcal({ met: 5.0, weightKg: 0, durationSeconds: 1800 })).toBeNull();
    expect(estimateCaloriesKcal({ met: 5.0, weightKg: -70, durationSeconds: 1800 })).toBeNull();
    expect(estimateCaloriesKcal({ met: 5.0, weightKg: NaN, durationSeconds: 1800 })).toBeNull();
  });

  it('returns null for zero or negative duration', () => {
    expect(estimateCaloriesKcal({ met: 5.0, weightKg: 70, durationSeconds: 0 })).toBeNull();
    expect(estimateCaloriesKcal({ met: 5.0, weightKg: 70, durationSeconds: -60 })).toBeNull();
  });

  it('returns null for a non-positive MET', () => {
    expect(estimateCaloriesKcal({ met: 0, weightKg: 70, durationSeconds: 1800 })).toBeNull();
  });
});

describe('sequenceDurationSeconds', () => {
  it('sums holds plus one transition per step', () => {
    expect(
      sequenceDurationSeconds([
        { holdSeconds: 30, side: 'both', transitionSeconds: 5 },
        { holdSeconds: 45, side: 'both', transitionSeconds: 5 },
      ]),
    ).toBe(85);
  });

  it('counts side "each" holds twice (once per side)', () => {
    expect(
      sequenceDurationSeconds([
        { holdSeconds: 30, side: 'each', transitionSeconds: 5 },
        { holdSeconds: 60, side: 'both', transitionSeconds: 10 },
      ]),
    ).toBe(30 * 2 + 5 + 60 + 10);
  });

  it('counts left/right single-side holds once', () => {
    expect(
      sequenceDurationSeconds([
        { holdSeconds: 20, side: 'left', transitionSeconds: 0 },
        { holdSeconds: 20, side: 'right', transitionSeconds: 0 },
      ]),
    ).toBe(40);
  });

  it('is zero for an empty sequence', () => {
    expect(sequenceDurationSeconds([])).toBe(0);
  });
});

describe('routineDurationSeconds', () => {
  it('is the plain sum of step durations', () => {
    expect(
      routineDurationSeconds([
        { durationSeconds: 60 },
        { durationSeconds: 120 },
        { durationSeconds: 30 },
      ]),
    ).toBe(210);
  });

  it('is zero for an empty routine', () => {
    expect(routineDurationSeconds([])).toBe(0);
  });
});
