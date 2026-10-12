/**
 * Phase D — Restaurant Menus.
 * - estimateFromRecipe math (oil assumption, ranges, portion scaling)
 * - admin gate (non-admin blocked, ADMIN_EMAILS allowlist)
 * - honesty invariants (kcal present <=> status != 'unavailable')
 * - correction flow (open -> accept with updates / reject, no double-resolve)
 * - extract -> confirm never invents (unmatched -> 'unavailable', kcal null)
 * - diary logging of menu items via the existing POST /api/diary
 */
/**
 * DB-FREE variant: estimateFromRecipe math tests (Phase D).
 * DB-backed menu route tests live in restaurant-menus.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { estimateFromRecipe } from '@/lib/menu-estimate';

describe('estimateFromRecipe', () => {
  it('sums ingredients and adds explicit frying oil with an assumption', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: 'chicken breast', grams: 200, kcalPer100g: 165, proteinPer100g: 31 },
      ],
      portionGrams: 200,
      cookingMethod: 'fried',
      oilGrams: 10,
    });
    // 200g * 165/100 = 330 + 10g oil * 884/100 = 88.4
    expect(est.kcalBest).toBeCloseTo(418.4, 1);
    expect(est.proteinG).toBeCloseTo(62, 1);
    expect(est.assumptions.some((a) => a.includes('10 g absorbed cooking oil'))).toBe(true);
    // baseline spread ±15%
    expect(est.kcalLow).toBeCloseTo(418.4 * 0.85, 1);
    expect(est.kcalHigh).toBeCloseTo(418.4 * 1.15, 1);
  });

  it('widens the range and records an assumption when frying with unquantified oil', () => {
    const est = estimateFromRecipe({
      ingredients: [{ name: 'potato', grams: 150, kcalPer100g: 77 }],
      portionGrams: 150,
      cookingMethod: 'deep fried',
    });
    expect(est.kcalBest).toBeCloseTo(115.5, 1);
    expect(est.assumptions.some((a) => a.includes('no quantified oil'))).toBe(true);
    expect(est.kcalLow).toBeCloseTo(115.5 * 0.8, 1);
    expect(est.kcalHigh).toBeCloseTo(115.5 * 1.2, 1);
  });

  it('scales totals to the stated portion weight and notes it', () => {
    const est = estimateFromRecipe({
      ingredients: [{ name: 'rice', grams: 100, kcalPer100g: 130 }],
      portionGrams: 250,
      cookingMethod: 'steamed',
    });
    expect(est.kcalBest).toBeCloseTo(325, 1);
    expect(est.assumptions.some((a) => a.includes('Scaled by 2.50'))).toBe(true);
  });

  it('ignores empty ingredient rows and always lists sauce/seasoning caveat', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: '', grams: 0, kcalPer100g: 0 },
        { name: 'lentils', grams: 80, kcalPer100g: 116 },
      ],
      portionGrams: 80,
    });
    expect(est.kcalBest).toBeCloseTo(92.8, 1);
    expect(est.assumptions.some((a) => a.includes('1 listed ingredient'))).toBe(true);
    expect(
      est.assumptions.some((a) => a.includes('Sauces, garnishes, and seasoning not itemized')),
    ).toBe(true);
  });
});
