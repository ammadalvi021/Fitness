/**
 * Tests for adaptive TDEE back-solving (expenditure.ts).
 * Pure math on synthetic data — no DB, no network.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPENDITURE_MIN_DAYS,
  TDEE_MAX_KCAL,
  TDEE_MIN_KCAL,
  estimateExpenditure,
  leastSquaresSlope,
  trailingMovingAverage,
  type ExpenditureDayInput,
} from './expenditure.js';

function daysFrom(
  intakes: number[],
  weights: (number | null)[],
  startDate = '2026-09-20',
): ExpenditureDayInput[] {
  const [y, m, d] = startDate.split('-').map(Number);
  return intakes.map((intakeKcal, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    return {
      date: date.toISOString().slice(0, 10),
      intakeKcal,
      weightKg: weights[i],
    };
  });
}

describe('leastSquaresSlope', () => {
  it('recovers a known linear slope', () => {
    const xs = Array.from({ length: 14 }, (_, i) => i);
    const y = Array.from({ length: 14 }, (_, i) => 80 + i * 0.02);
    expect(leastSquaresSlope(xs, y)).toBeCloseTo(0.02, 6);
  });

  it('returns 0 for fewer than 2 points', () => {
    expect(leastSquaresSlope([], [])).toBe(0);
    expect(leastSquaresSlope([0], [80])).toBe(0);
  });
});

describe('trailingMovingAverage', () => {
  it('preserves the slope of a linear trend', () => {
    const xs = Array.from({ length: 14 }, (_, i) => i);
    const raw = Array.from({ length: 14 }, (_, i) => 80 + i * 0.02);
    const { xs: sx, smoothed } = trailingMovingAverage(xs, raw, 7);
    expect(leastSquaresSlope(sx, smoothed)).toBeCloseTo(0.02, 6);
  });
});

describe('estimateExpenditure', () => {
  it('back-solves TDEE from a known intake and weight slope', () => {
    // 14 days, intake 2500 kcal/day, weight 80 -> 79.65 kg.
    // slope = -0.35/13 = -0.026923 kg/day => deficit ~207.3 kcal/day.
    // Losing weight means TDEE > intake: TDEE = 2500 + 207.3 = 2707.3
    // (from TDEE = avgIntake - slope * 7700).
    const intakes = Array(14).fill(2500);
    const weights = Array.from({ length: 14 }, (_, i) => 80 - (0.35 * i) / 13);
    const res = estimateExpenditure(daysFrom(intakes, weights));
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.tdeeKcal).toBeGreaterThanOrEqual(2702);
    expect(res.tdeeKcal).toBeLessThanOrEqual(2713);
    expect(res.avgIntakeKcal).toBe(2500);
    expect(res.daysUsed).toBe(14);
    expect(res.confidence).toBe('medium');
  });

  it('gives TDEE < intake when gaining weight', () => {
    // 14 days, intake 2500, weight 80 -> 80.35 kg => surplus ~207 kcal/day
    // => TDEE ~ 2500 - 207 = 2293.
    const intakes = Array(14).fill(2500);
    const weights = Array.from({ length: 14 }, (_, i) => 80 + (0.35 * i) / 13);
    const res = estimateExpenditure(daysFrom(intakes, weights));
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.tdeeKcal).toBeGreaterThanOrEqual(2288);
    expect(res.tdeeKcal).toBeLessThanOrEqual(2298);
  });

  it('returns intake as TDEE when weight is flat', () => {
    const intakes = Array(10).fill(2400);
    const weights = Array(10).fill(78.5);
    const res = estimateExpenditure(daysFrom(intakes, weights));
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.tdeeKcal).toBe(2400);
  });

  it('returns insufficient_data below the minimum paired-day count', () => {
    const intakes = Array(5).fill(2200);
    const weights = Array(5).fill(78);
    const res = estimateExpenditure(daysFrom(intakes, weights));
    expect(res.status).toBe('insufficient_data');
    if (res.status !== 'insufficient_data') throw new Error('expected insufficient');
    expect(res.daysAvailable).toBe(5);
    expect(res.daysNeeded).toBe(EXPENDITURE_MIN_DAYS);
  });

  it('excludes days with zero intake or missing weigh-ins from the count', () => {
    // 10 calendar days but only 6 have both intake and weight.
    const intakes = [2000, 0, 2100, 2000, 0, 2000, 2100, 2000, 0, 2000];
    const weights = [80, 80, null, 79.9, 79.8, null, 79.7, 79.6, 79.5, 79.4];
    const res = estimateExpenditure(daysFrom(intakes, weights));
    expect(res.status).toBe('insufficient_data');
    if (res.status !== 'insufficient_data') throw new Error('expected insufficient');
    // paired: idx 0,3,6,7,9 (idx2 has intake but no weight; idx8 has weight but no intake)
    expect(res.daysAvailable).toBe(5);
  });

  it('clamps to the sane range instead of going negative or absurd', () => {
    // Implausible rapid loss: -0.8 kg/day => deficit 6160 kcal/day.
    const intakes = Array(14).fill(2000);
    const weights = Array.from({ length: 14 }, (_, i) => 90 - i * 0.8);
    const loss = estimateExpenditure(daysFrom(intakes, weights));
    expect(loss.status).toBe('ok');
    if (loss.status !== 'ok') throw new Error('expected ok');
    expect(loss.tdeeKcal).toBe(TDEE_MAX_KCAL);

    // Implausible rapid gain: +0.5 kg/day => surplus 3850 kcal/day,
    // raw TDEE = 2000 - 3850 < 0 => clamped to the floor, never negative.
    const gains = Array.from({ length: 14 }, (_, i) => 70 + i * 0.5);
    const gain = estimateExpenditure(daysFrom(intakes, gains));
    expect(gain.status).toBe('ok');
    if (gain.status !== 'ok') throw new Error('expected ok');
    expect(gain.tdeeKcal).toBe(TDEE_MIN_KCAL);
    expect(gain.tdeeKcal).toBeGreaterThanOrEqual(0);

    expect(TDEE_MIN_KCAL).toBeGreaterThan(0);
  });

  it('assigns confidence tiers by paired-day count', () => {
    const mk = (n: number) =>
      estimateExpenditure(
        daysFrom(Array(n).fill(2300), Array(n).fill(78)),
      );
    const low = mk(8);
    expect(low.status).toBe('ok');
    if (low.status === 'ok') expect(low.confidence).toBe('low');
    const boundaryLow = mk(9);
    if (boundaryLow.status === 'ok') expect(boundaryLow.confidence).toBe('low');
    const medium = mk(12);
    if (medium.status === 'ok') expect(medium.confidence).toBe('medium');
    const boundaryHigh = mk(18);
    if (boundaryHigh.status === 'ok') expect(boundaryHigh.confidence).toBe('high');
    const high = mk(21);
    if (high.status === 'ok') expect(high.confidence).toBe('high');
  });

  it('uses the most recent windowDays of input', () => {
    // 30 days: first 16 at weight 90, last 14 declining from 90 to 89.65.
    const intakes = Array(30).fill(2500);
    const weights = Array.from({ length: 30 }, (_, i) =>
      i < 16 ? 90 : 90 - (0.35 * (i - 16)) / 13,
    );
    const res = estimateExpenditure(daysFrom(intakes, weights));
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.daysUsed).toBe(21);
    // Only the declining tail is inside the 21-day window: slope is
    // negative (weight loss), so TDEE > intake.
    expect(res.tdeeKcal).toBeGreaterThan(2500);
  });

  it('handles unsorted input dates', () => {
    const intakes = Array(10).fill(2400);
    const weights = Array(10).fill(78.5);
    const ordered = daysFrom(intakes, weights);
    const shuffled = [...ordered].reverse();
    const a = estimateExpenditure(ordered);
    const b = estimateExpenditure(shuffled);
    expect(a).toEqual(b);
  });
});
