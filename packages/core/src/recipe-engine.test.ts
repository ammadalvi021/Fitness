/**
 * recipe-engine tests — pure functions, no DB, no network.
 * The catalogue is imported from the pure data module
 * `packages/db/prisma/seed-ingredients.ts` (importing it must not touch the DB).
 */
import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from '../../db/prisma/seed-ingredients.js';
import {
  computeRecipe,
  parseQuantity,
  resolveIngredient,
  tasteGrams,
  toGrams,
} from './recipe-engine.js';

const ing = (name: string) => {
  const hit = resolveIngredient(name, INGREDIENTS);
  if (!hit) throw new Error(`test setup: could not resolve "${name}"`);
  return hit;
};

describe('parseQuantity', () => {
  it('parses "600 g"', () => {
    expect(parseQuantity('600 g')).toEqual({ amount: 600, unit: 'g' });
  });
  it('parses "2 tbsp"', () => {
    expect(parseQuantity('2 tbsp')).toEqual({ amount: 2, unit: 'tbsp' });
  });
  it('parses "1 cup"', () => {
    expect(parseQuantity('1 cup')).toEqual({ amount: 1, unit: 'cup' });
  });
  it('treats a bare number as pieces', () => {
    expect(parseQuantity('3')).toEqual({ amount: 3, unit: 'piece' });
  });
  it('parses "1 medium"', () => {
    expect(parseQuantity('1 medium')).toEqual({ amount: 1, unit: 'medium' });
  });
  it('parses fractions "1/2 cup" and "1 1/2 cups"', () => {
    expect(parseQuantity('1/2 cup')).toEqual({ amount: 0.5, unit: 'cup' });
    expect(parseQuantity('1 1/2 cups')).toEqual({ amount: 1.5, unit: 'cup' });
  });
  it('handles "to taste"', () => {
    expect(parseQuantity('to taste')).toEqual({ amount: 1, unit: 'to_taste' });
    expect(parseQuantity('Salt to taste')).toEqual({ amount: 1, unit: 'to_taste' });
  });
  it('is case-insensitive and handles plurals', () => {
    expect(parseQuantity('2 TSP')).toEqual({ amount: 2, unit: 'tsp' });
    expect(parseQuantity('3 Cups')).toEqual({ amount: 3, unit: 'cup' });
  });
  it('marks ranges as unknown — no midpoint guessing', () => {
    expect(parseQuantity('2-3 tbsp')).toEqual({
      amount: 0,
      unit: 'none',
      unknown: 'range',
    });
    expect(parseQuantity('2–3 cups')).toMatchObject({ unknown: 'range' });
  });
  it('marks bare fractions as unknown', () => {
    expect(parseQuantity('1/2')).toEqual({
      amount: 0,
      unit: 'none',
      unknown: 'bare-fraction',
    });
  });
  it('marks unrecognized units as unknown — no silent piece fallback', () => {
    expect(parseQuantity('3 blargs')).toEqual({
      amount: 3,
      unit: 'none',
      unknown: 'unrecognized-unit',
    });
  });
  it('parses "2 fl oz"', () => {
    expect(parseQuantity('2 fl oz')).toEqual({ amount: 2, unit: 'fl_oz' });
  });
  it('strips parenthetical notes', () => {
    expect(parseQuantity('2 tbsp (30 ml)')).toEqual({ amount: 2, unit: 'tbsp' });
  });
  it('returns unit "none" for empty/unparseable input', () => {
    expect(parseQuantity('')).toEqual({ amount: 0, unit: 'none' });
    expect(parseQuantity('a handful')).toMatchObject({
      amount: 0,
      unit: 'none',
      unknown: 'unparseable',
    });
  });
});

describe('toGrams', () => {
  const g = (
    amount: number,
    unit: Parameters<typeof toGrams>[1],
    ingredient?: Parameters<typeof toGrams>[2],
  ) => toGrams(amount, unit, ingredient).grams;

  it('converts mass units directly, ingredient-independent', () => {
    expect(g(600, 'g')).toBe(600);
    expect(g(1, 'kg')).toBe(1000);
    expect(g(500, 'mg')).toBe(0.5);
    expect(g(1, 'oz')).toBeCloseTo(28.35, 2);
    expect(g(1, 'lb')).toBeCloseTo(453.6, 1);
  });
  it('converts water volumes 1:1 (documented density 1.0)', () => {
    const water = ing('Water');
    expect(g(250, 'ml', water)).toBe(250);
    expect(g(1, 'l', water)).toBe(1000);
    expect(g(1, 'cup', water)).toBe(240);
    expect(g(2, 'tbsp', water)).toBe(30);
    expect(g(2, 'tsp', water)).toBe(10);
  });
  it('converts milk volumes with its documented density', () => {
    const milk = ing('Milk (whole)');
    expect(g(1, 'cup', milk)).toBeCloseTo(247.2, 1); // 240 ml × 1.03
    expect(g(250, 'ml', milk)).toBeCloseTo(257.5, 1);
  });
  it('uses ingredient-specific household measures: tbsp of oil !== tbsp of flour', () => {
    const oil = ing('Olive oil');
    const flour = ing('Maida (all-purpose flour)');
    // 15 ml × 0.92 g/ml vs 15 ml × 0.52 g/ml
    expect(g(1, 'tbsp', oil)).toBeCloseTo(13.8, 1);
    expect(g(1, 'tbsp', flour)).toBeCloseTo(7.8, 1);
    expect(Math.abs(g(1, 'tbsp', oil)! - g(1, 'tbsp', flour)!)).toBeGreaterThan(5);
  });
  it('converts salt and sugar volumes with documented densities', () => {
    expect(g(1, 'tsp', ing('Salt'))).toBeCloseTo(6, 0); // 5 ml × 1.2 g/ml
    expect(g(1, 'cup', ing('Sugar (white)'))).toBeCloseTo(199.2, 0); // 240 × 0.83
  });
  it('returns UNKNOWN for volumes with no documented density — never 1.0', () => {
    const r = toGrams(1, 'cup', ing('Chicken breast (raw)'));
    expect(r.grams).toBeNull();
    expect(r.warnings.some((w) => w.includes('unknown'))).toBe(true);
    expect(toGrams(250, 'ml', ing('Chicken breast (raw)')).grams).toBeNull();
  });
  it('converts fl oz through density', () => {
    expect(g(1, 'fl_oz', ing('Milk (whole)'))).toBeCloseTo(29.5735 * 1.03, 1);
  });
  it('uses pieceGrams for countable units', () => {
    expect(g(1, 'medium', ing('Onion'))).toBe(120);
    expect(g(3, 'piece', ing('Green chili'))).toBe(15);
    expect(g(2, 'piece', ing('Egg (raw)'))).toBe(100);
  });
  it('falls back to documented defaults with a visible warning', () => {
    const r = toGrams(1, 'medium');
    expect(r.grams).toBe(120);
    expect(r.warnings.some((w) => w.includes('generic default'))).toBe(true);
    expect(g(1, 'large')).toBe(180);
    expect(g(1, 'small')).toBe(60);
    expect(g(1, 'piece')).toBe(100);
    expect(g(1, 'clove')).toBe(4);
  });
  it('uses ingredient pieceGrams without warning', () => {
    const r = toGrams(1, 'medium', ing('Onion'));
    expect(r.grams).toBe(120);
    expect(r.warnings).toEqual([]);
  });
  it('applies the to-taste rule: salt 1 g, oil 5 g, spice 2 g', () => {
    expect(tasteGrams(ing('Salt'))).toBe(1);
    expect(tasteGrams(ing('Olive oil'))).toBe(5);
    expect(tasteGrams(ing('Turmeric'))).toBe(2);
    expect(g(1, 'to_taste', ing('Salt'))).toBe(1);
    expect(g(1, 'pinch', ing('Ghee'))).toBe(5);
    expect(g(1, 'pinch', ing('Black pepper'))).toBe(2);
  });
  it('returns 0 for unit "none" or non-positive amounts', () => {
    expect(g(5, 'none')).toBe(0);
    expect(g(0, 'g')).toBe(0);
  });
  it('reports the density basis in warnings for table lookups', () => {
    const r = toGrams(1, 'tbsp', ing('Olive oil'));
    expect(r.warnings.some((w) => w.includes('USDA'))).toBe(true);
  });
  it('counts catalogue-zero items as 0 g for volumes (nutritionally irrelevant)', () => {
    // Turmeric is 0 kcal/100 g in the catalogue: 1/2 tsp is unknown grams
    // but cannot change nutrition — 0 g with a visible warning, not
    // incomplete, not a 1.0 fallback.
    const r = toGrams(0.5, 'tsp', ing('Turmeric'));
    expect(r.grams).toBe(0);
    expect(r.warnings.some((w) => w.includes('nutritionally irrelevant'))).toBe(true);
    // …but a non-zero item with no density is still UNKNOWN.
    expect(toGrams(1, 'tbsp', ing('Ginger')).grams).toBeNull();
  });
});

describe('resolveIngredient', () => {
  it('matches exact names case-insensitively', () => {
    expect(resolveIngredient('Olive oil', INGREDIENTS)?.name).toBe('Olive oil');
    expect(resolveIngredient('OLIVE OIL', INGREDIENTS)?.name).toBe('Olive oil');
  });
  it('matches Roman Urdu aliases', () => {
    expect(resolveIngredient('pyaz', INGREDIENTS)?.name).toBe('Onion');
    expect(resolveIngredient('dahi', INGREDIENTS)?.name).toBe('Dahi (plain yogurt)');
    expect(resolveIngredient('adrak', INGREDIENTS)?.name).toBe('Ginger');
  });
  it('matches names with prep words ("Chicken breast, cubed")', () => {
    const hit = resolveIngredient('Chicken breast, cubed', INGREDIENTS);
    expect(hit?.name).toBe('Chicken breast (raw)');
  });
  it('handles plurals ("Tomatoes, chopped")', () => {
    expect(resolveIngredient('Tomatoes, chopped', INGREDIENTS)?.name).toBe('Tomato');
  });
  it('keeps raw vs cooked distinct', () => {
    const raw = resolveIngredient('Basmati rice (raw)', INGREDIENTS);
    const cooked = resolveIngredient('Basmati rice (cooked)', INGREDIENTS);
    expect(raw?.per100[0]).toBe(360);
    expect(cooked?.per100[0]).toBe(130);
    expect(raw?.per100).not.toEqual(cooked?.per100);
    const dryDaal = resolveIngredient('Masoor daal (dry)', INGREDIENTS);
    const cookedDaal = resolveIngredient('Masoor daal (cooked)', INGREDIENTS);
    expect(dryDaal?.per100[0]).toBe(352);
    expect(cookedDaal?.per100[0]).toBe(116);
  });
  it('prefers the most specific match ("Coconut milk" over "Milk (whole)")', () => {
    expect(resolveIngredient('Coconut milk', INGREDIENTS)?.name).toBe('Coconut milk');
  });
  it('returns null for unknown ingredients — never guesses', () => {
    expect(resolveIngredient('Unicorn meat', INGREDIENTS)).toBeNull();
    expect(resolveIngredient('Ginger-garlic paste', INGREDIENTS)).toBeNull();
  });
  it('returns null when genuinely ambiguous ("oil", "rice", "milk" alone)', () => {
    // 'oil' could be olive/canola/mustard/sunflower; 'rice' raw vs cooked ×
    // basmati vs brown — the engine must not pick one.
    expect(resolveIngredient('oil', INGREDIENTS)).toBeNull();
    expect(resolveIngredient('rice', INGREDIENTS)).toBeNull();
  });
});

describe('computeRecipe', () => {
  it('computes water + salt as 0 kcal', () => {
    const r = computeRecipe(
      [
        { name: 'Water', quantity: '500 ml' },
        { name: 'Salt', quantity: 'to taste' },
      ],
      2,
      INGREDIENTS,
    );
    expect(r.totals.kcal).toBe(0);
    expect(r.perServing.kcal).toBe(0);
    expect(r.unresolved).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it('lists unknown ingredients as unresolved and excludes them from totals', () => {
    const r = computeRecipe(
      [
        { name: 'Chicken breast (raw)', quantity: '200 g' },
        { name: 'Ginger-garlic paste', quantity: '2 tbsp' },
      ],
      2,
      INGREDIENTS,
    );
    expect(r.unresolved).toEqual(['Ginger-garlic paste']);
    expect(r.warnings.some((w) => w.includes('awaiting review'))).toBe(true);
    // 200 g raw breast = 240 kcal total, 120 per serving (paste excluded).
    expect(r.totals.kcal).toBe(240);
    expect(r.perServing.kcal).toBe(120);
    expect(r.complete).toBe(false);
  });

  it('divides totals evenly by servings', () => {
    const items = [{ name: 'Basmati rice (cooked)', quantity: '200 g' }];
    const two = computeRecipe(items, 2, INGREDIENTS);
    const four = computeRecipe(items, 4, INGREDIENTS);
    expect(two.totals.kcal).toBe(260);
    expect(two.perServing.kcal).toBe(130);
    expect(four.perServing.kcal).toBe(65);
    expect(two.portions).toBe(2);
    expect(four.portions).toBe(4);
  });

  it('recomputes the Light Chicken Karahi seed recipe within sanity bounds', () => {
    // Seed recipe (packages/db/prisma/seed.ts): servings 4, stored per-serving
    // { kcal: 320, proteinG: 38, carbsG: 8, fatG: 14, fiberG: 2 }.
    const r = computeRecipe(
      [
        { name: 'Chicken breast, cubed', quantity: '600 g' },
        { name: 'Tomatoes, chopped', quantity: '4 medium' },
        { name: 'Onion, sliced', quantity: '1 medium' },
        { name: 'Ginger-garlic paste', quantity: '2 tbsp' },
        { name: 'Green chilies, slit', quantity: '3' },
        { name: 'Olive oil', quantity: '2 tbsp' },
        { name: 'Karahi masala + salt + turmeric', quantity: 'to taste' },
        { name: 'Fresh coriander, chopped', quantity: '2 tbsp' },
      ],
      4,
      INGREDIENTS,
    );

    // Compound items are honestly unresolved, not guessed; bare 'coriander'
    // resolves to fresh leaves per the documented kitchen convention.
    expect(r.unresolved).toEqual(['Ginger-garlic paste']);
    expect(
      r.resolved.find((l) => l.name === 'Fresh coriander, chopped')?.ingredient,
    ).toBe('Coriander leaves');

    const stored = { kcal: 320, proteinG: 38, carbsG: 8, fatG: 14, fiberG: 2 };
    const delta = (actual: number, want: number) => Math.abs(actual - want) / want;
    const deltas = {
      kcal: delta(r.perServing.kcal, stored.kcal),
      proteinG: delta(r.perServing.proteinG, stored.proteinG),
      carbsG: delta(r.perServing.carbsG, stored.carbsG),
      fatG: delta(r.perServing.fatG, stored.fatG),
      fiberG: delta(r.perServing.fiberG, stored.fiberG),
    };
    // eslint-disable-next-line no-console
    console.log('Light Chicken Karahi recompute — per-serving:', r.perServing, 'deltas:', deltas);

    // kcal / protein / carbs within ±15% of the stored hand-estimates.
    expect(deltas.kcal).toBeLessThan(0.15);
    expect(deltas.proteinG).toBeLessThan(0.15);
    expect(deltas.carbsG).toBeLessThan(0.15);
    // Fat: stored 14 g/serving is internally inconsistent with the recipe's
    // own quantities (600 g breast ≈ 15.6 g fat + 2 tbsp oil = 27.6 g
    // [2 × 15 ml × 0.92 g/ml] ≈ 43–44 g total → ≈ 11 g/serving). The
    // engine's value is the consistent one; allow ±25% here and report the
    // actual delta.
    expect(deltas.fatG).toBeLessThan(0.25);
  });

  it('records every assumption in warnings', () => {
    const r = computeRecipe(
      [{ name: 'Salt', quantity: 'to taste' }],
      1,
      INGREDIENTS,
    );
    expect(r.warnings.some((w) => w.includes('assumed 1 g'))).toBe(true);
  });

  it('marks the computation complete only when everything resolved', () => {
    const ok = computeRecipe(
      [
        { name: 'Chicken breast (raw)', quantity: '200 g' },
        { name: 'Salt', quantity: 'to taste' },
      ],
      2,
      INGREDIENTS,
    );
    expect(ok.complete).toBe(true);
    expect(ok.incomplete).toEqual([]);
    expect(ok.unresolved).toEqual([]);

    const bad = computeRecipe(
      [
        { name: 'Chicken breast (raw)', quantity: '200 g' },
        { name: 'Ginger-garlic paste', quantity: '2 tbsp' },
      ],
      2,
      INGREDIENTS,
    );
    expect(bad.complete).toBe(false);
  });

  it('marks nutrition incomplete for ranges and unknown-density volumes — never partial-complete', () => {
    const r = computeRecipe(
      [
        { name: 'Chicken breast (raw)', quantity: '2-3 tbsp' },
        { name: 'Chicken breast (raw)', quantity: '1 cup' },
        { name: 'Olive oil', quantity: '1 tbsp' },
      ],
      1,
      INGREDIENTS,
    );
    // Both chicken lines are uninterpretable (range; volume without density).
    expect(r.complete).toBe(false);
    expect(r.incomplete).toHaveLength(2);
    // Only the oil line contributes: 13.8 g × 884 kcal/100 g ≈ 122 kcal.
    expect(r.totals.kcal).toBeCloseTo(122, 0);
    expect(r.warnings.some((w) => w.includes('range'))).toBe(true);
  });

  it('rounds grams without false precision', () => {
    const r = computeRecipe([{ name: 'Olive oil', quantity: '1 tbsp' }], 1, INGREDIENTS);
    expect(r.resolved[0].grams).toBe(13.8);
    expect(r.complete).toBe(true);
  });

  it('keeps explicit grams authoritative over unit quirks', () => {
    const r = computeRecipe(
      [{ name: 'Milk (whole)', quantity: '250 ml' }],
      1,
      INGREDIENTS,
    );
    // 250 ml × 1.03 = 257.5 g of 61 kcal/100 g → ≈ 157.1 kcal.
    expect(r.totals.kcal).toBeCloseTo(157.1, 0);
    expect(r.complete).toBe(true);
  });
});
