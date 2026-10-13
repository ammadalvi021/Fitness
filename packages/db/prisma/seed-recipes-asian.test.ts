/**
 * V21 Asian recipe seed-data tests — PURE (no database).
 * The data module must be side-effect free: importing it never touches the DB.
 * Covers: catalogue size (60), per-cuisine split, unique slugs, avoid-list
 * exclusion, ingredient/step minimums, computed-nutrition shape, and the
 * needsReview ⟺ unresolved invariant from the honesty contract.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASIAN_RECIPES } from './seed-recipes-asian.js';

const AVOID_SLUGS = new Set([
  'chicken-chow-mein',
  'vegetable-fried-rice',
  'hot-and-sour-soup',
  'teriyaki-chicken-bowl',
  'vegetable-sushi-rolls',
  'bibimbap',
  'kimchi-tofu-stew',
  'green-curry-chicken',
  'shrimp-pad-thai',
]);

describe('Asian recipe catalogue size', () => {
  it('has exactly 60 recipes', () => {
    expect(ASIAN_RECIPES).toHaveLength(60);
  });

  it('has 15 recipes per cuisine', () => {
    const counts: Record<string, number> = {};
    for (const r of ASIAN_RECIPES) counts[r.cuisine] = (counts[r.cuisine] ?? 0) + 1;
    expect(counts).toEqual({ Chinese: 15, Japanese: 15, Korean: 15, Thai: 15 });
  });

  it('has unique slugs', () => {
    const slugs = ASIAN_RECIPES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('contains none of the pre-existing avoid-list slugs', () => {
    for (const r of ASIAN_RECIPES) {
      expect(AVOID_SLUGS.has(r.slug), `${r.slug} collides with an existing recipe`).toBe(false);
    }
  });
});

describe('recipe shape', () => {
  it('every recipe has >= 4 ingredients and >= 3 instruction steps', () => {
    for (const r of ASIAN_RECIPES) {
      expect(r.ingredients.length, `${r.slug}: ingredients`).toBeGreaterThanOrEqual(4);
      expect(r.instructions.length, `${r.slug}: steps`).toBeGreaterThanOrEqual(3);
      expect(r.title.trim().length, `${r.slug}: title`).toBeGreaterThan(0);
      expect(r.servings, `${r.slug}: servings`).toBeGreaterThan(0);
      expect(r.prepMin, `${r.slug}: prepMin`).toBeGreaterThanOrEqual(0);
      expect(r.cookMin, `${r.slug}: cookMin`).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses only valid enum values', () => {
    const cuisines = new Set(['Chinese', 'Japanese', 'Korean', 'Thai']);
    const meals = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink']);
    const diets = new Set(['vegetarian', 'non_vegetarian']);
    const diffs = new Set(['easy', 'medium', 'hard']);
    for (const r of ASIAN_RECIPES) {
      expect(cuisines.has(r.cuisine), `${r.slug}: cuisine`).toBe(true);
      expect(meals.has(r.mealType), `${r.slug}: mealType`).toBe(true);
      expect(diets.has(r.dietCategory), `${r.slug}: dietCategory`).toBe(true);
      expect(diffs.has(r.difficulty), `${r.slug}: difficulty`).toBe(true);
      for (const ing of r.ingredients) {
        expect(ing.name.trim().length, `${r.slug}: ingredient name`).toBeGreaterThan(0);
        expect(ing.quantity.trim().length, `${r.slug}: ingredient quantity`).toBeGreaterThan(0);
      }
    }
  });

  it('is a pure data module (no @prisma/client import, no side effects)', () => {
    const candidates = [
      join(process.cwd(), 'prisma', 'seed-recipes-asian.ts'),
      join(process.cwd(), 'packages', 'db', 'prisma', 'seed-recipes-asian.ts'),
    ];
    const srcPath = candidates.find((p) => existsSync(p));
    expect(srcPath, 'seed source file not found').toBeDefined();
    const src = readFileSync(srcPath as string, 'utf8');
    expect(src.includes("from '@prisma/client'")).toBe(false);
    expect(src.includes('from "@prisma/client"')).toBe(false);
    expect(/^\s*import\s/m.test(src), 'module has an import statement').toBe(false);
  });
});

describe('honesty contract: computed nutrition', () => {
  it('every recipe carries computed per-serving nutrition with finite, positive values', () => {
    for (const r of ASIAN_RECIPES) {
      const p = r.computed.perServing;
      for (const k of ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const) {
        expect(Number.isFinite(p[k]), `${r.slug}: ${k}`).toBe(true);
        expect(p[k], `${r.slug}: ${k}`).toBeGreaterThanOrEqual(0);
      }
      expect(p.kcal, `${r.slug}: kcal`).toBeGreaterThan(0);
      expect(Array.isArray(r.computed.unresolved), `${r.slug}: unresolved`).toBe(true);
    }
  });

  it('needsReview is true exactly when unresolved ingredients exist', () => {
    for (const r of ASIAN_RECIPES) {
      expect(r.needsReview, `${r.slug}: needsReview`).toBe(r.computed.unresolved.length > 0);
    }
  });

  it('vegan-tagged recipes are vegetarian with no animal products named', () => {
    const animal = /\b(chicken|beef|pork|mutton|fish|prawn|shrimp|crab|tuna|salmon|rohu|egg|eggs|milk|paneer|dahi|yogurt|ghee|butter|cream|cheese|khoya|honey)\b/i;
    for (const r of ASIAN_RECIPES) {
      if (r.tags.includes('vegan')) {
        expect(r.dietCategory, `${r.slug}: vegan but non_vegetarian`).toBe('vegetarian');
        const names = r.ingredients.map((i) => i.name).join(' | ')
          .replace(/coconut milk/gi, 'coconut')
          .replace(/peanut butter/gi, 'peanut');
        expect(animal.test(names), `${r.slug}: vegan but names animal product`).toBe(false);
      }
    }
  });

  it('gluten-free-tagged recipes name no wheat or soy sauce', () => {
    const gluten = /\b(maida|atta|wheat|roti|soy sauce|soya sauce)\b/i;
    for (const r of ASIAN_RECIPES) {
      if (r.tags.includes('gluten-free')) {
        const names = r.ingredients.map((i) => i.name).join(' | ');
        expect(gluten.test(names), `${r.slug}: gluten-free but names gluten source`).toBe(false);
      }
    }
  });

  it('threshold tags match the computed per-serving values', () => {
    for (const r of ASIAN_RECIPES) {
      const p = r.computed.perServing;
      if (r.tags.includes('high-protein')) expect(p.proteinG, `${r.slug}`).toBeGreaterThanOrEqual(20);
      if (r.tags.includes('high-fiber')) expect(p.fiberG, `${r.slug}`).toBeGreaterThanOrEqual(6);
      if (r.tags.includes('low-calorie')) expect(p.kcal, `${r.slug}`).toBeLessThanOrEqual(350);
    }
  });
});
