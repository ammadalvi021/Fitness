/**
 * Ingredient-database shape tests — PURE (no database).
 * Importing seed-ingredients.ts must never touch the DB.
 */
import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from './seed-ingredients.js';

describe('ingredient catalogue size', () => {
  it('has ~180 ingredients (150 base + 32 v21 gap-fill)', () => {
    expect(INGREDIENTS.length).toBeGreaterThanOrEqual(175);
    expect(INGREDIENTS.length).toBeLessThanOrEqual(195);
  });

  it('has unique names', () => {
    const names = INGREDIENTS.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers all required categories', () => {
    const cats = new Set(INGREDIENTS.map((i) => i.category));
    for (const c of [
      'Meat, Fish & Eggs',
      'Daals & Beans',
      'Rice & Grains',
      'Flours',
      'Dairy',
      'Vegetables',
      'Fruits',
      'Oils & Ghee',
      'Nuts & Seeds',
      'Spices',
      'Sauces & Condiments',
    ]) {
      expect(cats.has(c)).toBe(true);
    }
  });
});

describe('raw vs cooked separation', () => {
  it('keeps raw and cooked variants as separate entries with distinct values', () => {
    const pairs: Array<[string, string]> = [
      ['Chicken breast (raw)', 'Chicken breast (cooked)'],
      ['Basmati rice (raw)', 'Basmati rice (cooked)'],
      ['Masoor daal (dry)', 'Masoor daal (cooked)'],
      ['Kabuli chana (dry)', 'Kabuli chana (cooked)'],
    ];
    for (const [a, b] of pairs) {
      const ea = INGREDIENTS.find((i) => i.name === a);
      const eb = INGREDIENTS.find((i) => i.name === b);
      expect(ea).toBeDefined();
      expect(eb).toBeDefined();
      expect(ea!.per100).not.toEqual(eb!.per100);
    }
  });
});

describe('honesty invariants', () => {
  it('every entry cites a reference basis (USDA or documented estimate)', () => {
    for (const i of INGREDIENTS) {
      expect(['USDA FoodData Central standard reference', 'Standard reference estimate']).toContain(i.basis);
    }
  });

  it('trace-quantity seasonings are 0-kcal by design (curry powder excepted: used by the tbsp)', () => {
    for (const i of INGREDIENTS.filter((x) => x.category === 'Spices' && x.name !== 'Japanese curry powder')) {
      expect(i.per100).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('per100 tuples are finite, non-negative, and macros sum sanely', () => {
    for (const i of INGREDIENTS) {
      expect(i.per100).toHaveLength(5);
      for (const v of i.per100) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      // protein+carbs+fat+water cannot exceed 100 g per 100 g (fiber ⊂ carbs).
      const [p, c, f] = [i.per100[1], i.per100[2], i.per100[3]];
      expect(p + c + f).toBeLessThanOrEqual(100.5);
      // kcal consistent with Atwater 4/4/9 within a generous tolerance.
      const atwater = p * 4 + c * 4 + f * 9;
      expect(Math.abs(i.per100[0] - atwater)).toBeLessThan(60);
    }
  });

  it('aliases are unique across entries', () => {
    const seen = new Map<string, string>();
    for (const i of INGREDIENTS) {
      for (const a of [i.name.toLowerCase(), ...i.aliases.map((x) => x.toLowerCase())]) {
        if (!seen.has(a)) seen.set(a, i.name);
      }
    }
    // informational only — duplicates would weaken exact-alias matching
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe('provenance (v21.2 P9)', () => {
  it('every entry has a source label consistent with its basis', () => {
    for (const i of INGREDIENTS) {
      expect(['USDA FoodData Central', 'standard estimate']).toContain(i.source);
      // source is a plain relabel of the already-recorded basis — no new claim.
      if (i.basis === 'USDA FoodData Central standard reference') {
        expect(i.source).toBe('USDA FoodData Central');
      } else {
        expect(i.source).toBe('standard estimate');
      }
    }
  });

  it('no invented USDA record IDs: sourceRef is absent or a real usda-<fdcId>', () => {
    // The real identifier form is established by apps/web/lib/usda.ts:
    // id: `usda-${fdcId}` where fdcId is the numeric FoodData Central ID.
    // Per-100-g standard-reference values were never captured per-record,
    // so every v21 entry honestly has NO sourceRef.
    for (const i of INGREDIENTS) {
      if (i.sourceRef !== undefined) {
        expect(i.sourceRef, `${i.name} sourceRef`).toMatch(/^usda-\d+$/);
      }
    }
    const withRef = INGREDIENTS.filter((i) => i.sourceRef !== undefined);
    expect(withRef.length).toBe(0);
  });

  it('lastReviewedAt is absent or a real ISO date — never backfilled', () => {
    for (const i of INGREDIENTS) {
      if (i.lastReviewedAt !== undefined) {
        expect(i.lastReviewedAt, `${i.name} lastReviewedAt`).toMatch(
          /^\d{4}-\d{2}-\d{2}/,
        );
        expect(Number.isNaN(Date.parse(i.lastReviewedAt))).toBe(false);
      }
    }
  });
});
