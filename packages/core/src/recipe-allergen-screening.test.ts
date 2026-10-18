/**
 * FitFusion AI v21.4 — ITEM 6 regression tests (pure logic, run on this VM).
 *
 * Confirmed defect: POST /api/recipes defaulted an omitted `dietCategory`
 * to 'vegetarian' (mislabeling meat recipes) and stored an empty `allergens`
 * list with no record that screening ever happened.
 *
 * These tests pin the fix at the pure-logic level:
 *  - screenIngredientAllergens: wheat/milk/eggs/peanuts are detected from
 *    ingredient names; lookalikes (eggplant, coconut) do not false-positive;
 *    an empty detection result is documented as "not detected", never as a
 *    safety promise.
 *  - dietAllergenRecheckNeeded: material changes (ingredient names,
 *    dietCategory) trigger a recheck; grams-only and ordering changes do not.
 *
 * Route-level behavior (400 on missing dietCategory; allergenScreened
 * persisted) is covered by the mocked POST suite in
 * apps/web/tests/integration/v214-custom-recipe-diet-allergen.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  screenIngredientAllergens,
  dietAllergenRecheckNeeded,
  resolveAllergenExclusionTerms,
} from './recipe-allergen-screening.js';

describe('screenIngredientAllergens (v21.4 ITEM 6)', () => {
  it('detects wheat, milk, eggs, and peanuts from ingredient names', () => {
    expect(screenIngredientAllergens(['Whole wheat flour'])).toContain('wheat');
    expect(screenIngredientAllergens(['Atta'])).toContain('wheat');
    expect(screenIngredientAllergens(['Milk'])).toContain('milk');
    expect(screenIngredientAllergens(['Desi ghee'])).toContain('milk');
    expect(screenIngredientAllergens(['Paneer'])).toContain('milk');
    expect(screenIngredientAllergens(['Dahi'])).toContain('milk');
    expect(screenIngredientAllergens(['Eggs'])).toContain('eggs');
    expect(screenIngredientAllergens(['Peanuts'])).toContain('peanuts');
  });

  it('detects several families in one pass, deduped and sorted', () => {
    const out = screenIngredientAllergens([
      'Milk',
      'Whole wheat flour',
      'Eggs',
      'Peanuts',
      'milk powder', // duplicate family, no double-count
    ]);
    expect(out).toEqual(['eggs', 'milk', 'peanuts', 'wheat']);
  });

  it('does not false-positive on lookalikes', () => {
    // eggplant contains "egg" — the \beggs?\b boundary must not match.
    expect(screenIngredientAllergens(['Eggplant'])).toEqual([]);
    // coconut contains "nut" but is not a tree nut or peanut for screening.
    const coconut = screenIngredientAllergens(['Coconut']);
    expect(coconut).not.toContain('tree nuts');
    expect(coconut).not.toContain('peanuts');
  });

  it('detects the remaining families: soy, fish, shellfish, sesame, tree nuts', () => {
    expect(screenIngredientAllergens(['Soy sauce'])).toContain('soy');
    expect(screenIngredientAllergens(['Tofu'])).toContain('soy');
    expect(screenIngredientAllergens(['Rohu fish'])).toContain('fish');
    expect(screenIngredientAllergens(['Prawns'])).toContain('shellfish');
    expect(screenIngredientAllergens(['Sesame oil'])).toContain('sesame');
    expect(screenIngredientAllergens(['Almonds'])).toContain('tree nuts');
    expect(screenIngredientAllergens(['Cashews'])).toContain('tree nuts');
  });

  it('blank/null/undefined names are ignored; nothing detected -> []', () => {
    expect(screenIngredientAllergens(['', null, undefined, '  '])).toEqual([]);
    expect(screenIngredientAllergens(['Water', 'Salt', 'Turmeric'])).toEqual([]);
  });

  it('matching is case-insensitive', () => {
    expect(screenIngredientAllergens(['WHOLE MILK'])).toContain('milk');
    expect(screenIngredientAllergens(['whole Wheat Bread'])).toContain('wheat');
  });

  it('an empty detection result is "not detected" — never an allergen-free promise', () => {
    // The helper performs screening only; there is no field, flag, or
    // return shape that could be read as "certified allergen-free". This
    // test pins that contract: [] is the only possible "clean" outcome,
    // and it is documented in the module header as not-a-safety-promise.
    const result = screenIngredientAllergens(['Water', 'Salt']);
    expect(result).toEqual([]);
    expect(
      (screenIngredientAllergens as unknown as { allergenFree?: unknown })
        .allergenFree,
    ).toBeUndefined();
  });
});

describe('dietAllergenRecheckNeeded (v21.4 ITEM 6)', () => {
  it('returns false when there is no previous record (creation screens unconditionally)', () => {
    expect(
      dietAllergenRecheckNeeded(null, {
        ingredients: ['Chicken breast'],
        dietCategory: 'non_vegetarian',
      }),
    ).toBe(false);
    expect(
      dietAllergenRecheckNeeded(undefined, {
        ingredients: ['Chicken breast'],
        dietCategory: 'non_vegetarian',
      }),
    ).toBe(false);
  });

  it('returns false when nothing material changed (incl. reorder)', () => {
    const prev = { ingredients: ['Milk', 'Eggs'], dietCategory: 'vegetarian' };
    expect(
      dietAllergenRecheckNeeded(prev, {
        ingredients: ['eggs', 'MILK '], // case/whitespace/order insensitive
        dietCategory: 'vegetarian',
      }),
    ).toBe(false);
  });

  it('returns true when an ingredient name is added, removed, or renamed', () => {
    const prev = { ingredients: ['Milk', 'Eggs'], dietCategory: 'vegetarian' };
    expect(
      dietAllergenRecheckNeeded(prev, {
        ingredients: ['Milk', 'Eggs', 'Peanuts'],
        dietCategory: 'vegetarian',
      }),
    ).toBe(true);
    expect(
      dietAllergenRecheckNeeded(prev, {
        ingredients: ['Milk'],
        dietCategory: 'vegetarian',
      }),
    ).toBe(true);
    expect(
      dietAllergenRecheckNeeded(prev, {
        ingredients: ['Milk', 'Egg whites'],
        dietCategory: 'vegetarian',
      }),
    ).toBe(true);
  });

  it('returns true when the diet category changes', () => {
    const prev = { ingredients: ['Chicken breast'], dietCategory: 'non_vegetarian' };
    expect(
      dietAllergenRecheckNeeded(prev, {
        ingredients: ['Chicken breast'],
        dietCategory: 'vegetarian',
      }),
    ).toBe(true);
  });
});

describe('resolveAllergenExclusionTerms (v21.8 P3)', () => {
  it('resolves common allergy synonyms to canonical family labels', () => {
    expect(resolveAllergenExclusionTerms(['dairy'])).toEqual(['milk']);
    expect(resolveAllergenExclusionTerms(['milk'])).toEqual(['milk']);
    expect(resolveAllergenExclusionTerms(['gluten'])).toEqual(['wheat']);
    expect(resolveAllergenExclusionTerms(['wheat'])).toEqual(['wheat']);
    expect(resolveAllergenExclusionTerms(['peanut'])).toEqual(['peanuts']);
    expect(resolveAllergenExclusionTerms(['peanuts'])).toEqual(['peanuts']);
    expect(resolveAllergenExclusionTerms(['egg'])).toEqual(['eggs']);
    expect(resolveAllergenExclusionTerms(['soya'])).toEqual(['soy']);
    expect(resolveAllergenExclusionTerms(['prawns'])).toEqual(['shellfish']);
  });

  it('resolves tree-nut family spellings to the canonical "tree nuts" label', () => {
    for (const term of ['tree nut', 'tree nuts', 'tree-nut', 'tree-nuts', 'treenut', 'Tree Nut']) {
      expect(resolveAllergenExclusionTerms([term])).toEqual(['tree nuts']);
    }
    expect(resolveAllergenExclusionTerms(['almond'])).toEqual(['tree nuts']);
    expect(resolveAllergenExclusionTerms(['cashews'])).toEqual(['tree nuts']);
  });

  it('keeps peanut and tree nuts as SEPARATE families (never merged)', () => {
    expect(resolveAllergenExclusionTerms(['peanut'])).toEqual(['peanuts']);
    expect(resolveAllergenExclusionTerms(['peanut'])).not.toContain('tree nuts');
    expect(resolveAllergenExclusionTerms(['tree nut'])).toEqual(['tree nuts']);
    expect(resolveAllergenExclusionTerms(['tree nut'])).not.toContain('peanuts');
  });

  it('normalizes case, whitespace, and hyphens/underscores', () => {
    expect(resolveAllergenExclusionTerms(['  DAIRY '])).toEqual(['milk']);
    expect(resolveAllergenExclusionTerms(['tree_nut'])).toEqual(['tree nuts']);
    expect(resolveAllergenExclusionTerms(['  Tree   Nut '])).toEqual(['tree nuts']);
  });

  it('dedupes and sorts the resolved labels', () => {
    expect(resolveAllergenExclusionTerms(['dairy', 'milk', 'DAIRY', 'gluten', 'wheat'])).toEqual([
      'milk',
      'wheat',
    ]);
  });

  it('passes unmapped terms through unchanged (never silently dropped)', () => {
    // A stored label the synonym table does not know still reaches the
    // DB-level NOT clause verbatim — callers never invent matches for it.
    expect(resolveAllergenExclusionTerms(['corn'])).toEqual(['corn']);
    expect(resolveAllergenExclusionTerms(['milk', 'corn'])).toEqual(['corn', 'milk']);
  });

  it('returns [] for empty/blank input (no exclusion requested)', () => {
    expect(resolveAllergenExclusionTerms([])).toEqual([]);
    expect(resolveAllergenExclusionTerms(['', '   ', null, undefined])).toEqual([]);
  });
});
