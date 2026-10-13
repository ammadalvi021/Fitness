/**
 * Indian + Middle Eastern + Turkish recipe seed tests — PURE (no database).
 * Importing seed-recipes-indian-met.ts must never touch the DB.
 *
 * The headline honesty test re-runs computeRecipe() from @fitfusion/core
 * against the ingredient catalogue for every recipe and fails if any stored
 * computed value (or unresolved list, or needsReview flag) drifts from what
 * the engine produces. Stored nutrition is therefore engine-derived by
 * construction, never hand-written.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeRecipe } from '../../core/src/recipe-engine.js';
import { INGREDIENTS } from './seed-ingredients.js';
import { INDIAN_MET_RECIPES } from './seed-recipes-indian-met.js';

const AVOID = [
  'palak-paneer',
  'chana-masala',
  'falafel-wrap',
  'hummus-grilled-chicken-plate',
  'lentil-soup-shorbat-adas',
  'chicken-shish-kebab',
  'bulgur-pilaf',
];

const MEAT_RX = /(chicken|mutton|beef|keema|fish|rohu|prawn|salmon|tuna|\begg\b)/i;
const DAIRY_RX = /(dahi|milk|paneer|ghee|butter|cream|cheese|khoya|yogurt|halloumi)/i;
const HONEY_RX = /honey/i;
const GLUTEN_RX = /(atta|maida|sooji|roti|bulgur|pita|wheat)/i;

describe('batch shape', () => {
  it('has exactly 59 recipes (60 minus 1 cross-batch dedup)', () => {
    expect(INDIAN_MET_RECIPES).toHaveLength(59);
  });

  it('has unique kebab-case slugs', () => {
    const slugs = INDIAN_MET_RECIPES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('contains none of the avoid-list recipes', () => {
    const slugs = new Set(INDIAN_MET_RECIPES.map((r) => r.slug));
    for (const a of AVOID) expect(slugs.has(a)).toBe(false);
  });

  it('covers the per-cuisine counts (24 Indian / 20 Middle Eastern / 15 Turkish)', () => {
    const byCuisine = (c: string) => INDIAN_MET_RECIPES.filter((r) => r.cuisine === c).length;
    expect(byCuisine('Indian')).toBe(24);
    expect(byCuisine('Middle Eastern')).toBe(20);
    expect(byCuisine('Turkish')).toBe(15);
  });

  it('has >= 4 ingredients and >= 3 instructions per recipe', () => {
    for (const r of INDIAN_MET_RECIPES) {
      expect(r.ingredients.length, `${r.slug} ingredients`).toBeGreaterThanOrEqual(4);
      expect(r.instructions.length, `${r.slug} instructions`).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses only valid enums and positive servings/times', () => {
    for (const r of INDIAN_MET_RECIPES) {
      expect(['Indian', 'Middle Eastern', 'Turkish']).toContain(r.cuisine);
      expect(['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink']).toContain(r.mealType);
      expect(['vegetarian', 'non_vegetarian']).toContain(r.dietCategory);
      expect(['easy', 'medium', 'hard']).toContain(r.difficulty);
      expect(r.servings).toBeGreaterThan(0);
      expect(r.prepMin).toBeGreaterThanOrEqual(0);
      expect(r.cookMin).toBeGreaterThanOrEqual(0);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it('is a pure data module (no @prisma/client import)', () => {
    const src = readFileSync(new URL('./seed-recipes-indian-met.ts', import.meta.url), 'utf8');
    // No actual import/require of the client (the header comment may name it).
    expect(src).not.toMatch(/from\s+['"]@prisma\/client['"]/);
    expect(src).not.toMatch(/require\(\s*['"]@prisma\/client['"]\s*\)/);
    expect(src).not.toContain('http');
  });
});

describe('honesty: stored nutrition matches the engine', () => {
  for (const r of INDIAN_MET_RECIPES) {
    it(`${r.slug}: computed values equal a fresh computeRecipe() run`, () => {
      const fresh = computeRecipe(
        r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity })),
        r.servings,
        INGREDIENTS,
      );
      for (const k of ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const) {
        expect(r.computed.perServing[k], `${r.slug}.${k}`).toBeCloseTo(fresh.perServing[k], 1);
      }
      expect([...r.computed.unresolved].sort()).toEqual([...fresh.unresolved].sort());
      expect(r.needsReview).toBe(fresh.unresolved.length > 0);
    });
  }
});

describe('tag / allergen / diet derivation consistency', () => {
  for (const r of INDIAN_MET_RECIPES) {
    const names = r.ingredients.map((i) => i.name);
    const has = (rx: RegExp) => names.some((n) => rx.test(n));
    const ps = r.computed.perServing;
    const tag = (t: string) => r.tags.includes(t);

    it(`${r.slug}: nutrition tags match thresholds`, () => {
      expect(tag('high-protein')).toBe(ps.proteinG >= 20);
      expect(tag('high-fiber')).toBe(ps.fiberG >= 6);
      expect(tag('low-calorie')).toBe(ps.kcal <= 350);
    });

    it(`${r.slug}: diet tags match ingredients`, () => {
      const vegan = !has(MEAT_RX) && !has(DAIRY_RX) && !has(HONEY_RX);
      expect(tag('vegan')).toBe(vegan);
      expect(tag('gluten-free')).toBe(!has(GLUTEN_RX));
      expect(tag('dairy-free')).toBe(!has(DAIRY_RX));
      expect(tag('halal-friendly')).toBe(true);
      expect(r.dietCategory).toBe(has(MEAT_RX) ? 'non_vegetarian' : 'vegetarian');
    });

    it(`${r.slug}: allergens cover present triggers`, () => {
      if (has(DAIRY_RX)) expect(r.allergens).toContain('milk');
      if (has(/\begg\b/i)) expect(r.allergens).toContain('egg');
      if (has(/peanut/i)) expect(r.allergens).toContain('peanut');
      if (has(/(fish|rohu|salmon|tuna)/i)) expect(r.allergens).toContain('fish');
      if (has(GLUTEN_RX)) expect(r.allergens).toContain('wheat');
    });
  }
});
