/**
 * FitFusion AI v21.8 — Priority 6: honest menu estimator.
 *
 * Pure unit tests for the incomplete-row tracking in estimateFromRecipe.
 * A subtotal computed from only the valid rows must never masquerade as the
 * complete dish nutrition: any unresolved material ingredient marks the
 * result incomplete with a per-row reason.
 */
import { describe, expect, it } from 'vitest';
import { estimateFromRecipe } from '@/lib/menu-estimate';

describe('estimateFromRecipe — incomplete ingredient handling', () => {
  it('missing food calorie data marks the estimate incomplete with a per-row reason', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: 'chicken breast', grams: 200, kcalPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0 },
        { name: 'mystery sauce', grams: 30, kcalPer100g: NaN },
      ],
      portionGrams: 230,
      cookingMethod: 'grilled',
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(1);
    expect(est.problems[0].row).toBe(2);
    expect(est.problems[0].ingredient).toBe('mystery sauce');
    expect(est.problems[0].reason).toContain('No calorie data');
    expect(est.problems[0].fields).toEqual(['calories']);
    expect(est.fields.calories).toBe('known'); // the contributing row's data is known; the total is partial
    // Totals cover only the valid row, scaled to the stated portion (200 g
    // valid → 230 g portion = ×1.15): the subtotal must not equal a clean total.
    expect(est.kcalBest).toBeCloseTo(379.5, 1);
    expect(est.assumptions.some((a) => a.includes('INCOMPLETE'))).toBe(true);
  });

  it('negative or invalid quantity marks the estimate incomplete with a per-row reason', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: 'rice', grams: -100, kcalPer100g: 130 },
        { name: 'salt', grams: NaN, kcalPer100g: 0 },
      ],
      portionGrams: 200,
      cookingMethod: 'steamed',
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(2);
    expect(est.problems[0].ingredient).toBe('rice');
    expect(est.problems[0].reason).toContain('Quantity');
    expect(est.problems[1].ingredient).toBe('salt');
    expect(est.problems[1].reason).toContain('Quantity');
  });

  it('an incomplete ingredient set returns incomplete, not a clean total', () => {
    // v21.8 P5: null/undefined kcal = UNKNOWN (missing data) -> incomplete.
    // A genuine 0 is accepted as known-zero (see the water test in
    // menu-estimate-p5.test.ts); the old "0 kcal is not real data" rule is
    // replaced by the null-vs-zero distinction.
    const est = estimateFromRecipe({
      ingredients: [
        { name: 'lentils', grams: 80, kcalPer100g: 116, proteinPer100g: 9, carbsPer100g: 20, fatPer100g: 0.4, fiberPer100g: 8 },
        { name: 'ghee', grams: 15, kcalPer100g: undefined },
      ],
      portionGrams: 95,
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(1);
    expect(est.problems[0].row).toBe(2);
    expect(est.problems[0].fields).toEqual(['calories']);
    expect(est.problems[0].reason).toMatch(/no calorie data/i);
    // Old buggy behavior would have returned a clean complete-looking total.
    expect(est.assumptions[0]).toContain('INCOMPLETE');
  });

  it('unquantified oil ("oil to taste", no grams) marks the estimate incomplete with a reason', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: 'chicken breast', grams: 200, kcalPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0 },
        { name: 'oil to taste', grams: 0, kcalPer100g: 884 },
      ],
      portionGrams: 200,
      cookingMethod: 'fried',
      oilGrams: 0,
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(1);
    expect(est.problems[0].ingredient).toBe('oil to taste');
    expect(est.problems[0].reason).toContain('oil to taste');
    expect(est.problems[0].reason).toMatch(/gram/i);
  });

  it('a valid complete recipe returns unchanged correct totals with assumptions and ranges intact', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: 'chicken breast', grams: 200, kcalPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0 },
      ],
      portionGrams: 200,
      cookingMethod: 'fried',
      oilGrams: 10,
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
    expect(est.kcalBest).toBeCloseTo(418.4, 1);
    expect(est.proteinG).toBeCloseTo(62, 1);
    expect(est.assumptions.some((a) => a.includes('10 g absorbed cooking oil'))).toBe(true);
    expect(est.kcalLow).toBeCloseTo(418.4 * 0.85, 1);
    expect(est.kcalHigh).toBeCloseTo(418.4 * 1.15, 1);
  });

  it('truly blank placeholder rows are still silently skipped without flagging incomplete', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: '', grams: 0, kcalPer100g: 0 },
        { name: '   ', grams: NaN, kcalPer100g: NaN },
        { name: 'lentils', grams: 80, kcalPer100g: 116, proteinPer100g: 9, carbsPer100g: 20, fatPer100g: 0.4, fiberPer100g: 8 },
      ],
      portionGrams: 80,
    });
    expect(est.complete).toBe(true);
    expect(est.problems).toHaveLength(0);
    expect(est.kcalBest).toBeCloseTo(92.8, 1);
    expect(est.assumptions.some((a) => a.includes('1 listed ingredient'))).toBe(true);
  });

  it('a row with quantity data but no name is flagged, not silently counted', () => {
    const est = estimateFromRecipe({
      ingredients: [{ name: '', grams: 50, kcalPer100g: 100 }],
      portionGrams: 50,
    });
    expect(est.complete).toBe(false);
    expect(est.problems).toHaveLength(1);
    expect(est.problems[0].reason).toContain('no ingredient name');
  });

  it('fried dish with unquantified oil and otherwise valid rows stays complete with widened range', () => {
    // The existing assumption-based oil handling is the honest path for
    // absorbed frying oil; it must not regress to incomplete.
    const est = estimateFromRecipe({
      ingredients: [{ name: 'potato', grams: 150, kcalPer100g: 77, proteinPer100g: 2, carbsPer100g: 17, fatPer100g: 0.1, fiberPer100g: 2.2 }],
      portionGrams: 150,
      cookingMethod: 'deep fried',
    });
    expect(est.complete).toBe(true);
    expect(est.kcalBest).toBeCloseTo(115.5, 1);
    expect(est.assumptions.some((a) => a.includes('no quantified oil'))).toBe(true);
    expect(est.kcalLow).toBeCloseTo(115.5 * 0.8, 1);
    expect(est.kcalHigh).toBeCloseTo(115.5 * 1.2, 1);
  });
});
