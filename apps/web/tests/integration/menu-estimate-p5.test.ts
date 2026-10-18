/**
 * FitFusion AI v21.8 — Priority 5: restaurant nutrition completeness.
 *
 * Pure unit tests for the null-vs-zero distinction and per-nutrient
 * completeness tracking in estimateFromRecipe (apps/web/lib/menu-estimate.ts).
 * No database involved.
 *
 * Covered:
 * - A genuine zero-calorie value (water, 0 kcal from the source) is
 *   accepted as known data — NOT treated as missing.
 * - null/undefined/NaN (unknown) is never conflated with 0 (known zero),
 *   for calories and for every macro the estimator sums.
 * - Completeness is tracked independently per nutrient
 *   (calories/protein/carbs/fat/fiber): each gets known/unknown status.
 * - Missing macros on an otherwise-known item mark the estimate incomplete
 *   with a structured problem naming the missing fields — the partial
 *   macro totals can never be published as complete.
 * - Unknown calories, invalid quantities (negative, NaN, zero), and
 *   unquantified cooking oil behave honestly.
 * - A fully complete ingredient set keeps the existing
 *   assumptions/calorie-range methodology byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { estimateFromRecipe } from '@/lib/menu-estimate';

const CHICKEN_FULL = {
  name: 'chicken breast',
  grams: 200,
  kcalPer100g: 165,
  proteinPer100g: 31,
  carbsPer100g: 0,
  fatPer100g: 3.6,
  fiberPer100g: 0,
};

describe('estimateFromRecipe — null vs zero (P5)', () => {
  it('accepts a genuine zero-calorie value as known data (water)', () => {
    const est = estimateFromRecipe({
      ingredients: [
        {
          name: 'water',
          grams: 250,
          kcalPer100g: 0,
          proteinPer100g: 0,
          carbsPer100g: 0,
          fatPer100g: 0,
          fiberPer100g: 0,
        },
      ],
      portionGrams: 250,
    });
    expect(est.complete).toBe(true);
    expect(est.problems).toHaveLength(0);
    expect(est.kcalBest).toBe(0);
    expect(est.kcalLow).toBe(0);
    expect(est.kcalHigh).toBe(0);
    expect(est.proteinG).toBe(0);
    expect(est.fields).toEqual({
      calories: 'known',
      protein: 'known',
      carbs: 'known',
      fat: 'known',
      fiber: 'known',
    });
  });

  it('treats null / undefined / omitted kcal as unknown, never as zero', () => {
    for (const kcalPer100g of [null, undefined, NaN] as const) {
      const est = estimateFromRecipe({
        ingredients: [{ name: 'broth', grams: 200, kcalPer100g }],
        portionGrams: 200,
      });
      expect(est.complete).toBe(false);
      expect(est.problems).toHaveLength(1);
      expect(est.problems[0].fields).toEqual(['calories']);
      expect(est.problems[0].reason).toMatch(/no calorie data/i);
    }
    // Omitted key entirely.
    const omitted = estimateFromRecipe({
      ingredients: [{ name: 'broth', grams: 200 }],
      portionGrams: 200,
    });
    expect(omitted.complete).toBe(false);
    expect(omitted.problems[0].fields).toEqual(['calories']);
  });

  it('rejects negative kcal as invalid data', () => {
    const est = estimateFromRecipe({
      ingredients: [{ ...CHICKEN_FULL, kcalPer100g: -5 }],
      portionGrams: 200,
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(1);
    expect(est.problems[0].fields).toEqual(['calories']);
    expect(est.problems[0].reason).toMatch(/invalid/i);
  });

  it('distinguishes unknown macros from zero macros', () => {
    // Unknown protein (undefined) vs known-zero carbs (0): only protein is unknown.
    const est = estimateFromRecipe({
      ingredients: [
        {
          name: 'chicken breast',
          grams: 200,
          kcalPer100g: 165,
          proteinPer100g: undefined,
          carbsPer100g: 0,
          fatPer100g: 3.6,
          fiberPer100g: 0,
        },
      ],
      portionGrams: 200,
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(1);
    expect(est.problems[0].fields).toEqual(['protein']);
    expect(est.fields.protein).toBe('unknown');
    expect(est.fields.carbs).toBe('known');
    expect(est.fields.calories).toBe('known');
  });
});

describe('estimateFromRecipe — per-nutrient completeness (P5)', () => {
  it('missing macros on an otherwise-known item mark the estimate incomplete with named fields', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: 'chicken breast', grams: 200, kcalPer100g: 165, proteinPer100g: 31 },
      ],
      portionGrams: 200,
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(1);
    expect(est.problems[0].ingredient).toBe('chicken breast');
    expect(est.problems[0].fields).toEqual(
      expect.arrayContaining(['carbs', 'fat', 'fiber']),
    );
    expect(est.problems[0].fields).not.toContain('protein');
    expect(est.problems[0].fields).not.toContain('calories');
    expect(est.problems[0].reason).toMatch(/carbs/);
    // Independent per-nutrient status.
    expect(est.fields.calories).toBe('known');
    expect(est.fields.protein).toBe('known');
    expect(est.fields.carbs).toBe('unknown');
    expect(est.fields.fat).toBe('unknown');
    expect(est.fields.fiber).toBe('unknown');
    // The calorie total itself is still honest (complete row data for kcal).
    expect(est.kcalBest).toBeCloseTo(330, 1);
  });

  it('flags negative macro values as invalid, not as missing', () => {
    const est = estimateFromRecipe({
      ingredients: [{ ...CHICKEN_FULL, fatPer100g: -1 }],
      portionGrams: 200,
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(1);
    expect(est.problems[0].fields).toEqual(['fat']);
    expect(est.problems[0].reason).toMatch(/invalid/i);
    expect(est.fields.fat).toBe('unknown');
  });

  it('a fully complete ingredient set is complete with all fields known', () => {
    const est = estimateFromRecipe({
      ingredients: [
        CHICKEN_FULL,
        {
          name: 'rice',
          grams: 100,
          kcalPer100g: 130,
          proteinPer100g: 2.7,
          carbsPer100g: 28,
          fatPer100g: 0.3,
          fiberPer100g: 0.4,
        },
      ],
      portionGrams: 300,
      cookingMethod: 'grilled',
    });
    expect(est.complete).toBe(true);
    expect(est.problems).toHaveLength(0);
    expect(est.fields).toEqual({
      calories: 'known',
      protein: 'known',
      carbs: 'known',
      fat: 'known',
      fiber: 'known',
    });
    // 330 + 130 kcal; 62 + 2.7 protein; 0 + 28 carbs; 7.2 + 0.3 fat; 0 + 0.4 fiber.
    expect(est.kcalBest).toBeCloseTo(460, 1);
    expect(est.proteinG).toBeCloseTo(64.7, 1);
    expect(est.carbsG).toBeCloseTo(28, 1);
    expect(est.fatG).toBeCloseTo(7.5, 1);
    expect(est.fiberG).toBeCloseTo(0.4, 1);
    expect(est.kcalLow).toBeCloseTo(460 * 0.85, 1);
    expect(est.kcalHigh).toBeCloseTo(460 * 1.15, 1);
  });

  it('keeps the assumptions methodology byte-identical for complete inputs', () => {
    const est = estimateFromRecipe({
      ingredients: [
        CHICKEN_FULL,
        {
          name: 'rice',
          grams: 100,
          kcalPer100g: 130,
          proteinPer100g: 2.7,
          carbsPer100g: 28,
          fatPer100g: 0.3,
          fiberPer100g: 0.4,
        },
      ],
      portionGrams: 300,
      cookingMethod: 'grilled',
    });
    expect(est.assumptions).toEqual([
      'Sum of 2 listed ingredient(s) using generic per-100 g values;',
      'Cooking method assumed: "grilled";',
      'Sauces, garnishes, and seasoning not itemized; treat as an estimate, not a label value.',
    ]);
  });
});

describe('estimateFromRecipe — honest quantities and oil (P5)', () => {
  it('rejects negative, NaN, and zero quantities with per-row reasons', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { ...CHICKEN_FULL, grams: -100 },
        { name: 'salt', grams: NaN, kcalPer100g: 0 },
        { name: 'pepper', grams: 0 },
      ],
      portionGrams: 200,
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(3);
    expect(est.problems[0].ingredient).toBe('chicken breast');
    expect(est.problems[0].reason).toMatch(/quantity/i);
    expect(est.problems[1].ingredient).toBe('salt');
    expect(est.problems[1].reason).toMatch(/quantity/i);
    // Zero-quantity with missing data is flagged, never silently dropped.
    expect(est.problems[2].ingredient).toBe('pepper');
    expect(est.problems[2].reason).toMatch(/quantity/i);
  });

  it('unquantified cooking oil keeps the honest widened-range path (no silent guess)', () => {
    const est = estimateFromRecipe({
      ingredients: [
        {
          name: 'potato',
          grams: 150,
          kcalPer100g: 77,
          proteinPer100g: 2,
          carbsPer100g: 17,
          fatPer100g: 0.1,
          fiberPer100g: 2.2,
        },
      ],
      portionGrams: 150,
      cookingMethod: 'deep fried',
      oilGrams: 0,
    });
    expect(est.complete).toBe(true);
    expect(est.problems).toHaveLength(0);
    expect(est.kcalBest).toBeCloseTo(115.5, 1);
    expect(est.assumptions.some((a) => a.includes('no quantified oil'))).toBe(true);
    expect(est.kcalLow).toBeCloseTo(115.5 * 0.8, 1);
    expect(est.kcalHigh).toBeCloseTo(115.5 * 1.2, 1);
  });
});
