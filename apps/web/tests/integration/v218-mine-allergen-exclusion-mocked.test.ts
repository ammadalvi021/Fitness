/**
 * v21.8 P6 — allergen exclusions apply to `mine=1` (private recipes).
 *
 * EXECUTES HERE (no database): the REAL route handler (GET /api/recipes)
 * runs against an in-memory Prisma mock whose `recipe.findMany`
 * faithfully evaluates the where-clause the route builds, including the
 * conservative allergen-exclusion clause
 * (`buildAllergenExclusionWhere`): unscreened recipes are excluded from
 * filtered results, and exclusion terms resolve synonyms/canonical family
 * names ('dairy'→'milk').
 *
 * Regression coverage for the defect: the `mine=1` branch previously
 * issued `where: { userId, isPrivate: true }` with NO allergen clause, so
 * an `excludeAllergen` request was silently ignored for private recipes.
 * These tests prove the same conservative screen now applies, and assert
 * the clause is actually present in the where the route issues (never
 * silently dropped).
 */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FixtureRow {
  id: string;
  userId: string;
  isPrivate: boolean;
  title: string;
  allergenScreened: boolean;
  allergens: string[];
}

const { fixtures } = vi.hoisted(() => {
  const fixtures: FixtureRow[] = [
    // Private recipes of the test user:
    { id: 'p1', userId: 'user-1', isPrivate: true, title: 'Milky Porridge', allergenScreened: true, allergens: ['milk', 'wheat'] },
    { id: 'p2', userId: 'user-1', isPrivate: true, title: 'Plain Rice', allergenScreened: true, allergens: [] },
    { id: 'p3', userId: 'user-1', isPrivate: true, title: 'Mystery Stew', allergenScreened: false, allergens: [] },
    { id: 'p4', userId: 'user-1', isPrivate: true, title: 'Egg Curry', allergenScreened: true, allergens: ['eggs'] },
    // Belonging to someone else / public — must never appear in mine=1.
    { id: 'p5', userId: 'user-2', isPrivate: true, title: 'Other Milky Porridge', allergenScreened: true, allergens: ['milk'] },
    { id: 'p6', userId: 'user-1', isPrivate: false, title: 'Public Milky Porridge', allergenScreened: true, allergens: ['milk'] },
  ];
  return { fixtures };
});

function matchesScalar(row: FixtureRow, key: string, value: unknown): boolean {
  return (row as unknown as Record<string, unknown>)[key] === value;
}

/** Evaluate the subset of Prisma RecipeWhereInput the GET route builds. */
function matchesWhere(row: FixtureRow, where: Record<string, unknown>): boolean {
  if (where.AND && Array.isArray(where.AND)) {
    return (where.AND as Record<string, unknown>[]).every((c) => matchesWhere(row, c));
  }
  if (where.NOT) {
    const not = where.NOT as Record<string, unknown>;
    const allergens = not.allergens as { hasSome?: string[] } | undefined;
    if (allergens?.hasSome) {
      if (allergens.hasSome.some((t) => row.allergens.includes(t))) return false;
    }
  }
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'NOT') continue;
    if (!matchesScalar(row, key, value)) return false;
  }
  return true;
}

const { mocks } = vi.hoisted(() => {
  const recipe = {
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
      const rows = (fixtures as FixtureRow[]).filter((r) =>
        where ? matchesWhere(r, where) : true,
      );
      return rows.map((r) => ({
        id: r.id,
        slug: r.id,
        title: r.title,
        dietCategory: 'vegetarian',
        tags: [],
        servings: 2,
        prepMin: 10,
        cookMin: 20,
        difficulty: 'easy',
        ingredients: [],
        instructions: [],
        kcalPerServing: 200,
        proteinPerServing: 8,
        carbsPerServing: 30,
        fatPerServing: 6,
        fiberPerServing: 4,
        source: 'user',
        verified: false,
        allergens: r.allergens,
        allergenScreened: r.allergenScreened,
        userId: r.userId,
        isPrivate: r.isPrivate,
        yieldGrams: null,
        needsReview: false,
        reviewEvidence: null,
        verificationEvidence: null,
        contentHash: 'mock',
        updatedAt: new Date('2026-10-16T00:00:00Z'),
      }));
    }),
  };
  return { mocks: { recipe } };
});

vi.mock('@fitfusion/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fitfusion/db')>();
  return { ...actual, prisma: { recipe: mocks.recipe } };
});

const USER_SESSION = {
  user: { id: 'user-1', email: 'user@example.com', name: 'User' },
  profile: null,
  subscription: null,
};

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => USER_SESSION),
}));

import { GET as recipesGET } from '@/app/api/recipes/route';

async function mineGet(query: string): Promise<{ status: number; body: any }> {
  const res = (await recipesGET(
    new NextRequest(`http://localhost/api/recipes?mine=1${query}`),
  )) as NextResponse;
  return { status: res.status, body: await res.json() };
}

function titles(body: any): string[] {
  return (body.recipes as { title: string }[]).map((r) => r.title).sort();
}

function lastFindManyWhere(): Record<string, unknown> {
  const calls = mocks.recipe.findMany.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0].where as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */

describe('P6 — mine=1 allergen exclusion (mocked data layer)', () => {
  it('private SCREENED recipe containing the allergen is EXCLUDED', async () => {
    const { status, body } = await mineGet('&excludeAllergen=milk');
    expect(status).toBe(200);
    const got = titles(body);
    expect(got).not.toContain('Milky Porridge');
  });

  it('private SCREENED recipes without the allergen are INCLUDED', async () => {
    const { status, body } = await mineGet('&excludeAllergen=milk');
    expect(status).toBe(200);
    expect(titles(body)).toEqual(['Egg Curry', 'Plain Rice']);
  });

  it('private UNSCREENED recipe is EXCLUDED from filtered results (fail closed)', async () => {
    const { status, body } = await mineGet('&excludeAllergen=milk');
    expect(status).toBe(200);
    // Mystery Stew has an empty allergen list but was NEVER screened —
    // it must not be presented as though it satisfied the exclusion.
    expect(titles(body)).not.toContain('Mystery Stew');
  });

  it('without an exclusion, unscreened private recipes still appear (no filter at all)', async () => {
    const { status, body } = await mineGet('');
    expect(status).toBe(200);
    expect(titles(body)).toEqual([
      'Egg Curry',
      'Milky Porridge',
      'Mystery Stew',
      'Plain Rice',
    ]);
  });

  it('synonym resolution applies to private recipes: excludeAllergen=dairy excludes milk', async () => {
    const { status, body } = await mineGet('&excludeAllergen=dairy');
    expect(status).toBe(200);
    const got = titles(body);
    expect(got).not.toContain('Milky Porridge');
    expect(got).toEqual(['Egg Curry', 'Plain Rice']);
  });

  it('an exclusion term matching nothing screened keeps the other screened private recipes', async () => {
    const { status, body } = await mineGet('&excludeAllergen=tree-nut');
    expect(status).toBe(200);
    expect(titles(body)).toEqual(['Egg Curry', 'Milky Porridge', 'Plain Rice']);
  });

  it('other users’ private recipes and public recipes never leak into mine=1', async () => {
    const { status, body } = await mineGet('');
    expect(status).toBe(200);
    const got = titles(body);
    expect(got).not.toContain('Other Milky Porridge');
    expect(got).not.toContain('Public Milky Porridge');
  });

  it('the route actually issues the conservative clause in the where (never silently dropped)', async () => {
    await mineGet('&excludeAllergen=milk');
    const where = lastFindManyWhere();
    expect(where).toEqual({
      AND: [
        { userId: 'user-1', isPrivate: true },
        { allergenScreened: true, NOT: { allergens: { hasSome: ['milk'] } } },
      ],
    });
  });

  it('no exclusion requested → no allergen clause is issued', async () => {
    await mineGet('');
    const where = lastFindManyWhere();
    expect(where).toEqual({ AND: [{ userId: 'user-1', isPrivate: true }] });
  });

  it('unauthenticated mine=1 is still 401', async () => {
    const { requireUser } = await import('@/lib/auth');
    vi.mocked(requireUser).mockResolvedValueOnce(
      NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 }),
    );
    const { status } = await mineGet('&excludeAllergen=milk');
    expect(status).toBe(401);
  });
});
