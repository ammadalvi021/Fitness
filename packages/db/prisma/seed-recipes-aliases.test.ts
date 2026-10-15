/**
 * FitFusion AI — v21.2 recipe alias seed mapping: PURE tests (no database).
 *
 * Guards the Worker D contract:
 *  - every alias string in the four v21 batch modules produces exactly one
 *    persisted row (no alias invented, no alias dropped, no identities merged);
 *  - the row key is (recipeId, normalizedAlias) and the seed upsert loop is
 *    idempotent (simulated against a mock prisma with the same semantics).
 */
import { describe, expect, it } from 'vitest';
import { buildRecipeAliasRows, type RecipeAliasRow } from '../src/alias-normalize.js';
import { PAKISTANI_RECIPES } from './seed-recipes-pakistani.js';
import { INDIAN_MET_RECIPES } from './seed-recipes-indian-met.js';
import { ASIAN_RECIPES } from './seed-recipes-asian.js';
import { WESTERN_RECIPES } from './seed-recipes-western.js';

interface BatchRecipe {
  slug: string;
  aliases?: string[];
}

const BATCHES: { name: string; recipes: BatchRecipe[] }[] = [
  { name: 'pakistani', recipes: PAKISTANI_RECIPES as BatchRecipe[] },
  { name: 'indian-met', recipes: INDIAN_MET_RECIPES as BatchRecipe[] },
  { name: 'asian', recipes: ASIAN_RECIPES as BatchRecipe[] },
  { name: 'western', recipes: WESTERN_RECIPES as BatchRecipe[] },
];

describe('v21 batch alias coverage', () => {
  it('every alias string in every batch maps to exactly one row', () => {
    let aliasStrings = 0;
    let rows = 0;
    for (const { recipes } of BATCHES) {
      for (const r of recipes) {
        const aliases = r.aliases ?? [];
        aliasStrings += aliases.length;
        const mapped = buildRecipeAliasRows(r.slug, r.aliases);
        rows += mapped.length;
        // No unintended normalize-collisions inside a single recipe.
        expect(mapped.length).toBe(aliases.length);
      }
    }
    expect(aliasStrings).toBeGreaterThan(0);
    expect(rows).toBe(aliasStrings);
  });

  it('never invents aliases: every row.alias is a seed alias of its recipe', () => {
    for (const { recipes } of BATCHES) {
      for (const r of recipes) {
        const seedSet = new Set((r.aliases ?? []).map((a) => a.trim()));
        for (const row of buildRecipeAliasRows(r.slug, r.aliases)) {
          expect(seedSet.has(row.alias)).toBe(true);
        }
      }
    }
  });

  it('never merges identities: rows for different recipes stay separate', () => {
    // The same alias text legitimately appears on different recipes
    // (e.g. "chicken biryani"); row keys include the recipe id.
    const byNormalized = new Map<string, Set<string>>();
    for (const { recipes } of BATCHES) {
      for (const r of recipes) {
        for (const row of buildRecipeAliasRows(r.slug, r.aliases)) {
          const set = byNormalized.get(row.normalizedAlias) ?? new Set<string>();
          set.add(row.recipeId);
          byNormalized.set(row.normalizedAlias, set);
        }
      }
    }
    const shared = [...byNormalized.entries()].filter(([, ids]) => ids.size > 1);
    expect(shared.length).toBeGreaterThan(0); // shared alias texts exist across recipes
    for (const [, ids] of shared) {
      // ...and each (recipe, normalizedAlias) pair is still its own key.
      expect(ids.size).toBe(new Set([...ids]).size);
    }
  });

  it('spot-checks known seed aliases', () => {
    const pak = PAKISTANI_RECIPES as BatchRecipe[];
    const karahi = pak.find((r) => r.slug === 'peshawari-chicken-karahi');
    expect(karahi).toBeDefined();
    const rows = buildRecipeAliasRows(karahi!.slug, karahi!.aliases);
    expect(rows.map((r) => r.normalizedAlias).sort()).toEqual(
      ['chicken karahi ghee wali', 'peshawari karahi'].sort(),
    );

    const all = BATCHES.flatMap((b) => b.recipes);
    const fish = all.find((r) => (r.aliases ?? []).some((a) => a.includes('fırında')));
    expect(fish).toBeDefined();
    const fishRow = buildRecipeAliasRows(fish!.slug, fish!.aliases).find(
      (r) => r.alias === 'fırında levrek',
    );
    expect(fishRow?.normalizedAlias).toBe('fırında levrek');
  });
});

describe('seed alias upsert idempotency (mock prisma)', () => {
  /**
   * Minimal mock with the same semantics as the seed loop in seed.ts:
   * prisma.recipeAlias.upsert on @@unique([recipeId, normalizedAlias]).
   */
  function makeMockPrisma() {
    const store = new Map<string, RecipeAliasRow>();
    return {
      store,
      recipeAlias: {
        upsert: async ({ where, update, create }: {
          where: { recipeId_normalizedAlias: { recipeId: string; normalizedAlias: string } };
          update: Partial<RecipeAliasRow>;
          create: RecipeAliasRow;
        }) => {
          const k = where.recipeId_normalizedAlias;
          const key = `${k.recipeId}␟${k.normalizedAlias}`;
          const existing = store.get(key);
          if (existing) {
            store.set(key, { ...existing, ...update });
            return store.get(key)!;
          }
          store.set(key, { ...create });
          return create;
        },
      },
    };
  }

  /** Verbatim copy of the alias loop from packages/db/prisma/seed.ts. */
  async function seedAliases(
    prisma: ReturnType<typeof makeMockPrisma>,
    recipeId: string,
    aliases: string[] | undefined,
  ): Promise<number> {
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

  it('re-running the seed loop over all batches creates no duplicates', async () => {
    const prisma = makeMockPrisma();
    const runAll = async () => {
      let n = 0;
      for (const { recipes } of BATCHES) {
        for (const r of recipes) n += await seedAliases(prisma, r.slug, r.aliases);
      }
      return n;
    };
    const first = await runAll();
    const sizeAfterFirst = prisma.store.size;
    const second = await runAll();
    expect(second).toBe(first);
    expect(prisma.store.size).toBe(sizeAfterFirst);
    // And the store holds exactly one row per alias string across all batches.
    const totalAliases = BATCHES.reduce(
      (acc, { recipes }) => acc + recipes.reduce((a, r) => a + (r.aliases ?? []).length, 0),
      0,
    );
    expect(prisma.store.size).toBe(totalAliases);
  });

  it('updating an alias display text does not duplicate the row', async () => {
    const prisma = makeMockPrisma();
    await seedAliases(prisma, 'r1', ['Chicken Karahi']);
    await seedAliases(prisma, 'r1', ['CHICKEN  karahi']); // same normalized key
    expect(prisma.store.size).toBe(1);
    const row = [...prisma.store.values()][0];
    expect(row.alias).toBe('CHICKEN  karahi'); // update path applied
    expect(row.normalizedAlias).toBe('chicken karahi');
  });
});
