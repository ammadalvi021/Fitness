/**
 * Western recipe batch tests — PURE (no database).
 * Verifies the 60-recipe Western batch (Mediterranean/Italian/Mexican/
 * American/Continental): shape, uniqueness, no collisions with existing
 * recipe slugs, and — critically — that stored nutrition equals a FRESH
 * engine recomputation (the honesty contract: nutrition is never hand-set).
 */
import { describe, expect, it } from 'vitest';
import { computeRecipe } from '@fitfusion/core';
import { INGREDIENTS } from './seed-ingredients.js';
import { WESTERN_RECIPES } from './seed-recipes-western.js';

// Slugs that already exist in seed.ts (or are otherwise reserved) and must
// not be reused by this batch.
const AVOID_SLUGS = new Set([
  'greek-chicken-salad', 'baked-salmon-olive-tomato',
  'margherita-pizza', 'pasta-primavera', 'caprese-grilled-chicken',
  'chicken-fajitas', 'black-bean-tacos',
  'lean-beef-burger', 'grilled-chicken-caesar', 'herb-baked-chicken-vegetables',
  'quinoa-veggie-bowl',
]);

const CUISINES = ['Mediterranean', 'Italian', 'Mexican', 'American', 'Continental'] as const;
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

describe('western recipe batch size and shape', () => {
  it('has exactly 60 recipes', () => {
    expect(WESTERN_RECIPES).toHaveLength(60);
  });

  it('has 12 recipes per cuisine', () => {
    const counts = new Map<string, number>();
    for (const r of WESTERN_RECIPES) counts.set(r.cuisine, (counts.get(r.cuisine) ?? 0) + 1);
    for (const c of CUISINES) expect(counts.get(c)).toBe(12);
  });

  it('has unique slugs, none in the avoid-list', () => {
    const slugs = WESTERN_RECIPES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) {
      expect(s).toMatch(/^[a-z0-9-]+$/);
      expect(AVOID_SLUGS.has(s)).toBe(false);
    }
  });

  it('every recipe has >= 4 ingredients and >= 3 steps', () => {
    for (const r of WESTERN_RECIPES) {
      expect(r.ingredients.length, `${r.slug} ingredients`).toBeGreaterThanOrEqual(4);
      expect(r.instructions.length, `${r.slug} steps`).toBeGreaterThanOrEqual(3);
      for (const ing of r.ingredients) {
        expect(ing.name.trim().length, `${r.slug} ingredient name`).toBeGreaterThan(0);
        expect(ing.quantity.trim().length, `${r.slug} ingredient quantity`).toBeGreaterThan(0);
      }
      for (const step of r.instructions) {
        expect(step.trim().length, `${r.slug} step`).toBeGreaterThan(10);
      }
    }
  });

  it('enum fields are valid and timings are sane', () => {
    for (const r of WESTERN_RECIPES) {
      expect((CUISINES as readonly string[]).includes(r.cuisine)).toBe(true);
      expect((MEAL_TYPES as readonly string[]).includes(r.mealType)).toBe(true);
      expect((DIFFICULTIES as readonly string[]).includes(r.difficulty)).toBe(true);
      expect(['vegetarian', 'non_vegetarian']).toContain(r.dietCategory);
      expect(r.servings).toBeGreaterThanOrEqual(1);
      expect(r.prepMin).toBeGreaterThanOrEqual(0);
      expect(r.cookMin).toBeGreaterThanOrEqual(0);
      expect(r.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains no image URLs or external links', () => {
    const blob = JSON.stringify(WESTERN_RECIPES);
    expect(blob).not.toMatch(/https?:\/\//);
  });
});

describe('western recipe honesty contract', () => {
  it('every ingredient resolves; needsReview matches the v21.2 engine verdict', () => {
    for (const r of WESTERN_RECIPES) {
      expect(r.computed.unresolved, `${r.slug} unresolved`).toEqual([]);
      // v21.2: quantities the engine cannot honestly convert (fresh herbs
      // by the tbsp, bare fractions, volumes with no documented density)
      // flag needsReview. Every flag must equal a fresh computeRecipe()
      // verdict — never hand-set.
      const fresh = computeRecipe(
        r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity })),
        r.servings,
        INGREDIENTS,
      );
      expect(r.needsReview, `${r.slug} needsReview`).toBe(
        fresh.unresolved.length > 0 || fresh.incomplete.length > 0,
      );
    }
  });

  it('stored per-serving nutrition equals a fresh engine recomputation', () => {
    for (const r of WESTERN_RECIPES) {
      const fresh = computeRecipe(
        r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity })),
        r.servings,
        INGREDIENTS,
      );
      expect(fresh.unresolved, `${r.slug} fresh unresolved`).toEqual([]);
      for (const k of ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const) {
        expect(
          r.computed.perServing[k],
          `${r.slug} perServing.${k}`,
        ).toBeCloseTo(fresh.perServing[k] as number, 5);
      }
    }
  });

  it('threshold tags satisfy their numeric rules', () => {
    for (const r of WESTERN_RECIPES) {
      const ps = r.computed.perServing;
      if (r.tags.includes('high-protein')) expect(ps.proteinG, r.slug).toBeGreaterThanOrEqual(20);
      if (r.tags.includes('high-fiber')) expect(ps.fiberG, r.slug).toBeGreaterThanOrEqual(6);
      if (r.tags.includes('low-calorie')) expect(ps.kcal, r.slug).toBeLessThanOrEqual(350);
      if (r.tags.includes('gluten-free')) expect(r.allergens, r.slug).not.toContain('wheat');
      if (r.tags.includes('dairy-free')) expect(r.allergens, r.slug).not.toContain('milk');
      if (r.tags.includes('vegan')) {
        expect(r.allergens, r.slug).not.toContain('milk');
        expect(r.allergens, r.slug).not.toContain('egg');
        expect(r.dietCategory, r.slug).toBe('vegetarian');
      }
    }
  });

  it('non_vegetarian exactly matches meat/fish/seafood presence', () => {
    const meatRe = /chicken|beef|mutton|fish|rohu|salmon|tuna|prawn|shrimp/i;
    for (const r of WESTERN_RECIPES) {
      const hasMeat = r.ingredients.some((i) => meatRe.test(i.name));
      expect(r.dietCategory === 'non_vegetarian', r.slug).toBe(hasMeat);
    }
  });
});

describe('v21.2 P8 claims policy', () => {
  it("no 'halal' / 'halal-friendly' tag without a recorded human review", () => {
    // The old pork-absence inference granted 'halal' tags to 25 western
    // recipes. Under the new policy the tag requires a recorded review;
    // no batch recipe has one, so the tags must be absent.
    for (const r of WESTERN_RECIPES) {
      expect(r.tags.includes('halal'), `${r.slug} halal`).toBe(false);
      expect(r.tags.includes('halal-friendly'), `${r.slug} halal-friendly`).toBe(false);
      expect(r.halalReview ?? null, `${r.slug} halalReview`).toBeNull();
    }
  });

  it('allergen lists are name-derived (caveat applies)', () => {
    for (const r of WESTERN_RECIPES) {
      expect(r.allergenBasis ?? 'declared-from-ingredient-names').toBe(
        'declared-from-ingredient-names',
      );
    }
  });
});
