/**
 * Vegetarian dietCategory conflict screening — route behavior (v21.5 P3).
 * Mocked, runs without a database.
 *
 * Mocks `@fitfusion/db` (in-memory recipe store + a tiny food catalogue for
 * the real `resolveIngredientRows`, including Food.category names) and
 * `@/lib/auth` / `@/lib/admin` (fixed session, non-admin). The REAL POST and
 * PATCH routes, the REAL zod schemas, the REAL `resolveIngredientRows` /
 * `recipeNutrition`, and the REAL `checkRecipeDiet` execute:
 *
 * POST /api/recipes
 *  - vegetarian + catalogue chicken ingredient → 400 diet_conflict naming
 *    the ingredient; nothing is created;
 *  - vegetarian + free-text "beef mince" → 400 diet_conflict;
 *  - valid vegetarian (daal, paneer, vegetables) → 201, clean;
 *  - non_vegetarian chicken karahi → 201, no false positive;
 *  - vegetarian + ambiguous free text ("chef's special mix") → 201 but
 *    needsReview=true with a diet warning naming the ambiguity (never a
 *    clean pass);
 *  - dairy/eggs under vegetarian (paneer catalogue row) → 201, no conflict.
 *
 * PATCH /api/recipes/[slug]
 *  - changing dietCategory to vegetarian on a chicken recipe → 400
 *    diet_conflict naming the ingredient;
 *  - changing ingredients to add chicken on a vegetarian recipe → 400;
 *  - dietCategory-only change with an ambiguous stored ingredient → 200
 *    with dietWarnings and needsReview forced true.
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
  const store = new Map<string, Record<string, unknown>>();
  // Tiny food catalogue for the REAL resolveIngredientRows (foodId path),
  // including the trusted Food.category signal.
  const foods: Record<string, Record<string, unknown>> = {
    'food-chicken': {
      id: 'food-chicken',
      name: 'Chicken breast',
      servingSize: 100,
      servingUnit: 'g',
      servingWeightG: 100,
      kcal: 165,
      proteinG: 31,
      carbsG: 0,
      fatG: 3.6,
      fiberG: 0,
      aliases: [],
      category: { name: 'Chicken, Meat & Fish' },
    },
    'food-daal': {
      id: 'food-daal',
      name: 'Moong daal (cooked)',
      servingSize: 100,
      servingUnit: 'g',
      servingWeightG: 100,
      kcal: 105,
      proteinG: 7,
      carbsG: 19,
      fatG: 0.4,
      fiberG: 7,
      aliases: [],
      category: { name: 'Lentils & Beans (Daal)' },
    },
    'food-paneer': {
      id: 'food-paneer',
      name: 'Paneer',
      servingSize: 100,
      servingUnit: 'g',
      servingWeightG: 100,
      kcal: 265,
      proteinG: 18,
      carbsG: 3.6,
      fatG: 20,
      fiberG: 0,
      aliases: [],
      category: { name: 'Dairy' },
    },
  };
  const prisma = {
    __store: store,
    recipe: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `r-${store.size + 1}`, ...data };
        store.set(row.id as string, row);
        return row;
      }),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { userId: string; OR: Array<{ id?: string; slug?: string }> };
        }) => {
          for (const row of store.values()) {
            if (row.userId !== where.userId) continue;
            if (where.OR.some((c) => (c.id && row.id === c.id) || (c.slug && row.slug === c.slug))) {
              return row;
            }
          }
          return null;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = store.get(where.id);
          if (!row) throw new Error('not found');
          const next = { ...row };
          for (const [k, v] of Object.entries(data)) {
            // v21.7: the guarded writes bump the revision token atomically
            // (`revision: { increment: 1 }`, exactly like Prisma).
            if (
              k === 'revision' &&
              v !== null && typeof v === 'object' &&
              typeof (v as Record<string, unknown>).increment === 'number'
            ) {
              next[k] =
                (typeof next[k] === 'number' ? (next[k] as number) : 0) +
                ((v as Record<string, unknown>).increment as number);
            } else {
              next[k] = v === JSON_NULL ? null : v;
            }
          }
          store.set(where.id, next);
          return next;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; contentHash?: string | null; revision?: number };
          data: Record<string, unknown>;
        }) => {
          // v21.6: the PATCH route writes ONLY through the conditional
          // updateMany (recipe-governance.ts §5 — the guard is required).
          // The mock mirrors the conditional semantics: the write lands
          // only when the (id, contentHash) pair matches (missing/undefined
          // stored hash is SQL NULL), and the data is applied to the store
          // so the follow-up findUnique returns the post-write row.
          const row = where.id !== undefined ? store.get(where.id) : null;
          if (!row) return { count: 0 };
          const storedHash = (row.contentHash ?? null) as string | null;
          if (where.contentHash !== undefined && storedHash !== where.contentHash) {
            return { count: 0 };
          }
          // v21.7: the guard is the (hash, revision) pair — the
          // revision token must match too.
          if (where.revision !== undefined && (row.revision ?? 0) !== where.revision) {
            return { count: 0 };
          }
          const next = { ...row };
          for (const [k, v] of Object.entries(data)) {
            // v21.7: the guarded writes bump the revision token atomically
            // (`revision: { increment: 1 }`, exactly like Prisma).
            if (
              k === 'revision' &&
              v !== null && typeof v === 'object' &&
              typeof (v as Record<string, unknown>).increment === 'number'
            ) {
              next[k] =
                (typeof next[k] === 'number' ? (next[k] as number) : 0) +
                ((v as Record<string, unknown>).increment as number);
            } else {
              next[k] = v === JSON_NULL ? null : v;
            }
          }
          store.set(where.id as string, next);
          return { count: 1 };
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return store.get(where.id) ?? null;
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
import { PATCH as recipePATCH } from '@/app/api/recipes/[slug]/route';
import { requireUser } from '@/lib/auth';
import { prisma } from '@fitfusion/db';

const mockRequireUser = vi.mocked(requireUser);
const store = (prisma as unknown as { __store: Map<string, Record<string, unknown>> }).__store;

const SESSION = { user: { id: 'user-1', email: 'user@example.com' } };

function postReq(body: unknown) {
  return new Request('http://localhost/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof recipePOST>[0];
}

function patchReq(slug: string, body: unknown) {
  return new Request(`http://localhost/api/recipes/${slug}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof recipePATCH>[0];
}

async function post(body: unknown) {
  const res = (await recipePOST(postReq(body))) as NextResponse;
  const json = (await res.json()) as Record<string, unknown>;
  return { res, json };
}

async function patch(slug: string, body: unknown) {
  // v21.6: the server REQUIRES expectedContentHash on every PATCH
  // (recipe-governance.ts §5). These tests exercise diet screening, not
  // the guard, so the helper sends the current stored hash — the seeds
  // predate hash tracking → explicit null, like a legacy row's GET shows.
  const b = body as Record<string, unknown>;
  // v21.7: the server REQUIRES the (hash, revision) guard pair on every
  // PATCH (recipe-governance.ts §5b). Defaults first so an explicitly
  // supplied guard still wins; the revision is read from the CURRENT
  // stored row so sequential writes stay fresh.
  const guarded = {
    expectedContentHash: (store.get(slug)?.contentHash ?? null) as string | null,
    expectedRevision: (store.get(slug)?.revision ?? 0) as number,
    ...b,
  };
  const res = (await recipePATCH(patchReq(slug, guarded), {
    params: { slug },
  })) as NextResponse;
  const json = (await res.json()) as Record<string, unknown>;
  return { res, json };
}

function declared(name: string, grams: number) {
  return {
    name,
    grams,
    kcal: 100,
    proteinG: 5,
    carbsG: 15,
    fatG: 2,
    fiberG: 3,
    basis: 'estimate' as const,
  };
}

/** Seed a stored recipe row directly (v21.5-shaped stored ingredients). */
function seedRecipe(row: Record<string, unknown>) {
  const id = row.id as string;
  store.set(id, {
    servings: 2,
    yieldGrams: null,
    tags: [],
    allergens: [],
    allergenScreened: true,
    needsReview: false,
    isPrivate: true,
    userId: 'user-1',
    revision: 0,
    ...row,
  });
}

const CHICKEN_STORED = {
  name: 'Chicken breast',
  canonicalName: 'Chicken breast',
  aliases: [],
  foodCategoryName: 'Chicken, Meat & Fish',
  rowSource: 'catalogue',
  grams: 200,
  kcal: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  fiberG: 0,
  nutritionStatus: 'ok',
};

beforeEach(() => {
  store.clear();
  mockRequireUser.mockReset();
  mockRequireUser.mockResolvedValue(SESSION as never);
});

describe('POST /api/recipes — vegetarian conflict screening (v21.5 P3)', () => {
  it('vegetarian + catalogue chicken ingredient → 400 diet_conflict naming it', async () => {
    const before = store.size;
    const { res, json } = await post({
      name: 'Chicken sneak',
      ingredients: [{ foodId: 'food-chicken', name: 'Chicken breast', grams: 200 }],
      portions: 2,
      dietCategory: 'vegetarian',
    });
    expect(res.status).toBe(400);
    expect((json.error as { code: string }).code).toBe('diet_conflict');
    expect((json.error as { message: string }).message).toContain('Chicken breast');
    expect(store.size).toBe(before);
  });

  it('vegetarian + free-text "beef mince" → 400 diet_conflict', async () => {
    const { res, json } = await post({
      name: 'Sneaky keema',
      ingredients: [declared('beef mince', 150)],
      portions: 2,
      dietCategory: 'vegetarian',
    });
    expect(res.status).toBe(400);
    expect((json.error as { code: string }).code).toBe('diet_conflict');
    expect((json.error as { message: string }).message).toContain('beef mince');
  });

  it('valid vegetarian (daal, paneer, vegetables) → 201 clean', async () => {
    const { res, json } = await post({
      name: 'Daal paneer',
      ingredients: [
        { foodId: 'food-daal', name: 'Moong daal', grams: 200 },
        { foodId: 'food-paneer', name: 'Paneer', grams: 100 },
        declared('Mixed vegetables', 150),
      ],
      portions: 2,
      dietCategory: 'vegetarian',
    });
    expect(res.status).toBe(201);
    const body = json as {
      recipe: { needsReview: boolean };
      dietWarnings: string[];
      nutritionIncomplete: boolean;
    };
    expect(body.recipe.needsReview).toBe(false);
    expect(body.dietWarnings).toEqual([]);
    expect(body.nutritionIncomplete).toBe(false);
  });

  it('non_vegetarian chicken karahi → 201, no false positive', async () => {
    const { res, json } = await post({
      name: 'Chicken karahi',
      ingredients: [{ foodId: 'food-chicken', name: 'Chicken', grams: 300 }],
      portions: 3,
      dietCategory: 'non_vegetarian',
    });
    expect(res.status).toBe(201);
    expect((json as { dietWarnings: string[] }).dietWarnings).toEqual([]);
  });

  it('vegetarian + ambiguous free text → 201 but flagged (needsReview, dietWarnings)', async () => {
    const { res, json } = await post({
      name: 'Mystery mix',
      ingredients: [declared('Moong daal', 200), declared("chef's special mix", 50)],
      portions: 2,
      dietCategory: 'vegetarian',
    });
    expect(res.status).toBe(201);
    const body = json as {
      recipe: { needsReview: boolean };
      dietWarnings: string[];
    };
    // Never a clean pass: the ambiguity forces review and a named warning.
    expect(body.recipe.needsReview).toBe(true);
    expect(body.dietWarnings).toHaveLength(1);
    expect(body.dietWarnings[0]).toContain("chef's special mix");
    expect(body.dietWarnings[0]).toContain('Vegetarian is not claimed');
  });

  it('vegetarian + dairy catalogue row → 201, no conflict (lacto-ovo decision)', async () => {
    const { res, json } = await post({
      name: 'Paneer dish',
      ingredients: [{ foodId: 'food-paneer', name: 'Paneer', grams: 150 }],
      portions: 2,
      dietCategory: 'vegetarian',
    });
    expect(res.status).toBe(201);
    expect((json as { dietWarnings: string[] }).dietWarnings).toEqual([]);
  });
});

describe('PATCH /api/recipes/[slug] — vegetarian conflict screening (v21.5 P3)', () => {
  it('changing dietCategory to vegetarian on a chicken recipe → 400', async () => {
    seedRecipe({
      id: 'r-chicken',
      slug: 'r-chicken',
      title: 'Chicken curry',
      dietCategory: 'non_vegetarian',
      ingredients: [CHICKEN_STORED],
    });
    const { res, json } = await patch('r-chicken', { dietCategory: 'vegetarian' });
    expect(res.status).toBe(400);
    expect((json.error as { code: string }).code).toBe('diet_conflict');
    expect((json.error as { message: string }).message).toContain('Chicken breast');
    // Nothing was written.
    expect((store.get('r-chicken') as { dietCategory: string }).dietCategory).toBe(
      'non_vegetarian',
    );
  });

  it('adding chicken ingredients to a vegetarian recipe → 400', async () => {
    seedRecipe({
      id: 'r-daal',
      slug: 'r-daal',
      title: 'Daal',
      dietCategory: 'vegetarian',
      ingredients: [
        {
          name: 'Moong daal',
          canonicalName: 'Moong daal (cooked)',
          aliases: [],
          foodCategoryName: 'Lentils & Beans (Daal)',
          rowSource: 'catalogue',
          grams: 200,
          nutritionStatus: 'ok',
        },
      ],
    });
    const { res, json } = await patch('r-daal', {
      ingredients: [{ foodId: 'food-chicken', name: 'Chicken', grams: 200 }],
    });
    expect(res.status).toBe(400);
    expect((json.error as { code: string }).code).toBe('diet_conflict');
    expect((json.error as { message: string }).message).toContain('Chicken');
  });

  it('dietCategory-only change with an ambiguous stored ingredient → 200 flagged', async () => {
    seedRecipe({
      id: 'r-mystery',
      slug: 'r-mystery',
      title: 'Mystery',
      dietCategory: 'non_vegetarian',
      ingredients: [
        {
          name: "chef's special mix",
          canonicalName: "chef's special mix",
          aliases: [],
          foodCategoryName: null,
          rowSource: 'free_text',
          grams: 50,
          nutritionStatus: 'unknown',
        },
      ],
    });
    const { res, json } = await patch('r-mystery', { dietCategory: 'vegetarian' });
    expect(res.status).toBe(200);
    const body = json as {
      recipe: { dietCategory: string; needsReview: boolean };
      dietWarnings: string[];
    };
    expect(body.recipe.dietCategory).toBe('vegetarian');
    expect(body.recipe.needsReview).toBe(true);
    expect(body.dietWarnings).toHaveLength(1);
    expect(body.dietWarnings[0]).toContain("chef's special mix");
  });

  it('dietCategory change to non_vegetarian on a chicken recipe → 200 (no screening)', async () => {
    seedRecipe({
      id: 'r-chicken2',
      slug: 'r-chicken2',
      title: 'Chicken curry',
      dietCategory: 'vegetarian',
      ingredients: [CHICKEN_STORED],
    });
    const { res, json } = await patch('r-chicken2', { dietCategory: 'non_vegetarian' });
    expect(res.status).toBe(200);
    expect(
      (json as { recipe: { dietCategory: string } }).recipe.dietCategory,
    ).toBe('non_vegetarian');
  });
});
