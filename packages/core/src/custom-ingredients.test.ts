/**
 * custom-ingredients.test.ts — P4 classification of non-foodId rows.
 * Pure, no DB.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyCustomIngredient,
  isKnownZeroIngredient,
  KNOWN_ZERO_INGREDIENTS,
} from './custom-ingredients.js';

describe('isKnownZeroIngredient', () => {
  it('matches the explicit list by exact name', () => {
    expect(isKnownZeroIngredient('water')).toBe(true);
    expect(isKnownZeroIngredient('Salt')).toBe(true);
    expect(isKnownZeroIngredient('  TURMERIC  ')).toBe(true);
    expect(isKnownZeroIngredient('red chili powder')).toBe(true);
  });
  it('matches explicit aliases', () => {
    expect(isKnownZeroIngredient('namak')).toBe(true);
    expect(isKnownZeroIngredient('pani')).toBe(true);
    expect(isKnownZeroIngredient('haldi')).toBe(true);
  });
  it('does NOT pattern-match: "salted peanuts" is not zero', () => {
    expect(isKnownZeroIngredient('salted peanuts')).toBe(false);
    expect(isKnownZeroIngredient('chicken salt')).toBe(false);
    expect(isKnownZeroIngredient('seawater')).toBe(false);
  });
  it('a chicken-like ingredient is not known-zero', () => {
    expect(isKnownZeroIngredient('chicken breast')).toBe(false);
    expect(isKnownZeroIngredient('chicken')).toBe(false);
  });
  it('the list is explicit and small', () => {
    expect(KNOWN_ZERO_INGREDIENTS.length).toBeLessThanOrEqual(12);
    for (const e of KNOWN_ZERO_INGREDIENTS) {
      expect(e.name.length).toBeGreaterThan(0);
    }
  });
});

describe('classifyCustomIngredient', () => {
  it('classifies known-zero items (water, salt)', () => {
    expect(classifyCustomIngredient('Water', {}).status).toBe('known_zero');
    expect(classifyCustomIngredient('salt', {}).status).toBe('known_zero');
  });
  it('classifies fully-declared nutrients with a basis', () => {
    const r = classifyCustomIngredient('My special sauce', {
      kcal: 120, proteinG: 2, carbsG: 10, fatG: 8, fiberG: 1, basis: 'label',
    });
    expect(r.status).toBe('declared');
    expect(r.warnings).toEqual([]);
  });
  it('an unknown "chicken"-like ingredient is flagged, never zeroed silently', () => {
    const r = classifyCustomIngredient('Chicken-ish mystery meat', {});
    expect(r.status).toBe('unknown');
    expect(r.warnings.some((w) => w.includes('nutrition unknown'))).toBe(true);
  });
  it('name+grams-only rows are unknown — nutrients must not default to 0 silently', () => {
    const r = classifyCustomIngredient('Homemade curry paste', {});
    expect(r.status).toBe('unknown');
  });
  it('partial declarations are unknown', () => {
    const r = classifyCustomIngredient('Half-declared sauce', { kcal: 100, proteinG: 2 });
    expect(r.status).toBe('unknown');
    expect(r.warnings.some((w) => w.includes('5'))).toBe(true);
  });
  it('full declarations without a basis are unknown', () => {
    const r = classifyCustomIngredient('Baseless sauce', {
      kcal: 100, proteinG: 2, carbsG: 10, fatG: 5, fiberG: 1,
    });
    expect(r.status).toBe('unknown');
    expect(r.warnings.some((w) => w.includes('basis'))).toBe(true);
  });
  it('each basis value is accepted', () => {
    for (const basis of ['usda', 'label', 'estimate'] as const) {
      const r = classifyCustomIngredient('Sauce', {
        kcal: 100, proteinG: 2, carbsG: 10, fatG: 5, fiberG: 1, basis,
      });
      expect(r.status, basis).toBe('declared');
    }
  });
  it('warns when a known-zero item declares non-zero nutrients', () => {
    const r = classifyCustomIngredient('salt', { kcal: 50 });
    expect(r.status).toBe('known_zero');
    expect(r.warnings.some((w) => w.includes('ignored'))).toBe(true);
  });
});
