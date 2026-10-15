/**
 * serving-weight.test.ts — P1 canonical gram-per-serving normalization.
 * Pure: works on plain { name, servingSize, servingUnit, servingWeightG }
 * shapes, no DB.
 */
import { describe, expect, it } from 'vitest';
import { per100gFactor, resolveServingGrams } from './serving-weight.js';

describe('resolveServingGrams', () => {
  it('prefers the explicit servingWeightG (chapati, count serving)', () => {
    const r = resolveServingGrams({
      name: 'Chapati (Whole Wheat Roti)',
      servingSize: 1,
      servingUnit: 'piece (30g)',
      servingWeightG: 30,
    });
    expect(r.grams).toBe(30);
    expect(r.basis).toBe('explicit');
  });

  it('prefers the explicit servingWeightG (boiled eggs, count serving)', () => {
    const r = resolveServingGrams({
      name: 'Boiled Eggs',
      servingSize: 2,
      servingUnit: 'large eggs (100g)',
      servingWeightG: 100,
    });
    expect(r.grams).toBe(100);
    expect(r.basis).toBe('explicit');
  });

  it('handles volume servings via explicit weight (milk)', () => {
    const r = resolveServingGrams({
      name: 'Whole Milk',
      servingSize: 250,
      servingUnit: 'ml (1 cup)',
      servingWeightG: 257.5,
    });
    expect(r.grams).toBe(257.5);
    expect(r.basis).toBe('explicit');
  });

  it('parses the gram annotation from servingUnit when no explicit weight', () => {
    const r = resolveServingGrams({
      name: 'Naan',
      servingSize: 1,
      servingUnit: 'piece (90g)',
      servingWeightG: null,
    });
    expect(r.grams).toBe(90);
    expect(r.basis).toBe('serving-unit-annotation');
  });

  it('treats mass servingUnits as grams directly (cooked rice)', () => {
    const r = resolveServingGrams({
      name: 'Basmati Rice (cooked)',
      servingSize: 150,
      servingUnit: 'g (1 cup)',
      servingWeightG: null,
    });
    expect(r.grams).toBe(150);
    expect(r.basis).toBe('mass');
  });

  it('falls back to ingredient-specific density for volume servings', () => {
    const r = resolveServingGrams({
      name: 'Whole Milk',
      servingSize: 250,
      servingUnit: 'ml (1 cup)',
      servingWeightG: null,
    });
    expect(r.grams).toBeCloseTo(257.5, 1);
    expect(r.basis).toBe('volume-density');
  });

  it('returns UNKNOWN for volume servings with no documented density', () => {
    const r = resolveServingGrams({
      name: 'Mystery Sauce',
      servingSize: 250,
      servingUnit: 'ml (1 cup)',
      servingWeightG: null,
    });
    expect(r.grams).toBeNull();
    expect(r.warning).toMatch(/INCOMPLETE/);
  });

  it('returns UNKNOWN for ambiguous servings — never guesses', () => {
    const r = resolveServingGrams({
      name: 'Mystery Food',
      servingSize: 1,
      servingUnit: 'packet',
      servingWeightG: null,
    });
    expect(r.grams).toBeNull();
    expect(r.warning).toMatch(/INCOMPLETE/);
  });

  it('ignores non-positive explicit weights', () => {
    const r = resolveServingGrams({
      name: 'Bad Food',
      servingSize: 100,
      servingUnit: 'g',
      servingWeightG: 0,
    });
    expect(r.grams).toBe(100);
    expect(r.basis).toBe('mass');
  });
});

describe('per100gFactor', () => {
  it('computes the correct factor for count servings (chapati)', () => {
    // Old bug: 100 / 1 = 100 → 90 kcal × 100 = 9000 kcal/100 g.
    const { factor, warning } = per100gFactor({
      name: 'Chapati (Whole Wheat Roti)',
      servingSize: 1,
      servingUnit: 'piece (30g)',
      servingWeightG: 30,
    });
    expect(factor).toBeCloseTo(100 / 30, 6);
    expect(warning).toBeUndefined();
    // 90 kcal per chapati → 300 kcal/100 g (sane, not 9000).
    expect(90 * factor!).toBeCloseTo(300, 0);
  });

  it('computes the correct factor for multi-count servings (boiled eggs)', () => {
    const { factor } = per100gFactor({
      name: 'Boiled Eggs',
      servingSize: 2,
      servingUnit: 'large eggs (100g)',
      servingWeightG: 100,
    });
    expect(factor).toBe(1); // 140 kcal/serving = 140 kcal/100 g
    expect(140 * factor!).toBe(140);
  });

  it('computes the correct factor for volume servings (milk)', () => {
    const { factor } = per100gFactor({
      name: 'Whole Milk',
      servingSize: 250,
      servingUnit: 'ml (1 cup)',
      servingWeightG: 257.5,
    });
    expect(150 * factor!).toBeCloseTo(58.3, 1); // ≈ 58 kcal/100 g, not 60
  });

  it('returns null factor + warning when the serving weight is unknown', () => {
    const { factor, warning } = per100gFactor({
      name: 'Mystery Food',
      servingSize: 1,
      servingUnit: 'packet',
      servingWeightG: null,
    });
    expect(factor).toBeNull();
    expect(warning).toMatch(/INCOMPLETE/);
  });
});
