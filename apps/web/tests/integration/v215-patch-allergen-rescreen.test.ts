/**
 * PATCH /api/recipes/[slug] — allergen re-screening on material edits
 * (v21.5 P1) + canonical-name screening (v21.5 P2). Mocked, no database.
 *
 * Mocks `@fitfusion/db` (in-memory findFirst/update + a tiny food catalogue
 * WITH aliases for the REAL `resolveIngredientRows`, which now pulls
 * `include: { aliases: ... }`) and `@/lib/auth` (fixed session). The REAL
 * PATCH route, the REAL `CustomRecipePatchSchema`, the REAL helpers from
 * `./custom-recipe` and the REAL pure screeners from `@fitfusion/core`
 * execute:
 *
 * P1 — re-screen on PATCH:
 *  - add peanuts to a peanut-free recipe → 'peanuts' detected;
 *  - add milk → 'milk' detected;
 *  - remove all allergen ingredients → list empties ([]), screened stays true;
 *  - display-name-only rename (same canonical set) → NO recheck:
 *    `allergens`/`allergenScreened` are untouched. This is deliberate:
 *    the recheck decision compares CANONICAL name keys, so a cosmetic
 *    rename is not material, and canonical-based screening would return the
 *    identical list anyway. (v21.4's display-name comparison would have
 *    re-run here — v21.5 narrows it.)
 *  - dietCategory-only change → recheck runs against the STORED names;
 *  - prepMin-only edit → allergens untouched;
 *  - invalid PATCH (400) → no update call at all (no partial writes);
 *  - legacy v21.4 row whose display name hid an allergen ("nutty spread",
 *    no canonicalName) → its next ingredients edit triggers the recheck
 *    (canonical "Peanut Butter" != stored display "nutty spread") and the
 *    stale list is corrected.
 *
 * P2 — canonical names, not display aliases:
 *  - catalogue food "Peanut Butter" supplied with display name
 *    "nutty spread" → 'peanuts' STILL detected (display name no longer
 *    shadows the canonical name);
 *  - a food whose NAME matches no pattern but whose persisted ALIAS does
 *    ("Groundnut oil" + alias "moong phali oil") → 'peanuts' detected via
 *    the alias.
 *
 * Atomicity: whenever the recheck runs, `allergens` and `allergenScreened`
 * arrive in the SAME conditional updateMany data object; when it doesn't
 * run, neither key is present in the update.
 *
 * v21.6: the server REQUIRES expectedContentHash on every PATCH
 * (recipe-governance.ts §5) — the `patch` helper sends the current stored
 * hash (explicit null for the legacy NULL-hash seeds). The guard contract
 * itself is pinned in v216-concurrency-guards-mocked.test.ts.
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
  // Tiny food catalogue for the REAL resolveIngredientRows (foodId path).
  // NOTE: the mock findUnique ignores the `include` clause — real code
  // reads `food.aliases ?? []`, so foods simply carry their aliases here.
  const foods: Record<string, Record<string, unknown>> = {
    'food-milk': {
      id: 'food-milk', name: 'Milk', servingSize: 250, servingUnit: 'ml',
      servingWeightG: 258, kcal: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3, fiberG: 0,
      aliases: [],
    },
    'food-wheat-flour': {
      id: 'food-wheat-flour', name: 'Whole wheat flour', servingSize: 100, servingUnit: 'g',
      servingWeightG: 100, kcal: 340, proteinG: 13, carbsG: 72, fatG: 2.5, fiberG: 0,
      aliases: [],
    },
    'food-chicken': {
      id: 'food-chicken', name: 'Chicken breast', servingSize: 100, servingUnit: 'g',
      servingWeightG: 100, kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fiberG: 0,
      aliases: [{ alias: 'murghi' }],
    },
    'food-egg': {
      id: 'food-egg', name: 'Eggs', servingSize: 1, servingUnit: 'piece',
      servingWeightG: 50, kcal: 155, proteinG: 13, carbsG: 1.1, fatG: 11, fiberG: 0,
      aliases: [],
    },
    'food-peanut': {
      id: 'food-peanut', name: 'Peanut Butter', servingSize: 100, servingUnit: 'g',
      servingWeightG: 100, kcal: 588, proteinG: 25, carbsG: 20, fatG: 50, fiberG: 6,
      aliases: [{ alias: 'peanut spread' }, { alias: 'moong phali makkhan' }],
    },
    // Canonical name matches NOTHING; the persisted alias does.
    'food-groundnut': {
      id: 'food-groundnut', name: 'Groundnut oil', servingSize: 100, servingUnit: 'g',
      servingWeightG: 100, kcal: 884, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0,
      aliases: [{ alias: 'moong phali oil' }],
    },
  };
  const state = {
    existing: null as Record<string, unknown> | null,
    updates: [] as Record<string, unknown>[],
  };
  // v21.6: the PATCH route writes ONLY through the conditional updateMany
  // (recipe-governance.ts §5 — the guard is required). The mock checks the
  // (id, contentHash) pair the same way: a missing/undefined stored hash
  // is SQL NULL. When it matches, the data is applied and recorded in
  // state.updates (the atomicity assertions read from there).
  const applyUpdate = (data: Record<string, unknown>) => {
    state.updates.push(data);
    const next: Record<string, unknown> = { ...(state.existing as object) };
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
        next[k] = v;
      }
    }
    state.existing = next;
    return next;
  };
  const prisma = {
    __state: state,
    recipe: {
      findFirst: vi.fn(async () => state.existing),
      findUnique: vi.fn(async () => state.existing),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        return applyUpdate(data);
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; contentHash?: string | null; revision?: number };
          data: Record<string, unknown>;
        }) => {
          const existing = state.existing;
          if (!existing || (where.id !== undefined && existing.id !== where.id)) {
            return { count: 0 };
          }
          const storedHash = (existing.contentHash ?? null) as string | null;
          if (where.contentHash !== undefined && storedHash !== where.contentHash) {
            return { count: 0 };
          }
          // v21.7: the guard is the (hash, revision) pair — the revision
          // token must match too.
          if (where.revision !== undefined && (existing.revision ?? 0) !== where.revision) {
            return { count: 0 };
          }
          applyUpdate(data);
          return { count: 1 };
        },
      ),
    },
    food: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return foods[where.id] ?? null;
      }),
    },
  };
  return { prisma, PrismaRuntime: { JsonNull: JSON_NULL } };
});

import { PATCH as recipePATCH } from '@/app/api/recipes/[slug]/route';
import {
  ingredientAllergenScreenNames,
  storedRowAllergenKey,
  storedRowAllergenScreenNames,
} from '@/app/api/recipes/custom-recipe';
import { requireUser } from '@/lib/auth';
import { prisma } from '@fitfusion/db';

const mockRequireUser = vi.mocked(requireUser);
const mockFindFirst = vi.mocked(prisma.recipe.findFirst);
const mockUpdate = vi.mocked(prisma.recipe.update);
const mockUpdateMany = vi.mocked(prisma.recipe.updateMany);
const state = (prisma as unknown as {
  __state: {
    existing: Record<string, unknown> | null;
    updates: Record<string, unknown>[];
  };
}).__state;

const SESSION = { user: { id: 'user-1', email: 'user@example.com' } };

/** Stored row as v21.5 writes it (display name + canonicalName + aliases). */
function storedRow(name: string, canonicalName: string, aliases: string[] = []) {
  return {
    name,
    canonicalName,
    aliases,
    grams: 200,
    kcal: 100, proteinG: 10, carbsG: 0, fatG: 5, fiberG: 0,
    nutritionStatus: 'ok',
  };
}

/** Stored row as v21.4 wrote it: display name only, no canonicalName. */
function legacyStoredRow(name: string) {
  return {
    name,
    grams: 200,
    kcal: 100, proteinG: 10, carbsG: 0, fatG: 5, fiberG: 0,
    nutritionStatus: 'ok',
  };
}

function seedExisting(overrides: Record<string, unknown> = {}) {
  state.existing = {
    id: 'r-1',
    slug: 'slug-1',
    userId: 'user-1',
    title: 'Test Recipe',
    isPrivate: true,
    servings: 2,
    prepMin: 10,
    cookMin: 20,
    difficulty: 'easy',
    // NOTE: the seeded recipe contains chicken, so it is declared
    // non_vegetarian — v21.5 (P3) rejects a vegetarian declaration with meat
    // ingredients (diet_conflict 400).
    dietCategory: 'non_vegetarian',
    ingredients: [storedRow('Chicken breast', 'Chicken breast', ['murghi'])],
    allergens: [],
    revision: 0,
    allergenScreened: true,
    needsReview: false,
    verified: false,
    verificationEvidence: null,
    reviewEvidence: null,
    yieldGrams: null,
    tags: [],
    ...overrides,
  };
  state.updates.length = 0;
  mockFindFirst.mockClear();
  mockUpdate.mockClear();
  mockUpdateMany.mockClear();
}

function req(body: unknown) {
  return new Request('http://localhost/api/recipes/slug-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof recipePATCH>[0];
}

const params = { params: { slug: 'slug-1' } } as Parameters<typeof recipePATCH>[1];

async function patch(body: unknown) {
  // v21.6: the server REQUIRES expectedContentHash on every PATCH
  // (recipe-governance.ts §5). These tests exercise allergen screening,
  // not the guard, so the helper sends the current hash — the seed rows
  // predate hash tracking → explicit null, like a legacy row's GET shows.
  const b = body as Record<string, unknown>;
  // v21.7: the server REQUIRES the (hash, revision) guard pair on every
  // PATCH (recipe-governance.ts §5b). Defaults first so an explicitly
  // supplied guard still wins; the revision is read from the CURRENT
  // stored row so sequential writes stay fresh.
  const guarded = {
    expectedContentHash: (state.existing?.contentHash ?? null) as string | null,
    expectedRevision: (state.existing?.revision ?? 0) as number,
    ...b,
  };
  const res = (await recipePATCH(req(guarded), params)) as NextResponse;
  const json = (await res.json()) as Record<string, unknown>;
  return { res, json };
}

beforeEach(() => {
  mockRequireUser.mockReset();
  mockRequireUser.mockResolvedValue(SESSION as never);
  seedExisting();
});

describe('PATCH /api/recipes/[slug] — allergen re-screen (v21.5 P1)', () => {
  it('adding peanuts to a peanut-free recipe detects peanuts (atomic update)', async () => {
    const { res } = await patch({
      ingredients: [
        { foodId: 'food-chicken', name: 'Chicken breast', grams: 200 },
        { foodId: 'food-peanut', name: 'Peanut Butter', grams: 30 },
      ],
    });
    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const data = state.updates[0];
    // Both fields land in the SAME update — never one without the other.
    // 'Peanut Butter' matches the milk family too ("butter" pattern) —
    // name-screening is deliberately over-inclusive, never certified.
    expect(data.allergens).toEqual(['milk', 'peanuts']);
    expect(data.allergenScreened).toBe(true);
  });

  it('adding milk detects milk', async () => {
    const { res } = await patch({
      ingredients: [
        { foodId: 'food-chicken', name: 'Chicken breast', grams: 200 },
        { foodId: 'food-milk', name: 'Milk', grams: 100 },
      ],
    });
    expect(res.status).toBe(200);
    expect(state.updates[0].allergens).toEqual(['milk']);
    expect(state.updates[0].allergenScreened).toBe(true);
  });

  it('removing all allergen ingredients empties the list (screened stays true)', async () => {
    seedExisting({
      ingredients: [
        storedRow('Peanut Butter', 'Peanut Butter', ['peanut spread']),
        storedRow('Milk', 'Milk'),
      ],
      allergens: ['milk', 'peanuts'],
      allergenScreened: true,
    });
    const { res } = await patch({
      ingredients: [{ foodId: 'food-chicken', name: 'Chicken breast', grams: 200 }],
    });
    expect(res.status).toBe(200);
    expect(state.updates[0].allergens).toEqual([]);
    expect(state.updates[0].allergenScreened).toBe(true);
  });

  it('display-name-only rename is NOT a material change: allergens untouched', async () => {
    // Same canonical set ("Chicken breast"), only the display name changes.
    // The recheck decision compares canonical keys, so this is not material
    // and canonical-based screening would return the identical list anyway.
    const { res } = await patch({
      ingredients: [{ foodId: 'food-chicken', name: 'my yummy protein', grams: 200 }],
    });
    expect(res.status).toBe(200);
    const data = state.updates[0];
    expect(data).not.toHaveProperty('allergens');
    expect(data).not.toHaveProperty('allergenScreened');
    // The rename itself is still stored (display name is UI-facing).
    const ing = (data.ingredients as { name: string; canonicalName: string }[])[0];
    expect(ing.name).toBe('my yummy protein');
    expect(ing.canonicalName).toBe('Chicken breast');
  });

  it('dietCategory-only change re-runs the recheck against stored names', async () => {
    // Vegetarian-safe recipe (milk only) declared vegetarian; flipping the
    // declaration re-screens the stored names with no re-resolve.
    seedExisting({
      dietCategory: 'vegetarian',
      ingredients: [storedRow('Milk', 'Milk')],
      allergens: ['milk'],
      allergenScreened: true,
    });
    const { res } = await patch({ dietCategory: 'non_vegetarian' });
    expect(res.status).toBe(200);
    const data = state.updates[0];
    expect(data.dietCategory).toBe('non_vegetarian');
    expect(data.allergens).toEqual(['milk']);
    expect(data.allergenScreened).toBe(true);
  });

  it('prepMin-only edit leaves allergens/allergenScreened untouched', async () => {
    const { res } = await patch({ prepMin: 25 });
    expect(res.status).toBe(200);
    const data = state.updates[0];
    expect(data.prepMin).toBe(25);
    expect(data).not.toHaveProperty('allergens');
    expect(data).not.toHaveProperty('allergenScreened');
  });

  it('failed validation (400) performs no update at all', async () => {
    const { res, json } = await patch({ dietCategory: 'vegan' });
    expect(res.status).toBe(400);
    expect((json.error as { code: string }).code).toBe('validation_error');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('legacy v21.4 row whose display name hid an allergen is corrected on next edit', async () => {
    // Stored under v21.4 with NO canonicalName and a display name that
    // screened clean ("nutty spread") — the stale list must not survive.
    seedExisting({
      ingredients: [legacyStoredRow('nutty spread')],
      allergens: [],
      allergenScreened: true,
    });
    const { res } = await patch({
      ingredients: [{ foodId: 'food-peanut', name: 'nutty spread', grams: 30 }],
    });
    expect(res.status).toBe(200);
    // Canonical "Peanut Butter" != stored display "nutty spread" → recheck.
    // (milk family rides along via the "butter" pattern.)
    expect(state.updates[0].allergens).toEqual(['milk', 'peanuts']);
    expect(state.updates[0].allergenScreened).toBe(true);
  });
});

describe('canonical-name screening (v21.5 P2)', () => {
  it('renaming "Peanut Butter" to "nutty spread" still detects peanuts (PATCH)', async () => {
    const { res } = await patch({
      ingredients: [{ foodId: 'food-peanut', name: 'nutty spread', grams: 30 }],
    });
    expect(res.status).toBe(200);
    // The display alias no longer hides the canonical name (milk rides
    // along via the "butter" pattern).
    expect(state.updates[0].allergens).toEqual(['milk', 'peanuts']);
    expect(state.updates[0].allergenScreened).toBe(true);
  });

  it('a food whose alias matches (canonical name does not) is detected', async () => {
    const { res } = await patch({
      ingredients: [{ foodId: 'food-groundnut', name: 'frying oil', grams: 10 }],
    });
    expect(res.status).toBe(200);
    // 'Groundnut oil' matches no family; alias 'moong phali oil' → peanuts.
    expect(state.updates[0].allergens).toEqual(['peanuts']);
  });

  it('stored rows expose canonicalName+aliases after an ingredients PATCH', async () => {
    const { res } = await patch({
      ingredients: [{ foodId: 'food-peanut', name: 'nutty spread', grams: 30 }],
    });
    expect(res.status).toBe(200);
    const ing = (state.updates[0].ingredients as { name: string; canonicalName: string; aliases: string[] }[])[0];
    expect(ing.name).toBe('nutty spread'); // display name unchanged for the UI
    expect(ing.canonicalName).toBe('Peanut Butter');
    expect(ing.aliases).toContain('moong phali makkhan');
  });
});

describe('screen-name helpers (v21.5 P2)', () => {
  it('ingredientAllergenScreenNames uses canonical + aliases, never the display name', () => {
    expect(
      ingredientAllergenScreenNames({
        name: 'nutty spread',
        canonicalName: 'Peanut Butter',
        aliases: ['moong phali makkhan'],
        grams: 30,
        nutritionStatus: 'ok',
      }),
    ).toEqual(['Peanut Butter', 'moong phali makkhan']);
  });

  it('storedRowAllergenScreenNames falls back to the stored display name for legacy rows', () => {
    expect(storedRowAllergenScreenNames({ name: 'nutty spread' })).toEqual(['nutty spread']);
    expect(
      storedRowAllergenScreenNames({
        name: 'nutty spread',
        canonicalName: 'Peanut Butter',
        aliases: ['moong phali makkhan'],
      }),
    ).toEqual(['Peanut Butter', 'moong phali makkhan']);
  });

  it('storedRowAllergenKey prefers the canonical name for recheck comparison', () => {
    expect(storedRowAllergenKey({ name: 'nutty spread', canonicalName: 'Peanut Butter' })).toBe('Peanut Butter');
    expect(storedRowAllergenKey({ name: 'nutty spread' })).toBe('nutty spread');
  });
});
