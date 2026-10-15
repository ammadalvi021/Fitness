/**
 * GET /api/recipes — pagination contract, mocked data layer (v21.3, Worker D).
 *
 * The DB-backed pagination suite (v212-recipe-browse.test.ts) skip-guards
 * when no PostgreSQL is reachable, so on this VM the `/api/recipes` route
 * itself had ZERO executed pagination coverage. This file mocks
 * `@fitfusion/db` (the same pattern as recipe-review-mocked.test.ts) so the
 * real route handler — two-phase prisma query, `paginate()` math, page
 * slicing, tier shaping — actually executes here.
 *
 * Fixture: 6 public recipes with title-sorted names; the mock answers the
 * two `findMany` calls the route makes (candidate ids, then full rows).
 * Filter semantics are NOT exercised by the mock (the where-clause is
 * ignored) — those live in the DB suite. What IS pinned:
 *  - page 2 returns different recipes than page 1 (stable order);
 *  - `total` / `pageCount` / `pageSize` are internally consistent;
 *  - out-of-range pages clamp to a real page and return that page's recipes;
 *  - the server-computed `tier` is present on every returned recipe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

interface FixtureRow {
  id: string;
  slug: string;
  title: string;
  prepMin: number;
  cookMin: number;
}

const { fixtures } = vi.hoisted(() => {
  const fixtures: FixtureRow[] = [
    { id: 'r1', slug: 'apple-porridge', title: 'Apple Porridge', prepMin: 5, cookMin: 10 },
    { id: 'r2', slug: 'banana-smoothie', title: 'Banana Smoothie', prepMin: 5, cookMin: 0 },
    { id: 'r3', slug: 'chana-chaat', title: 'Chana Chaat', prepMin: 15, cookMin: 0 },
    { id: 'r4', slug: 'daal-tadka', title: 'Daal Tadka', prepMin: 10, cookMin: 30 },
    { id: 'r5', slug: 'egg-curry', title: 'Egg Curry', prepMin: 10, cookMin: 25 },
    { id: 'r6', slug: 'fruit-chaat', title: 'Fruit Chaat', prepMin: 15, cookMin: 0 },
  ];
  return { fixtures };
});

vi.mock('@fitfusion/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fitfusion/db')>();
  return {
    ...actual,
    prisma: {
      // getSessionUser (real, from @/lib/auth) reads the session first;
      // no cookie on these requests, but the mock stays total.
      session: { findUnique: vi.fn(async () => null) },
      recipe: {
        findMany: vi.fn(async (args: Record<string, unknown>) => {
          if (args.select && !args.include) {
            // Phase 1: candidate ids in (mocked) title order.
            return fixtures.map(({ id, prepMin, cookMin }) => ({ id, prepMin, cookMin }));
          }
          if (args.include && args.where && typeof args.where === 'object') {
            // Phase 2: full rows for the requested page ids.
            const ids = (
              (args.where as { id?: { in?: string[] } }).id?.in ?? []
            );
            return ids.map((id) => {
              const f = fixtures.find((x) => x.id === id)!;
              return {
                id: f.id,
                slug: f.slug,
                title: f.title,
                dietCategory: 'vegetarian',
                tags: ['vegetarian'],
                servings: 2,
                prepMin: f.prepMin,
                cookMin: f.cookMin,
                difficulty: 'easy',
                ingredients: [],
                instructions: [],
                kcalPerServing: 200,
                proteinPerServing: 8,
                carbsPerServing: 30,
                fatPerServing: 6,
                fiberPerServing: 4,
                source: 'seed',
                verified: false,
                verificationEvidence: null,
                reviewEvidence: null,
                allergens: [],
                userId: null,
                isPrivate: false,
                cuisine: { id: 'c1', name: 'Pakistani' },
              };
            });
          }
          return [];
        }),
      },
    },
  };
});

import { GET as recipesGET } from '@/app/api/recipes/route';
import { readJson } from './helpers';

async function getRecipes(url: string) {
  const res = await recipesGET(new NextRequest(`http://localhost${url}`));
  expect(res.status).toBe(200);
  return readJson(res);
}

const idsOf = (body: { recipes: { id: string }[] }) =>
  body.recipes.map((r) => r.id);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/recipes pagination (mocked data layer)', () => {
  it('page 2 returns different recipes than page 1; total/pageCount consistent', async () => {
    const p1 = await getRecipes('/api/recipes?pageSize=2');
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(2);
    expect(p1.limit).toBe(2); // legacy alias
    expect(p1.total).toBe(6);
    expect(p1.pageCount).toBe(3); // ceil(6/2)
    expect(idsOf(p1)).toEqual(['r1', 'r2']);

    const p2 = await getRecipes('/api/recipes?page=2&pageSize=2');
    expect(p2.page).toBe(2);
    expect(p2.total).toBe(6);
    expect(p2.pageCount).toBe(3);
    expect(idsOf(p2)).toEqual(['r3', 'r4']);

    // No recipe appears on both pages.
    const page1 = new Set(idsOf(p1));
    for (const id of idsOf(p2)) expect(page1.has(id)).toBe(false);
  });

  it('page 3 holds the last slice', async () => {
    const p3 = await getRecipes('/api/recipes?page=3&pageSize=2');
    expect(p3.page).toBe(3);
    expect(idsOf(p3)).toEqual(['r5', 'r6']);
  });

  it('an out-of-range page clamps to the last page and returns its recipes', async () => {
    const beyond = await getRecipes('/api/recipes?page=99&pageSize=2');
    expect(beyond.page).toBe(3);
    expect(beyond.pageCount).toBe(3);
    expect(beyond.total).toBe(6);
    expect(idsOf(beyond)).toEqual(['r5', 'r6']);
  });

  it('page=0 clamps to page 1', async () => {
    const p0 = await getRecipes('/api/recipes?page=0&pageSize=2');
    expect(p0.page).toBe(1);
    expect(idsOf(p0)).toEqual(['r1', 'r2']);
  });

  it('every returned recipe carries the server-computed tier', async () => {
    const p1 = await getRecipes('/api/recipes?pageSize=2');
    for (const r of p1.recipes as { tier: string }[]) {
      expect(r.tier).toBe('calculated-estimate');
    }
  });
});
