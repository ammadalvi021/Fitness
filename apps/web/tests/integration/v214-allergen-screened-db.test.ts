/**
 * FitFusion AI v21.4 — ITEM 6: `Recipe.allergenScreened` column (DB-gated).
 *
 * DB-GATED: skipped when PostgreSQL is unreachable (e.g. this VM — no
 * PostgreSQL). The `dbAvailable()` guard probes the database, so even a
 * dummy DATABASE_URL results in a skip, never a connection failure.
 * Run: DATABASE_URL=postgresql://... npx vitest run
 * v214-allergen-screened-db
 *
 * Verifies the forward-only migration
 * `20261015090000_v214_recipe_allergen_screening` actually applies:
 *  - a recipe created without `allergenScreened` gets the DB default `false`;
 *  - the screening flag can be written and read back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

const SLUGS = ['v214-test-screened-a', 'v214-test-screened-b'];

describe.skipIf(!HAS_DB)('Recipe.allergenScreened (v21.4 ITEM 6)', () => {
  beforeAll(async () => {
    await prisma.recipe.deleteMany({ where: { slug: { in: SLUGS } } });
  });
  afterAll(async () => {
    await prisma.recipe.deleteMany({ where: { slug: { in: SLUGS } } });
  });

  it('defaults to false when not provided (no fabricated screening)', async () => {
    const r = await prisma.recipe.create({
      data: {
        slug: SLUGS[0],
        title: 'V214 Test Unscreened',
        dietCategory: 'vegetarian',
        servings: 1,
        prepMin: 0,
        cookMin: 0,
        difficulty: 'easy',
        ingredients: [],
        instructions: [],
        kcalPerServing: 0,
        proteinPerServing: 0,
        carbsPerServing: 0,
        fatPerServing: 0,
        fiberPerServing: 0,
        source: 'test',
      },
    });
    expect(r.allergenScreened).toBe(false);
  });

  it('records a performed screening alongside the detected list', async () => {
    const r = await prisma.recipe.create({
      data: {
        slug: SLUGS[1],
        title: 'V214 Test Screened',
        dietCategory: 'non_vegetarian',
        servings: 1,
        prepMin: 0,
        cookMin: 0,
        difficulty: 'easy',
        ingredients: [],
        instructions: [],
        kcalPerServing: 0,
        proteinPerServing: 0,
        carbsPerServing: 0,
        fatPerServing: 0,
        fiberPerServing: 0,
        source: 'test',
        allergens: ['milk', 'wheat'],
        allergenScreened: true,
      },
    });
    expect(r.allergenScreened).toBe(true);
    expect(r.allergens).toEqual(['milk', 'wheat']);
  });
});
