/**
 * FitFusion AI — v21.2 recipe alias persistence: DATABASE integration tests.
 *
 * DB-GATED: skipped when DATABASE_URL is unset (e.g. CI without Postgres).
 * Exercises the real seed alias-upsert loop and the real search where-clause
 * used by GET /api/recipes against a live PostgreSQL database.
 *
 * Run:  DATABASE_URL=postgresql://... npm run test --workspace @fitfusion/db
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  buildAliasSearchClause,
  buildRecipeAliasRows,
} from '../src/alias-normalize.js';

const prisma = new PrismaClient();
const enabled = Boolean(process.env.DATABASE_URL);

const TEST_RECIPES = [
  {
    slug: 'v212-test-peshawari-karahi',
    title: 'V212 Test Peshawari Karahi',
    aliases: ['peshawari karahi', 'chicken karahi ghee wali'],
  },
  {
    slug: 'v212-test-besan-roti',
    title: 'V212 Test Besan Roti',
    aliases: ['besan ki roti'],
  },
];

/** Verbatim alias loop from packages/db/prisma/seed.ts. */
async function seedAliases(recipeId: string, aliases: string[] | undefined) {
  const aliasRows = buildRecipeAliasRows(recipeId, aliases);
  for (const row of aliasRows) {
    await prisma.recipeAlias.upsert({
      where: {
        recipeId_normalizedAlias: {
          recipeId: row.recipeId,
          normalizedAlias: row.normalizedAlias,
        },
      },
      update: { alias: row.alias, language: row.language },
      create: row,
    });
  }
  return aliasRows.length;
}

describe.skipIf(!enabled)('recipe alias persistence (DB)', () => {
  const ids = new Map<string, string>();

  beforeAll(async () => {
    for (const t of TEST_RECIPES) {
      const recipe = await prisma.recipe.upsert({
        where: { slug: t.slug },
        update: {},
        create: {
          slug: t.slug,
          title: t.title,
          dietCategory: 'non_vegetarian',
          servings: 2,
          prepMin: 10,
          cookMin: 20,
          difficulty: 'easy',
          ingredients: [],
          instructions: [],
          kcalPerServing: 100,
          proteinPerServing: 10,
          carbsPerServing: 5,
          fatPerServing: 4,
          fiberPerServing: 1,
          source: 'test',
          verified: false,
          allergens: [],
        },
      });
      ids.set(t.slug, recipe.id);
    }
  });

  afterAll(async () => {
    // Cascade delete removes the alias rows too.
    await prisma.recipe.deleteMany({ where: { slug: { in: TEST_RECIPES.map((t) => t.slug) } } });
    await prisma.$disconnect();
  });

  it('persists every seed alias, idempotently', async () => {
    for (const t of TEST_RECIPES) {
      await seedAliases(ids.get(t.slug)!, t.aliases);
    }
    const firstCount = await prisma.recipeAlias.count({
      where: { recipeId: { in: [...ids.values()] } },
    });
    expect(firstCount).toBe(3);

    // Second run: no duplicates.
    for (const t of TEST_RECIPES) {
      await seedAliases(ids.get(t.slug)!, t.aliases);
    }
    const secondCount = await prisma.recipeAlias.count({
      where: { recipeId: { in: [...ids.values()] } },
    });
    expect(secondCount).toBe(firstCount);

    const rows = await prisma.recipeAlias.findMany({
      where: { recipeId: ids.get('v212-test-peshawari-karahi') },
      orderBy: { normalizedAlias: 'asc' },
    });
    expect(rows.map((r) => r.normalizedAlias)).toEqual([
      'chicken karahi ghee wali',
      'peshawari karahi',
    ]);
    expect(rows.every((r) => r.language === 'en' || r.language === 'roman-ur')).toBe(true);
  });

  it('finds a recipe by alias via the route search clause', async () => {
    const clause = buildAliasSearchClause('murghi ka salan');
    expect(clause).not.toBeNull();
    // 'besan ki roti' is the normalized alias of the test recipe.
    const byAlias = await prisma.recipe.findMany({
      where: { AND: [{ isPrivate: false }, buildAliasSearchClause('besan ki roti')!] },
    });
    expect(byAlias.map((r) => r.slug)).toContain('v212-test-besan-roti');
  });

  it('still finds a recipe by title (legacy behavior preserved)', async () => {
    const byTitle = await prisma.recipe.findMany({
      where: { AND: [{ isPrivate: false }, buildAliasSearchClause('V212 Test Peshawari')!] },
    });
    expect(byTitle.map((r) => r.slug)).toContain('v212-test-peshawari-karahi');
  });

  it('does not match unrelated queries', async () => {
    const none = await prisma.recipe.findMany({
      where: { AND: [{ isPrivate: false }, buildAliasSearchClause('xyznonexistentdish')!] },
    });
    expect(none.map((r) => r.slug)).not.toContain('v212-test-peshawari-karahi');
    expect(none.map((r) => r.slug)).not.toContain('v212-test-besan-roti');
  });
});
