/**
 * V21.2 (P5) — recipe library accessibility.
 *
 * Pure suite (runs without a database): tag normalization / where-builder /
 * pagination math, plus filter semantics against a small inline fixture.
 *
 * DB suite (skipped gracefully when no PostgreSQL is reachable): real
 * pagination across pages, server-side tag/allergen/kcal/time/cuisine
 * filters, and the /api/recipes/meta vocabulary endpoint.
 *
 * NOTE on seed modules: the v21 batch seed files are another worker's ground
 * and two of them currently break tsc the moment they enter a program —
 * seed-recipes-western.ts has ingredients missing the required `grams`
 * field, and seed-recipes-asian.ts has a duplicated
 * `export interface RecipeSeed {` line (asian.ts:41-42). packages/db never
 * typechecks seed files (tsconfig includes only `src`), so both defects were
 * invisible until imported. Inventing gram weights to silence the checker
 * would be data fabrication, so the pure suite uses an inline fixture and
 * the DB-backed suite (full table, all batches) covers the whole library
 * in CI.
 */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import {
  buildRecipeTagWhere,
  DEFAULT_PAGE_SIZE,
  expandRecipeTagVariants,
  MAX_PAGE_SIZE,
  normalizeRecipeTag,
  paginate,
  recipeMatchesTags,
} from '@/lib/recipe-tags';
import { GET as recipesGET } from '@/app/api/recipes/route';
import { GET as metaGET } from '@/app/api/recipes/meta/route';
import { readJson } from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

/* ------------------------------------------------------------------ */
/* Pure: tag normalization                                             */
/* ------------------------------------------------------------------ */

describe('recipe tag normalization (pure)', () => {
  it('canonicalizes halal-friendly to halal', () => {
    expect(normalizeRecipeTag('halal-friendly')).toBe('halal');
    expect(normalizeRecipeTag('  Halal-Friendly ')).toBe('halal');
  });

  it('lowercases and trims ordinary tags', () => {
    expect(normalizeRecipeTag('Low-Calorie')).toBe('low-calorie');
    expect(normalizeRecipeTag(' vegan ')).toBe('vegan');
  });

  it('passes unknown tags through unchanged (no invented matches)', () => {
    expect(normalizeRecipeTag('keto')).toBe('keto');
  });

  it('expands halal to both stored spellings', () => {
    expect(expandRecipeTagVariants('halal')).toEqual(['halal', 'halal-friendly']);
    expect(expandRecipeTagVariants('vegan')).toEqual(['vegan']);
  });

  it('builds AND-of-ORs where clauses for multiple tags', () => {
    expect(buildRecipeTagWhere([])).toBeNull();
    expect(buildRecipeTagWhere(['halal'])).toEqual({
      AND: [
        {
          OR: [
            { tags: { has: 'halal' } },
            { tags: { has: 'halal-friendly' } },
          ],
        },
      ],
    });
    expect(buildRecipeTagWhere(['halal', 'vegan'])).toEqual({
      AND: [
        {
          OR: [
            { tags: { has: 'halal' } },
            { tags: { has: 'halal-friendly' } },
          ],
        },
        { OR: [{ tags: { has: 'vegan' } }] },
      ],
    });
  });

  it('treats halal-friendly identically to halal in the where builder', () => {
    expect(buildRecipeTagWhere(['halal-friendly'])).toEqual(
      buildRecipeTagWhere(['halal']),
    );
  });

  it('dedupes repeated tags', () => {
    expect(buildRecipeTagWhere(['vegan', 'Vegan'])).toEqual({
      AND: [{ OR: [{ tags: { has: 'vegan' } }] }],
    });
  });
});

describe('recipe tag matcher semantics (pure)', () => {
  it('matches either halal spelling', () => {
    expect(recipeMatchesTags(['halal'], ['halal'])).toBe(true);
    expect(recipeMatchesTags(['halal-friendly'], ['halal'])).toBe(true);
    expect(recipeMatchesTags(['halal-friendly'], ['halal-friendly'])).toBe(true);
    expect(recipeMatchesTags(['vegan'], ['halal'])).toBe(false);
  });

  it('requires ALL wanted tags (AND semantics)', () => {
    expect(recipeMatchesTags(['halal', 'vegan'], ['halal', 'vegan'])).toBe(true);
    expect(recipeMatchesTags(['halal-friendly', 'vegan'], ['halal', 'vegan'])).toBe(true);
    expect(recipeMatchesTags(['halal'], ['halal', 'vegan'])).toBe(false);
    expect(recipeMatchesTags([], ['halal'])).toBe(false);
  });

  it('empty wanted list matches everything', () => {
    expect(recipeMatchesTags(['halal'], [])).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Pure: pagination math                                               */
/* ------------------------------------------------------------------ */

describe('pagination math (pure)', () => {
  it('computes pages for a full library', () => {
    expect(paginate(270, 1, 24)).toEqual({
      page: 1, pageCount: 12, skip: 0, take: 24, from: 1, to: 24,
    });
    expect(paginate(270, 12, 24)).toMatchObject({
      page: 12, skip: 264, from: 265, to: 270,
    });
  });

  it('handles an empty result set', () => {
    expect(paginate(0, 1, 24)).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0 });
  });

  it('clamps out-of-range pages', () => {
    expect(paginate(50, 99, 24).page).toBe(3); // ceil(50/24)
    expect(paginate(50, 0, 24).page).toBe(1);
    expect(paginate(50, -2, 24).page).toBe(1);
  });

  it('exposes the documented page-size contract', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect(MAX_PAGE_SIZE).toBe(48);
  });
});

/* ------------------------------------------------------------------ */
/* Pure: filter semantics against a small seeded fixture               */
/* ------------------------------------------------------------------ */

/** Small fixture mirroring real tag spellings from the seed corpus. */
const FIXTURE = [
  { title: 'Light Chicken Karahi', tags: ['halal', 'high-protein', 'dairy-free'] },
  { title: 'Daal Tadka', tags: ['vegan', 'high-fiber', 'budget-friendly', 'gluten-free', 'dairy-free'] },
  { title: 'Chicken Salad', tags: ['halal-friendly', 'high-protein', 'low-calorie'] },
  { title: 'Veg Biryani', tags: ['vegan', 'low-sodium', 'halal'] },
  { title: 'Milk Cake', tags: ['vegetarian'] },
];

describe('tag filter semantics against a seeded fixture (pure)', () => {
  it('halal matches both stored spellings and nothing else', () => {
    const hits = FIXTURE.filter((r) => recipeMatchesTags(r.tags, ['halal']));
    expect(hits.map((r) => r.title).sort()).toEqual(
      ['Chicken Salad', 'Light Chicken Karahi', 'Veg Biryani'].sort(),
    );
  });

  it('halal-friendly is the same filter as halal', () => {
    const a = FIXTURE.filter((r) => recipeMatchesTags(r.tags, ['halal']));
    const b = FIXTURE.filter((r) => recipeMatchesTags(r.tags, ['halal-friendly']));
    expect(a).toEqual(b);
    // And the DB where-clauses are identical too.
    expect(buildRecipeTagWhere(['halal-friendly'])).toEqual(buildRecipeTagWhere(['halal']));
  });

  it('multiple tags use AND semantics', () => {
    const hits = FIXTURE.filter((r) => recipeMatchesTags(r.tags, ['halal', 'vegan']));
    expect(hits.map((r) => r.title)).toEqual(['Veg Biryani']);
  });

  it('offered dietary tags each match at least one fixture recipe', () => {
    for (const tag of [
      'vegan', 'halal', 'high-protein', 'low-sodium', 'dairy-free',
      'gluten-free', 'high-fiber', 'budget-friendly', 'low-calorie',
    ]) {
      expect(
        FIXTURE.filter((r) => recipeMatchesTags(r.tags, [tag])).length,
        tag,
      ).toBeGreaterThan(0);
    }
  });

  it('unknown tags match nothing (no invented matches)', () => {
    expect(FIXTURE.filter((r) => recipeMatchesTags(r.tags, ['keto']))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* DB-backed: real pagination, server-side filters, meta endpoint       */
/* ------------------------------------------------------------------ */

const EXPECTED_CUISINES = [
  'Pakistani', 'Indian', 'Chinese', 'Japanese', 'Korean', 'Thai',
  'Italian', 'Mediterranean', 'Middle Eastern', 'Turkish',
  'American', 'Mexican', 'Continental',
];

const KNOWN_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'dessert']);

async function getRecipes(url: string) {
  const res = await recipesGET(new NextRequest(`http://localhost${url}`));
  expect(res.status).toBe(200);
  return readJson(res);
}

describe.skipIf(!HAS_DB)('V21.2 recipe browse: pagination (DB)', () => {
  it('returns total/pageCount and page-2 recipes are distinct from page-1', async () => {
    const p1 = await getRecipes('/api/recipes?pageSize=24');
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(24);
    expect(p1.limit).toBe(24); // legacy alias
    expect(p1.pageCount).toBe(Math.max(1, Math.ceil(p1.total / 24)));
    expect(p1.recipes.length).toBeLessThanOrEqual(24);

    if (p1.total > 24) {
      const p2 = await getRecipes('/api/recipes?page=2&pageSize=24');
      expect(p2.page).toBe(2);
      const ids1 = new Set(p1.recipes.map((r: { id: string }) => r.id));
      const ids2 = p2.recipes.map((r: { id: string }) => r.id);
      expect(ids2.length).toBeGreaterThan(0);
      for (const id of ids2) expect(ids1.has(id)).toBe(false);
    }
  });

  it('caps pageSize at 48', async () => {
    const body = await getRecipes('/api/recipes?pageSize=500');
    expect(body.pageSize).toBe(48);
    expect(body.recipes.length).toBeLessThanOrEqual(48);
  });

  it('later pages are reachable and disjoint', async () => {
    const p1 = await getRecipes('/api/recipes?pageSize=48');
    if (p1.total > 48) {
      const p2 = await getRecipes('/api/recipes?page=2&pageSize=48');
      const ids1 = new Set(p1.recipes.map((r: { id: string }) => r.id));
      for (const r of p2.recipes) expect(ids1.has(r.id)).toBe(false);
    }
  });
});

describe.skipIf(!HAS_DB)('V21.2 recipe browse: server-side filters (DB)', () => {
  it('tag=halal matches halal and halal-friendly spellings only', async () => {
    const body = await getRecipes('/api/recipes?tag=halal&pageSize=48');
    for (const r of body.recipes) {
      expect(recipeMatchesTags(r.tags, ['halal'])).toBe(true);
    }
  });

  it('multiple tags use AND semantics', async () => {
    const body = await getRecipes('/api/recipes?tag=halal&tag=vegan&pageSize=48');
    for (const r of body.recipes) {
      expect(recipeMatchesTags(r.tags, ['halal', 'vegan'])).toBe(true);
    }
  });

  it('excludeAllergen removes matching recipes', async () => {
    const body = await getRecipes('/api/recipes?excludeAllergen=milk&pageSize=48');
    for (const r of body.recipes) {
      expect(
        (r.allergens as string[]).map((a) => a.toLowerCase()).includes('milk'),
      ).toBe(false);
    }
  });

  it('maxTime bounds prep+cook for every returned recipe', async () => {
    const body = await getRecipes('/api/recipes?maxTime=30&pageSize=48');
    for (const r of body.recipes) {
      expect(r.prepMin + r.cookMin).toBeLessThanOrEqual(30);
    }
  });

  it('minKcal/maxKcal bound kcalPerServing', async () => {
    const body = await getRecipes('/api/recipes?minKcal=200&maxKcal=400&pageSize=48');
    for (const r of body.recipes) {
      expect(r.kcalPerServing).toBeGreaterThanOrEqual(200);
      expect(r.kcalPerServing).toBeLessThanOrEqual(400);
    }
  });

  it('cuisine filter matches the full cuisine name', async () => {
    const body = await getRecipes('/api/recipes?cuisine=Pakistani&pageSize=48');
    for (const r of body.recipes) {
      expect(r.cuisine?.name).toBe('Pakistani');
    }
  });

  it('difficulty and mealType filters match exactly', async () => {
    const d = await getRecipes('/api/recipes?difficulty=easy&pageSize=48');
    for (const r of d.recipes) expect(r.difficulty).toBe('easy');
    const m = await getRecipes('/api/recipes?mealType=dinner&pageSize=48');
    for (const r of m.recipes) expect(r.mealType).toBe('dinner');
  });

  it('rejects an invalid difficulty', async () => {
    const res = await recipesGET(
      new NextRequest('http://localhost/api/recipes?difficulty=extreme'),
    );
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!HAS_DB)('V21.2 recipe browse: meta endpoint (DB)', () => {
  it('returns vocabularies derived from the full table', async () => {
    const res = await metaGET();
    expect(res.status).toBe(200);
    const body = await readJson(res);

    const cuisineNames = body.cuisines.map((c: { name: string }) => c.name);
    for (const c of EXPECTED_CUISINES) expect(cuisineNames).toContain(c);
    const totalCount = body.cuisines.reduce(
      (n: number, c: { count: number }) => n + c.count,
      0,
    );
    expect(totalCount).toBe(await prisma.recipe.count({ where: { isPrivate: false } }));

    const tagNames = body.tags.map((t: { tag: string }) => t.tag);
    expect(tagNames).not.toContain('halal-friendly'); // merged into halal
    for (const tag of ['halal', 'low-sodium', 'budget-friendly', 'low-calorie', 'vegan']) {
      const row = body.tags.find((t: { tag: string }) => t.tag === tag);
      expect(row?.count, tag).toBeGreaterThan(0);
    }

    for (const m of body.mealTypes as string[]) expect(KNOWN_MEAL_TYPES.has(m)).toBe(true);
    expect(body.difficulties as string[]).toEqual(
      expect.arrayContaining(['easy', 'medium', 'hard']),
    );
    expect((body.allergens as unknown[]).length).toBeGreaterThan(0);
  });
});
