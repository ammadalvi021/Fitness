/**
 * MET (Metabolic Equivalent of Task) reference values and pure helpers for
 * guided workouts (Yoga & Aerobics, V22).
 *
 * IMPORTANT — honesty rule: every value produced from these METs is an
 * ESTIMATE. Calorie figures derived here must always be labelled as
 * estimates in any UI or API surface ("estimated calories"); they are not
 * measurements and must never be presented as exact or medical data.
 */

/** MET values for yoga sequence categories (standard compendium ranges). */
export const YOGA_MET: Record<string, number> = {
  beginner: 2.5,
  morning: 3.0,
  flexibility: 2.5,
  strength: 4.0,
  balance: 3.0,
  'relaxation-breathing': 2.0,
  'full-body': 3.5,
};

/**
 * Reference MET values for aerobics categories. Individual routines store
 * their own `metValue` in the database; these are the category references
 * the seeded routines were calibrated against.
 */
export const AEROBICS_MET: Record<string, number> = {
  beginner: 5.0,
  'low-impact': 4.5,
  dance: 6.5,
  'moderate-cardio': 7.0,
  'full-body': 7.5,
  advanced: 8.5,
};

export interface CalorieEstimateInput {
  /** Metabolic Equivalent of Task for the activity. */
  met: number;
  /** Body weight in kilograms. Missing/invalid weight → null estimate. */
  weightKg?: number | null;
  /** Activity duration in seconds. */
  durationSeconds: number;
}

/**
 * Estimate calories burned: kcal = MET × weightKg × hours.
 *
 * Returns null when the estimate cannot be made responsibly (missing or
 * non-positive weight, non-positive duration, or a non-positive MET).
 * Callers must label any non-null result as an estimate.
 */
export function estimateCaloriesKcal(input: CalorieEstimateInput): number | null {
  const { met, weightKg, durationSeconds } = input;
  if (weightKg === null || weightKg === undefined || !(weightKg > 0)) return null;
  if (!(durationSeconds > 0)) return null;
  if (!(met > 0)) return null;
  return Math.round(met * weightKg * (durationSeconds / 3600));
}

export interface SequenceStepTiming {
  holdSeconds: number;
  /** both | left | right | each — "each" means the hold is done once per side. */
  side: string;
  transitionSeconds: number;
}

/**
 * Total duration of a yoga sequence in seconds: the sum of every pose hold
 * (a pose with side "each" is held twice — once per side) plus one
 * transition per step.
 */
export function sequenceDurationSeconds(steps: SequenceStepTiming[]): number {
  let total = 0;
  for (const step of steps) {
    total += step.side === 'each' ? step.holdSeconds * 2 : step.holdSeconds;
    total += step.transitionSeconds;
  }
  return total;
}

/** Total duration of an aerobics routine in seconds: the plain step sum. */
export function routineDurationSeconds(steps: { durationSeconds: number }[]): number {
  let total = 0;
  for (const step of steps) total += step.durationSeconds;
  return total;
}
