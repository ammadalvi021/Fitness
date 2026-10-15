/**
 * Recipe review/verification governance (v21.4) — pure policy tests.
 *
 * Pins the canonical material-change set and the invalidation/verify-gate
 * decisions. No database, no DOM — these run on every machine.
 */
import { describe, expect, it } from 'vitest';
import {
  MATERIAL_RECIPE_FIELDS,
  incompleteVerificationBlockMessage,
  incompleteVerificationBlockMessageForRows,
  invalidationForEdit,
  materialFieldsTouched,
  mayVerifyNutrition,
} from './recipe-governance.js';

describe('materialFieldsTouched — the canonical material-change set', () => {
  it('ingredients, portions/yield, dietCategory, tags, allergens are material', () => {
    expect(materialFieldsTouched(['ingredients'])).toEqual(['ingredients']);
    expect(materialFieldsTouched(['portions'])).toEqual(['portions']);
    expect(materialFieldsTouched(['yieldGrams'])).toEqual(['yieldGrams']);
    expect(materialFieldsTouched(['dietCategory'])).toEqual(['dietCategory']);
    expect(materialFieldsTouched(['tags'])).toEqual(['tags']);
    expect(materialFieldsTouched(['allergens'])).toEqual(['allergens']);
  });

  it('derived nutrition values are material by construction', () => {
    expect(materialFieldsTouched(['kcalPerServing'])).toEqual([
      'kcalPerServing',
    ]);
  });

  it('metadata-only fields are NOT material', () => {
    expect(
      materialFieldsTouched([
        'name',
        'prepMin',
        'cookMin',
        'difficulty',
        'instructions',
      ]),
    ).toEqual([]);
  });

  it('unknown keys are ignored (never treated as material)', () => {
    expect(materialFieldsTouched(['somethingNew'])).toEqual([]);
  });

  it('the material set covers every claim-bearing field', () => {
    // Guards against a future field being dropped from the set silently:
    // the set must still name the core five.
    for (const f of [
      'ingredients',
      'portions',
      'dietCategory',
      'tags',
      'allergens',
    ] as const) {
      expect(MATERIAL_RECIPE_FIELDS).toContain(f);
    }
  });
});

describe('invalidationForEdit — what a material edit lapses', () => {
  it('ingredient change → review AND verification invalidated', () => {
    const d = invalidationForEdit(['ingredients', 'name']);
    expect(d.invalidateReview).toBe(true);
    expect(d.invalidateVerification).toBe(true);
    expect(d.reason).toMatch(/ingredients/);
  });

  it('yield (portions) change → review AND verification invalidated', () => {
    const d = invalidationForEdit(['portions']);
    expect(d.invalidateReview).toBe(true);
    expect(d.invalidateVerification).toBe(true);
  });

  it('dietary-category change → review AND verification invalidated', () => {
    const d = invalidationForEdit(['dietCategory']);
    expect(d.invalidateReview).toBe(true);
    expect(d.invalidateVerification).toBe(true);
  });

  it('material claim (tags) / allergen change → invalidated', () => {
    expect(invalidationForEdit(['tags']).invalidateVerification).toBe(true);
    expect(invalidationForEdit(['allergens']).invalidateReview).toBe(true);
  });

  it('metadata-only edit → review and verification preserved', () => {
    const d = invalidationForEdit(['name', 'prepMin', 'instructions']);
    expect(d.invalidateReview).toBe(false);
    expect(d.invalidateVerification).toBe(false);
  });

  it('empty patch → nothing invalidated', () => {
    const d = invalidationForEdit([]);
    expect(d.invalidateReview).toBe(false);
    expect(d.invalidateVerification).toBe(false);
  });
});

describe('mayVerifyNutrition — incomplete nutrition can never be verified', () => {
  it('needsReview=true → verification refused', () => {
    expect(mayVerifyNutrition(true)).toBe(false);
  });

  it('needsReview=false/null/undefined → gate passes', () => {
    expect(mayVerifyNutrition(false)).toBe(true);
    expect(mayVerifyNutrition(null)).toBe(true);
    expect(mayVerifyNutrition(undefined)).toBe(true);
  });
});

describe('incompleteVerificationBlockMessage — the 400 copy', () => {
  it('names the unresolved ingredients', () => {
    const msg = incompleteVerificationBlockMessage(['chia seeds', 'xanthan gum']);
    expect(msg).toMatch(/chia seeds/);
    expect(msg).toMatch(/xanthan gum/);
    expect(msg).toMatch(/resolve the missing nutritional values/);
  });

  it('falls back to generic wording when no names are known', () => {
    const msg = incompleteVerificationBlockMessage([]);
    expect(msg).toMatch(/unknown nutrition/);
    expect(msg).not.toMatch(/unresolved ingredients: $/);
  });

  it('never suggests clearing needsReview to bypass the gate', () => {
    const msg = incompleteVerificationBlockMessage(['mystery spice']);
    expect(msg).toMatch(/Do not clear the needsReview flag/);
  });

  it('builds from stored rows via nutritionStatus', () => {
    const msg = incompleteVerificationBlockMessageForRows([
      { name: 'oats', nutritionStatus: 'ok' },
      { name: 'mystery spice', nutritionStatus: 'unknown' },
      { name: 'weird oil', nutritionStatus: 'incomplete' },
      { name: 'water' }, // no status tracked → not unresolved
    ]);
    expect(msg).toMatch(/mystery spice/);
    expect(msg).toMatch(/weird oil/);
    expect(msg).not.toMatch(/oats/);
    expect(msg).not.toMatch(/water/);
  });

  it('null/undefined rows → generic wording, never a crash', () => {
    expect(incompleteVerificationBlockMessageForRows(null)).toMatch(
      /unknown nutrition/,
    );
    expect(incompleteVerificationBlockMessageForRows(undefined)).toMatch(
      /unknown nutrition/,
    );
  });
});
