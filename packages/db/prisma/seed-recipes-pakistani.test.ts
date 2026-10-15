/**
 * Pakistani recipe batch (v21) tests — PURE (no database).
 * Importing seed-recipes-pakistani.ts must never touch the DB.
 *
 * Guards the honesty contract:
 *  - exactly 60 recipes, unique kebab-case slugs, none on the avoid list,
 *    none colliding with existing seed.ts slugs;
 *  - structural minimums (>=4 ingredients, >=3 steps, valid enums);
 *  - stored nutrition === engine recomputation (never hand-adjusted);
 *  - needsReview === (unresolved.length > 0 || incomplete.length > 0)
 *    (v21.2: an uninterpretable quantity or unknown grams also flags review);
 *  - tags are valid against ingredient names (vegan/dairy-free/gluten-free
 *    claims checked programmatically) and against the
 *    computed per-serving values (high-protein/high-fiber/low-calorie);
 *  - v21.2 P8 claims policy: 'halal-friendly' requires a recorded human
 *    review — the old pork-absence inference is asserted dead.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRecipe } from '@fitfusion/core';
import { INGREDIENTS } from './seed-ingredients.js';
import { PAKISTANI_RECIPES } from './seed-recipes-pakistani.js';

const AVOID = ['light-chicken-karahi', 'masoor-daal', 'chicken-tikka', 'vegetable-biryani'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const DIET_CATEGORIES = ['vegetarian', 'non_vegetarian'];
const KNOWN_TAGS = ['vegan', 'gluten-free', 'dairy-free', 'halal-friendly', 'high-protein', 'high-fiber', 'low-calorie'];

function toks(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
}
const hasToken = (names: string[], set: Set<string>) =>
  names.some((n) => toks(n).some((t) => set.has(t)));

const MEAT = new Set(['chicken', 'beef', 'mutton', 'fish', 'rohu', 'prawn', 'prawns', 'shrimp', 'tuna', 'salmon', 'liver', 'keema', 'drumstick', 'thigh', 'breast', 'wings']);
const EGG = new Set(['egg', 'eggs', 'anda', 'anday']);
const DAIRY = new Set(['dahi', 'yogurt', 'curd', 'milk', 'ghee', 'paneer', 'butter', 'cream', 'malai', 'khoya', 'khoa', 'mawa', 'cheese', 'doodh']);
const HONEY = new Set(['honey', 'shehad']);
const WHEAT = new Set(['atta', 'maida', 'roti', 'chapati', 'phulka', 'paratha', 'wheat', 'semolina', 'sooji', 'suji', 'barley', 'rye']);

const SEED_TS_SLUGS: Set<string> = new Set(
  [...readFileSync(resolve(process.cwd(), 'prisma/seed.ts'), 'utf8').matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]),
);

describe('pakistani recipe batch', () => {
  it('has exactly 60 recipes', () => {
    expect(PAKISTANI_RECIPES.length).toBe(60);
  });

  it('has unique kebab-case slugs, none avoided or colliding with seed.ts', () => {
    const slugs = PAKISTANI_RECIPES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) {
      expect(s).toMatch(/^[a-z0-9-]+$/);
      expect(AVOID).not.toContain(s);
      expect(SEED_TS_SLUGS.has(s)).toBe(false);
    }
  });

  it('every recipe is Pakistani with valid enums, >=4 ingredients and >=3 steps', () => {
    for (const r of PAKISTANI_RECIPES) {
      expect(r.cuisine).toBe('Pakistani');
      expect(MEAL_TYPES).toContain(r.mealType);
      expect(DIFFICULTIES).toContain(r.difficulty);
      expect(DIET_CATEGORIES).toContain(r.dietCategory);
      expect(r.servings).toBeGreaterThanOrEqual(1);
      expect(r.ingredients.length).toBeGreaterThanOrEqual(4);
      expect(r.instructions.length).toBeGreaterThanOrEqual(3);
      for (const t of r.tags) expect(KNOWN_TAGS).toContain(t);
    }
  });

  it('stored nutrition equals a fresh engine recomputation (never hand-adjusted)', () => {
    for (const r of PAKISTANI_RECIPES) {
      const c = computeRecipe(
        r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity })),
        r.servings,
        INGREDIENTS,
      );
      for (const k of ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const) {
        expect(Math.abs(c.perServing[k] - r.computed.perServing[k])).toBeLessThanOrEqual(0.051);
      }
      expect([...c.unresolved].sort()).toEqual([...r.computed.unresolved].sort());
      // v21.2: incomplete quantities (ranges, bare fractions, volumes with
      // no documented density) also flag review — never silently partial.
      expect(r.needsReview).toBe(c.unresolved.length > 0 || c.incomplete.length > 0);
    }
  });

  it('diet-derived tags are valid against ingredient names', () => {
    for (const r of PAKISTANI_RECIPES) {
      const names = r.ingredients.map((i) => i.name);
      const tags = new Set(r.tags);
      if (tags.has('vegan')) {
        expect(hasToken(names, MEAT) || hasToken(names, EGG) || hasToken(names, DAIRY) || hasToken(names, HONEY)).toBe(false);
        expect(r.dietCategory).toBe('vegetarian');
      }
      if (tags.has('dairy-free')) expect(hasToken(names, DAIRY)).toBe(false);
      if (tags.has('gluten-free')) expect(hasToken(names, WHEAT)).toBe(false);
      // v21.2 P8: pork-absence alone NEVER grants 'halal-friendly'. The tag
      // requires a recorded human review (halalReview). No batch recipe has
      // one, so none may carry the tag — this fails if the old inference
      // ("no pork ⟹ halal-friendly") ever returns.
      expect(tags.has('halal-friendly'), `${r.slug} halal-friendly`).toBe(
        Boolean(r.halalReview),
      );
      // completeness: qualifying recipes must carry the tag
      if (!hasToken(names, MEAT) && !hasToken(names, EGG) && !hasToken(names, DAIRY) && !hasToken(names, HONEY)) {
        expect(tags.has('vegan')).toBe(true);
      }
      if (!hasToken(names, DAIRY)) expect(tags.has('dairy-free')).toBe(true);
      if (!hasToken(names, WHEAT)) expect(tags.has('gluten-free')).toBe(true);
    }
  });

  it('nutrient-derived tags match the computed per-serving values', () => {
    for (const r of PAKISTANI_RECIPES) {
      const ps = r.computed.perServing;
      const tags = new Set(r.tags);
      expect(tags.has('high-protein')).toBe(ps.proteinG >= 20 - 0.051);
      expect(tags.has('high-fiber')).toBe(ps.fiberG >= 6 - 0.051);
      expect(tags.has('low-calorie')).toBe(ps.kcal <= 350 + 0.051);
    }
  });

  it('review flags match a fresh v21.2 engine run (never hand-set)', () => {
    // v21.2 replaced the "zero flags" expectation: quantities the engine
    // cannot honestly convert (fresh herbs by the tbsp, bare fractions,
    // volumes with no documented density) flag needsReview. Every flag must
    // equal a fresh computeRecipe() verdict.
    for (const r of PAKISTANI_RECIPES) {
      const c = computeRecipe(
        r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity })),
        r.servings,
        INGREDIENTS,
      );
      expect(r.needsReview).toBe(c.unresolved.length > 0 || c.incomplete.length > 0);
      expect(r.computed.unresolved).toEqual([]);
      if (r.needsReview) {
        expect(c.incomplete.length).toBeGreaterThan(0);
      }
    }
  });
});
