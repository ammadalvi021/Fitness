/**
 * Adaptive TDEE estimation (MacroFactor-style expenditure back-solve).
 *
 * Pure math, no I/O. Given a rolling window of (date, total kcal in,
 * weight kg) days, TDEE is back-solved from the energy-balance identity:
 *
 *   Δbody-energy = intake − expenditure,  body-energy ≈ 7700 kcal/kg
 *
 * so  TDEE ≈ avg daily intake − (weight slope kg/day × KCAL_PER_KG).
 *
 * (Note: a draft of this feature wrote "+ slope × 7700"; that sign is
 * inverted — a person LOSING weight must get TDEE > intake, and a person
 * GAINING weight must get TDEE < intake. The minus sign above is the
 * physically correct form, verified by the synthetic-data tests.)
 *
 * The weight slope comes from ordinary least-squares on the daily weight
 * series after trailing weekly smoothing (a trailing 7-day moving average
 * preserves the slope of a linear trend while damping day-to-day noise).
 *
 * Honesty rules:
 * - Days with zero/missing intake are NOT days of data (fasting ≠ logged
 *   zero) and are excluded; never fabricate.
 * - Fewer than MIN_PAIRED_DAYS days with both intake and weight → the
 *   insufficient_data state (no estimate is produced).
 * - The result is clamped to [TDEE_MIN_KCAL, TDEE_MAX_KCAL]; never negative.
 */

/** Rolling window of calendar days considered. */
export const EXPENDITURE_WINDOW_DAYS = 21;
/** Minimum paired (intake + weight) days before an estimate is produced. */
export const EXPENDITURE_MIN_DAYS = 7;
/** Energy stored per kg of body-weight change (MacroFactor convention). */
export const KCAL_PER_KG = 7700;
/** Trailing smoothing window (days) applied to daily weights before the fit. */
export const SMOOTHING_DAYS = 7;
/** Sanity bounds on the final estimate. */
export const TDEE_MIN_KCAL = 1200;
export const TDEE_MAX_KCAL = 6000;

export interface ExpenditureDayInput {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  /** Total kcal logged that day. 0 / missing = not logged, excluded. */
  intakeKcal: number;
  /** Mean weigh-in that day in kg, or null when not weighed. */
  weightKg: number | null;
}

export type ExpenditureConfidence = 'low' | 'medium' | 'high';

export interface ExpenditureEstimate {
  status: 'ok';
  tdeeKcal: number;
  avgIntakeKcal: number;
  weightSlopeKgPerDay: number;
  confidence: ExpenditureConfidence;
  daysUsed: number;
  windowDays: number;
}

export interface ExpenditureInsufficient {
  status: 'insufficient_data';
  daysAvailable: number;
  daysNeeded: number;
  windowDays: number;
}

export type ExpenditureResult = ExpenditureEstimate | ExpenditureInsufficient;

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Ordinary least-squares slope of y on x (both equal length).
 */
export function leastSquaresSlope(xs: number[], ys: number[]): number {
  const n = ys.length;
  if (n < 2 || xs.length !== n) return 0;
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    num += dx * (ys[i] - yMean);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Trailing moving average, returned together with the effective x position
 * of each smoothed value (the mean of the window's x positions). On linear
 * data the smoothed series lies exactly on the line through (xEff, y), so
 * fitting slope on (xEff, smoothed) preserves a linear trend's slope
 * exactly while day-to-day noise is damped.
 */
export function trailingMovingAverage(
  xs: number[],
  values: number[],
  windowDays: number,
): { xs: number[]; smoothed: number[] } {
  const outXs: number[] = [];
  const outSmoothed: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - windowDays + 1);
    const xWin = xs.slice(start, i + 1);
    const yWin = values.slice(start, i + 1);
    outXs.push(xWin.reduce((a, b) => a + b, 0) / xWin.length);
    outSmoothed.push(yWin.reduce((a, b) => a + b, 0) / yWin.length);
  }
  return { xs: outXs, smoothed: outSmoothed };
}

function confidenceFor(daysUsed: number): ExpenditureConfidence {
  if (daysUsed >= 18) return 'high';
  if (daysUsed >= 10) return 'medium';
  return 'low';
}

/**
 * Back-solve TDEE from paired daily intake + weight observations.
 * Input need not be sorted; the most recent EXPENDITURE_WINDOW_DAYS days
 * (by date) form the rolling window.
 */
export function estimateExpenditure(
  days: ExpenditureDayInput[],
  windowDays: number = EXPENDITURE_WINDOW_DAYS,
): ExpenditureResult {
  const sorted = [...days]
    .filter((d) => typeof d.date === 'string')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const window = sorted.slice(Math.max(0, sorted.length - windowDays));

  // Paired days only: logged intake (>0 kcal) AND a weigh-in.
  const paired = window.filter(
    (d) => isFinitePositive(d.intakeKcal) && isFinitePositive(d.weightKg),
  );

  if (paired.length < EXPENDITURE_MIN_DAYS) {
    return {
      status: 'insufficient_data',
      daysAvailable: paired.length,
      daysNeeded: EXPENDITURE_MIN_DAYS,
      windowDays,
    };
  }

  const weights = paired.map((d) => d.weightKg as number);
  const dayIdx = paired.map((_, i) => i);
  const { xs, smoothed } = trailingMovingAverage(dayIdx, weights, SMOOTHING_DAYS);
  const slopeKgPerDay = leastSquaresSlope(xs, smoothed);
  const avgIntakeKcal =
    paired.reduce((a, d) => a + d.intakeKcal, 0) / paired.length;

  const raw = avgIntakeKcal - slopeKgPerDay * KCAL_PER_KG;
  const tdeeKcal = Math.min(
    TDEE_MAX_KCAL,
    Math.max(TDEE_MIN_KCAL, Math.round(raw)),
  );

  return {
    status: 'ok',
    tdeeKcal,
    avgIntakeKcal: Math.round(avgIntakeKcal),
    weightSlopeKgPerDay: Math.round(slopeKgPerDay * 10000) / 10000,
    confidence: confidenceFor(paired.length),
    daysUsed: paired.length,
    windowDays,
  };
}
