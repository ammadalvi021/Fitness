/**
 * V18 Phase E: healthier-swaps logic — pure unit tests (no DB).
 */
import { describe, expect, it } from 'vitest';
import {
  foodResultToSwapLike,
  kcalDensityPer100g,
  suggestSwaps,
  type SwapFoodLike,
} from '@/lib/swaps';

const friedChicken: SwapFoodLike = {
  id: 'f1', name: 'Fried chicken', perServingKcal: 400, servingSize: 100, servingUnit: 'g',
  categoryId: 'cat-poultry',
};
const grilledChicken: SwapFoodLike = {
  id: 'f2', name: 'Grilled chicken', perServingKcal: 180, servingSize: 100, servingUnit: 'g',
  categoryId: 'cat-poultry',
};
const bakedChicken: SwapFoodLike = {
  id: 'f3', name: 'Baked chicken', perServingKcal: 250, servingSize: 100, servingUnit: 'g',
  categoryId: 'cat-poultry',
};
const doubleFried: SwapFoodLike = {
  id: 'f4', name: 'Extra crispy fried chicken', perServingKcal: 450, servingSize: 100, servingUnit: 'g',
  categoryId: 'cat-poultry',
};
const cola: SwapFoodLike = {
  id: 'f5', name: 'Cola', perServingKcal: 140, servingSize: 330, servingUnit: 'ml',
  categoryId: 'cat-drinks',
};

describe('kcalDensityPer100g', () => {
  it('derives kcal/100g from gram servings', () => {
    expect(kcalDensityPer100g(friedChicken)).toBeCloseTo(400, 5);
  });
  it('returns null honestly when the serving is not gram-based', () => {
    expect(kcalDensityPer100g(cola)).toBeNull();
  });
  it('prefers a supplied kcalPer100g', () => {
    expect(kcalDensityPer100g({ ...cola, kcalPer100g: 42 })).toBe(42);
  });
});

describe('suggestSwaps', () => {
  it('suggests same-category lower-kcal-density foods with a computed basis', () => {
    const out = suggestSwaps(friedChicken, [grilledChicken, bakedChicken, doubleFried, cola]);
    expect(out).toHaveLength(2);
    // Best saving first.
    expect(out[0].food.id).toBe('f2');
    expect(out[0].savingPct).toBe(55);
    expect(out[0].basis).toBe('55% fewer calories per 100g');
    expect(out[1].food.id).toBe('f3');
    // Never suggests higher-kcal foods or other categories.
    expect(out.map((s) => s.food.id)).not.toContain('f4');
    expect(out.map((s) => s.food.id)).not.toContain('f5');
    expect(out.map((s) => s.food.id)).not.toContain('f1');
  });

  it('falls back to per-serving comparison with an honest basis label', () => {
    const fullSugar: SwapFoodLike = {
      id: 'd1', name: 'Full sugar soda', perServingKcal: 150, servingSize: 1, servingUnit: 'can',
      categoryId: 'cat-drinks',
    };
    const diet: SwapFoodLike = {
      id: 'd2', name: 'Diet soda', perServingKcal: 2, servingSize: 1, servingUnit: 'can',
      categoryId: 'cat-drinks',
    };
    const out = suggestSwaps(fullSugar, [diet]);
    expect(out).toHaveLength(1);
    expect(out[0].basis).toBe('99% fewer calories per serving');
  });

  it('skips candidates below the minimum meaningful saving', () => {
    const almostSame: SwapFoodLike = {
      id: 'f6', name: 'Fried chicken (light)', perServingKcal: 390, servingSize: 100, servingUnit: 'g',
      categoryId: 'cat-poultry',
    };
    expect(suggestSwaps(friedChicken, [almostSame])).toHaveLength(0);
  });

  it('caps at max suggestions', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `g${i}`, name: `Light option ${i}`, perServingKcal: 100 - i, servingSize: 100, servingUnit: 'g',
      categoryId: 'cat-poultry',
    }));
    expect(suggestSwaps(friedChicken, many, { max: 3 })).toHaveLength(3);
  });
});

describe('foodResultToSwapLike', () => {
  it('maps the current /api/foods shape', () => {
    const like = foodResultToSwapLike({
      id: 'x', name: 'Roti', servingSize: 40, servingUnit: 'g',
      perServing: { kcal: 120 }, verified: true,
    });
    expect(like.perServingKcal).toBe(120);
    expect(like.servingSize).toBe(40);
    expect(like.categoryId).toBeNull();
  });

  it('degrades gracefully when fields are missing', () => {
    const like = foodResultToSwapLike({ id: 'y', name: 'Mystery' });
    expect(like.id).toBe('y');
    expect(like.perServingKcal).toBeNull();
    expect(kcalDensityPer100g(like)).toBeNull();
  });

  it('reads the Phase A contract fields when present', () => {
    const like = foodResultToSwapLike({
      id: 'z', name: 'Daal', kcalPer100g: 116, categoryId: 'cat-legumes',
      verification: 'estimate', basis: 'USDA generic equivalent',
    });
    expect(like.kcalPer100g).toBe(116);
    expect(like.categoryId).toBe('cat-legumes');
    expect(like.verification).toBe('estimate');
  });
});
