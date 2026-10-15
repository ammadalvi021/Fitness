/**
 * Custom recipe creation — diet category + allergen screening (v21.4 ITEM 6).
 * Mocked, runs without a database.
 *
 * Mocks `@fitfusion/db` (in-memory recipe create + a tiny food catalogue for
 * the real `resolveIngredientRows`) and `@/lib/auth` (fixed session). The
 * REAL POST route, the REAL `CustomRecipeSchema`, the REAL
 * `resolveIngredientRows`/`recipeNutrition`, and the REAL
 * `screenIngredientAllergens` execute:
 *
 *  - omitted dietCategory → 400 validation_error; nothing is created;
 *  - unknown dietCategory → 400;
 *  - meat recipe + explicit non_vegetarian → stored as non_vegetarian
 *    (never defaulted to vegetarian);
 *  - name-based screening runs at creation: wheat/milk/eggs/peanuts are
 *    detected from ingredient names and stored in `allergens` with
 *    `allergenScreened: true`;
 *  - a recipe whose names trigger nothing stores [] WITH screened=true
 *    ("nothing detected" — not a safety promise).
 *
 * The unscreened display path (screened=false → "screening not performed",
 * never "none declared") is a client-side copy rule in
 * apps/web/app/(app)/recipes/[slug]/page.tsx — asserted here via the
 * persisted flag contract, not via a browser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const { JSON_NULL } = vi.hoisted(() => ({ JSON_NULL: Symbol('prisma-json-null') }));

// ---- mocks (hoisted above imports) ----
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  getSessionUser: vi.fn(),
}));
vi.mock('@/lib/admin', () => ({
  isAdmin: () => false,
}));
vi.mock('@fitfusion/db', () => {
  const created: Record<string, unknown>[] = [];
  // Tiny food catalogue for the REAL resolveIngredientRows (foodId path).
  const foods: Record<string, Record<string, unknown>> = {
    'food-milk': {
      id: 'food-milk', name: 'Milk', servingSize: 250, servingUnit: 'ml',
      servingWeightG: 258, kcal: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3, fiberG: 0,
    },
    'food-wheat-flour': {
      id: 'food-wheat-flour', name: 'Whole wheat flour', servingSize: 100, servingUnit: 'g',
      servingWeightG: 100, kcal: 340, proteinG: 13, carbsG: 72, fatG: 2.5, fiberG: 10,
    },
    'food-chicken': {
      id: 'food-chicken', name: 'Chicken breast', servingSize: 100, servingUnit: 'g',
      servingWeightG: 100, kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fiberG: 0,
    },
    'food-egg': {
      id: 'food-egg', name: 'Eggs', servingSize: 1, servingUnit: 'piece',
      servingWeightG: 50, kcal: 155, proteinG: 13, carbsG: 1.1, fatG: 11, fiberG: 0,
    },
    'food-peanut': {
      id: 'food-peanut', name: 'Peanuts', servingSize: 100, servingUnit: 'g',
      servingWeightG: 100, kcal: 567, proteinG: 26, carbsG: 16, fatG: 49, fiberG: 8.5,
    },
  };
  const prisma = {
    __created: created,
    recipe: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'r-created', ...data };
      }),
    },
    food: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return foods[where.id] ?? null;
      }),
    },
  };
  return { prisma, PrismaRuntime: { JsonNull: JSON_NULL } };
});

import { POST as recipePOST } from '@/app/api/recipes/route';
import { requireUser } from '@/lib/auth';
import { prisma } from '@fitfusion/db';

const mockRequireUser = vi.mocked(requireUser);
const mockCreate = vi.mocked(prisma.recipe.create);
const created = (prisma as unknown as { __created: Record<string, unknown>[] }).__created;

const SESSION = { user: { id: 'user-1', email: 'user@example.com' } };

function req(body: unknown) {
  return new Request('http://localhost/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof recipePOST>[0];
}

async function post(body: unknown) {
  const res = (await recipePOST(req(body))) as NextResponse;
  const json = (await res.json()) as Record<string, unknown>;
  return { res, json };
}

beforeEach(() => {
  created.length = 0;
  mockCreate.mockClear();
  mockRequireUser.mockReset();
  mockRequireUser.mockResolvedValue(SESSION as never);
});

const baseBody = {
  name: 'Test Karahi',
  ingredients: [{ foodId: 'food-chicken', name: 'Chicken breast', grams: 200 }],
  portions: 2,
};

describe('POST /api/recipes — diet category (v21.4 ITEM 6)', () => {
  it('omitted dietCategory → 400 validation_error; nothing is created', async () => {
    const { res, json } = await post(baseBody);
    expect(res.status).toBe(400);
    expect((json.error as { code: string }).code).toBe('validation_error');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('unknown dietCategory → 400', async () => {
    const { res, json } = await post({ ...baseBody, dietCategory: 'vegan' });
    expect(res.status).toBe(400);
    expect((json.error as { code: string }).code).toBe('validation_error');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('meat recipe with explicit non_vegetarian is stored as non_vegetarian (never defaulted)', async () => {
    const { res, json } = await post({ ...baseBody, dietCategory: 'non_vegetarian' });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(created[0].dietCategory).toBe('non_vegetarian');
    expect(created[0].dietCategory).not.toBe('vegetarian');
    expect((json as { recipe: { title: string } }).recipe.title).toBe('Test Karahi');
  });

  it('vegetarian choice is stored verbatim', async () => {
    const body = {
      name: 'Test Daal',
      ingredients: [{ foodId: 'food-milk', name: 'Milk', grams: 200 }],
      portions: 2,
      dietCategory: 'vegetarian',
    };
    const { res } = await post(body);
    expect(res.status).toBe(201);
    expect(created[0].dietCategory).toBe('vegetarian');
  });
});

describe('POST /api/recipes — allergen screening (v21.4 ITEM 6)', () => {
  it('detects wheat/milk/eggs/peanuts from ingredient names at creation', async () => {
    const body = {
      name: 'Screening Test',
      ingredients: [
        { foodId: 'food-wheat-flour', name: 'Whole wheat flour', grams: 100 },
        { foodId: 'food-milk', name: 'Milk', grams: 100 },
        { foodId: 'food-egg', name: 'Eggs', grams: 50 },
        { foodId: 'food-peanut', name: 'Peanuts', grams: 20 },
      ],
      portions: 2,
      dietCategory: 'vegetarian',
    };
    const { res } = await post(body);
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // Screening ran and was RECORDED (status separate from the list).
    expect(created[0].allergenScreened).toBe(true);
    expect(created[0].allergens).toEqual(['eggs', 'milk', 'peanuts', 'wheat']);
  });

  it('nothing detected → empty list WITH screened=true ("not detected", not a safety promise)', async () => {
    const body = {
      name: 'Plain Chicken',
      ingredients: [{ foodId: 'food-chicken', name: 'Chicken breast', grams: 200 }],
      portions: 2,
      dietCategory: 'non_vegetarian',
    };
    const { res } = await post(body);
    expect(res.status).toBe(201);
    expect(created[0].allergenScreened).toBe(true);
    expect(created[0].allergens).toEqual([]);
  });

  it('detects allergens from declared (non-catalogue) ingredient names too', async () => {
    const body = {
      name: 'Declared Test',
      ingredients: [
        {
          name: 'Desi ghee', grams: 10,
          kcal: 900, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0,
          basis: 'estimate' as const,
        },
        { name: 'Water', grams: 300 }, // known-zero, no family
      ],
      portions: 1,
      dietCategory: 'vegetarian',
    };
    const { res } = await post(body);
    expect(res.status).toBe(201);
    expect(created[0].allergenScreened).toBe(true);
    expect(created[0].allergens).toEqual(['milk']);
  });
});
