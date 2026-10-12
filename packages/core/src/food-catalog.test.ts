/**
 * food-catalog: recipe nutrition math, water rule, search ranking,
 * pagination, household-portion gram conversion. Pure — no DB.
 */
import { describe, expect, it } from 'vitest';
import {
  computeRecipeNutrition,
  ingredientNutrients,
  isWaterIngredient,
  paginate,
  portionGrams,
  rankFoodMatches,
} from './food-catalog.js';

describe('isWaterIngredient', () => {
  it('detects water in English, Roman Urdu, and Urdu script', () => {
    expect(isWaterIngredient('Water')).toBe(true);
    expect(isWaterIngredient('water (for gravy)')).toBe(true);
    expect(isWaterIngredient('Pani')).toBe(true);
    expect(isWaterIngredient('پانی')).toBe(true);
  });
  it('does not match lookalikes', () => {
    expect(isWaterIngredient('Watermelon')).toBe(false);
    expect(isWaterIngredient('Rosewater')).toBe(false);
    expect(isWaterIngredient('Chicken')).toBe(false);
  });
});

describe('ingredientNutrients / computeRecipeNutrition', () => {
  it('scales per-100-g values by grams', () => {
    const n = ingredientNutrients({
      name: 'Atta',
      grams: 200,
      kcal: 340,
      proteinG: 13,
      carbsG: 72,
      fatG: 2,
      fiberG: 11,
    });
    expect(n.kcal).toBeCloseTo(680, 6);
    expect(n.proteinG).toBeCloseTo(26, 6);
    expect(n.carbsG).toBeCloseTo(144, 6);
  });

  it('water contributes 0 kcal even with bogus client values', () => {
    const n = ingredientNutrients({
      name: 'Water',
      grams: 500,
      kcal: 999,
      proteinG: 50,
    });
    expect(n).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
  });

  it('name-only rows (salt, spices) contribute 0 without inventing nutrition', () => {
    const n = ingredientNutrients({ name: 'Salt', grams: 5 });
    expect(n.kcal).toBe(0);
    expect(n.proteinG).toBe(0);
  });

  it('computes totals and even per-portion splits', () => {
    const { totals, perPortion, portions } = computeRecipeNutrition(
      [
        { name: 'Chicken breast', grams: 500, kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.5, fiberG: 0 },
        { name: 'Onion', grams: 100, kcal: 40, proteinG: 1.1, carbsG: 9.3, fatG: 0.1, fiberG: 1.7 },
        { name: 'Water', grams: 400, kcal: 0 },
      ],
      4,
    );
    // totals: 825+40=865 kcal, 155+1.1=156.1 protein
    expect(totals.kcal).toBeCloseTo(865, 1);
    expect(totals.proteinG).toBeCloseTo(156.1, 1);
    expect(portions).toBe(4);
    expect(perPortion.kcal).toBeCloseTo(216.3, 1);
    expect(perPortion.proteinG).toBeCloseTo(39, 1);
    // per-portion sums back to totals within rounding
    expect(perPortion.kcal * 4).toBeCloseTo(totals.kcal, 0);
  });

  it('floors fractional portions to a positive integer', () => {
    const r = computeRecipeNutrition([{ name: 'Rice', grams: 300, kcal: 130 }], 0);
    expect(r.portions).toBe(1);
    expect(r.perPortion.kcal).toBe(r.totals.kcal);
  });
});

describe('rankFoodMatches', () => {
  const foods = [
    { id: '1', name: 'Chicken Karahi', aliases: ['chicken kadhai'], verification: 'estimate' },
    { id: '2', name: 'Roti', aliases: ['روٹی', 'chapati', 'phulka'], verification: 'estimate' },
    { id: '3', name: 'Chapati (Whole Wheat Roti)', aliases: ['roti'], verification: 'verified' },
    { id: '4', name: 'Roti Bank', aliases: [], verification: 'verified' },
  ];

  it('exact name match outranks alias match outranks name-contains', () => {
    const ranked = rankFoodMatches(foods, 'roti').map((f) => f.id);
    // 'Roti' exact name first, then alias match 'Chapati (Whole Wheat Roti)'
    // (verified), then name-contains 'Roti Bank'
    expect(ranked[0]).toBe('2');
    expect(ranked.slice(1)).toEqual(['3', '4']);
  });

  it('matches Urdu-script and Roman-Urdu aliases', () => {
    expect(rankFoodMatches(foods, 'روٹی').map((f) => f.id)).toEqual(['2']);
    expect(rankFoodMatches(foods, 'phulka').map((f) => f.id)).toEqual(['2']);
    expect(rankFoodMatches(foods, 'CHAPATI').map((f) => f.id)[0]).toBe('2');
  });

  it('is case-insensitive and drops non-matches', () => {
    expect(rankFoodMatches(foods, 'karahi').map((f) => f.id)).toEqual(['1']);
    expect(rankFoodMatches(foods, 'xyz-nope')).toEqual([]);
  });

  it('orders verified first, then name, when no query', () => {
    const ranked = rankFoodMatches(foods, '').map((f) => f.id);
    expect(ranked).toEqual(['3', '4', '1', '2']);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 45 }, (_, i) => i + 1);
  it('slices pages and reports totals', () => {
    const p = paginate(items, 2, 20);
    expect(p.items).toHaveLength(20);
    expect(p.items[0]).toBe(21);
    expect(p.page).toBe(2);
    expect(p.total).toBe(45);
    expect(p.totalPages).toBe(3);
  });
  it('clamps out-of-range pages', () => {
    expect(paginate(items, 99, 20).page).toBe(3);
    expect(paginate(items, 0, 20).page).toBe(1);
  });
});

describe('portionGrams', () => {
  it('prefers grams, falls back to ml (≈1 g/ml) for drinks', () => {
    expect(portionGrams({ grams: 200, ml: null })).toBe(200);
    expect(portionGrams({ grams: null, ml: 250 })).toBe(250);
    expect(portionGrams({ grams: 150, ml: 150 })).toBe(150);
    expect(portionGrams({ grams: null, ml: null })).toBeNull();
    expect(portionGrams({ grams: 0, ml: null })).toBeNull();
  });
});
