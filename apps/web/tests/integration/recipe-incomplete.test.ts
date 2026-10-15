/**
 * Admin incomplete-nutrition status helper (v21.4) — pure tests.
 *
 * Pins `incompleteStatusForAdmin` (apps/web/lib/recipe-incomplete.ts),
 * the helper the admin review API and the AdminRecipeReview panel use to
 * report WHY verification is blocked on an incomplete recipe.
 */
import { describe, expect, it } from 'vitest';
import { incompleteStatusForAdmin } from '@/lib/recipe-incomplete';

const ROWS = [
  { name: 'oats', grams: 50, nutritionStatus: 'ok' },
  { name: 'mystery spice', grams: 5, nutritionStatus: 'unknown' },
  { name: 'weird oil', grams: 10, nutritionStatus: 'incomplete' },
];

describe('incompleteStatusForAdmin', () => {
  it('incomplete recipe → blocked, unresolved names listed', () => {
    const s = incompleteStatusForAdmin({
      needsReview: true,
      ingredients: ROWS,
    });
    expect(s.needsReview).toBe(true);
    expect(s.verificationBlocked).toBe(true);
    expect(s.unresolvedIngredients).toEqual(['mystery spice', 'weird oil']);
  });

  it('complete recipe → not blocked, no unresolved names', () => {
    const s = incompleteStatusForAdmin({
      needsReview: false,
      ingredients: [{ name: 'oats', nutritionStatus: 'ok' }],
    });
    expect(s.needsReview).toBe(false);
    expect(s.verificationBlocked).toBe(false);
    expect(s.unresolvedIngredients).toEqual([]);
  });

  it('null/undefined needsReview is treated as complete', () => {
    expect(
      incompleteStatusForAdmin({ ingredients: ROWS }).verificationBlocked,
    ).toBe(false);
    expect(
      incompleteStatusForAdmin({ needsReview: null, ingredients: ROWS })
        .verificationBlocked,
    ).toBe(false);
  });

  it('flag set but rows carry no per-row status → still blocked, empty names', () => {
    // Older rows have no nutritionStatus; the needsReview flag alone blocks.
    const s = incompleteStatusForAdmin({
      needsReview: true,
      ingredients: [{ name: 'oats', grams: 50 }],
    });
    expect(s.verificationBlocked).toBe(true);
    expect(s.unresolvedIngredients).toEqual([]);
  });

  it('non-array ingredients never crash', () => {
    const s = incompleteStatusForAdmin({ needsReview: true, ingredients: null });
    expect(s.verificationBlocked).toBe(true);
    expect(s.unresolvedIngredients).toEqual([]);
  });
});
