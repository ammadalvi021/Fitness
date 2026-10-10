/**
 * Nutrient arithmetic: scaling servings, summing, rounding.
 * Pure functions.
 */

import type { Nutrients } from './types.js';

/** Round to 1 decimal place. */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Scale a nutrient profile from `fromServings` to `toServings`.
 * Throws RangeError if fromServings is not > 0 (division by zero guard).
 */
export function scaleNutrients(
  n: Nutrients,
  fromServings: number,
  toServings: number,
): Nutrients {
  if (!(fromServings > 0)) {
    throw new RangeError('scaleNutrients: fromServings must be > 0');
  }
  const factor = toServings / fromServings;
  return {
    kcal: n.kcal * factor,
    proteinG: n.proteinG * factor,
    carbsG: n.carbsG * factor,
    fatG: n.fatG * factor,
    fiberG: n.fiberG * factor,
  };
}

/** Component-wise sum of nutrient profiles. */
export function sumNutrients(list: Nutrients[]): Nutrients {
  const total: Nutrients = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  for (const n of list) {
    total.kcal += n.kcal;
    total.proteinG += n.proteinG;
    total.carbsG += n.carbsG;
    total.fatG += n.fatG;
    total.fiberG += n.fiberG;
  }
  return total;
}

/** Round every component to 1 decimal place. */
export function roundNutrients(n: Nutrients): Nutrients {
  return {
    kcal: round1(n.kcal),
    proteinG: round1(n.proteinG),
    carbsG: round1(n.carbsG),
    fatG: round1(n.fatG),
    fiberG: round1(n.fiberG),
  };
}
