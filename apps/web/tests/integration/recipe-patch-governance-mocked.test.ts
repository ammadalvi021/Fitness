/**
 * Recipe PATCH invalidation (v21.4) — mocked, runs without a database.
 *
 * Mocks `@fitfusion/db` (in-memory recipe store) and `@/lib/auth`
 * (fixed owner session). The REAL PATCH route, the REAL zod patch schema,
 * and the REAL `invalidationForEdit` policy execute:
 *
 *  - ingredient change on a verified recipe → verified=false and BOTH
 *    evidence columns destroyed (never Verified on stale evidence);
 *  - portions (yield) change → verification cleared;
 *  - dietCategory change → verification cleared;
 *  - review-only (verified=false) recipe + ingredient change → the review
 *    lapses too (it was checked against the old ingredient list);
 *  - metadata-only edit (name) → review and verification preserved.
 *
 * `resolveIngredientRows` is NOT mocked: the test ingredients carry full
 * declared nutrients (no foodId), so the pure classification path runs and
 * no database food lookup happens.
 *
 * v21.5 yieldGrams contract (informational, non-material):
 *  - yieldGrams-only PATCH on a verified recipe → yieldGrams stored, every
 *    per-serving nutrition value UNCHANGED, verified=true and both evidence
 *    columns preserved (calories are never recomputed to clear a flag);
 *  - yieldGrams + portions → invalidated (portions IS material and the
 *    per-serving math is re-based).
 *
 * v21.6: the server REQUIRES the expectedContentHash guard on every PATCH
 * (recipe-governance.ts §5). These tests exercise governance, not the
 * guard, so the `patch` helper sends the current stored hash (explicit
 * null for the legacy NULL-hash seeds) — the guard contract itself is
 * pinned in v216-concurrency-guards-mocked.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const { JSON_NULL } = vi.hoisted(() => ({ JSON_NULL: Symbol('prisma-json-null') }));

// ---- mocks (hoisted above imports) ----
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  getSessionUser: vi.fn(),
}));
vi.mock('@fitfusion/db', () => {
  const store = new Map<string, Record<string, unknown>>();
  const prisma = {
    __store: store,
    recipe: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { userId: string; OR: Array<{ id: string } | { slug: string }> };
        }) => {
          for (const row of store.values()) {
            if (row.userId !== where.userId) continue;
            const hit = where.OR.some((c) =>
              'id' in c ? row.id === c.id : row.slug === c.slug,
            );
            if (hit) return row;
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
      // v21.6: the PATCH route writes ONLY through the conditional
      // updateMany (recipe-governance.ts §5 — the guard is required, so
      // every write carries one). The mock applies the data when the
      // (id, contentHash) pair matches. A missing/undefined stored hash
      // is treated as SQL NULL, like Prisma does.
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; contentHash: string | null; revision?: number };
          data: Record<string, unknown>;
        }) => {
          const row = store.get(where.id);
          if (!row) return { count: 0 };
          const storedHash = (row.contentHash ?? null) as string | null;
          if (storedHash !== where.contentHash) return { count: 0 };
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
          store.set(where.id, next);
          return { count: 1 };
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return store.get(where.id) ?? null;
      }),
    },
  };
  return { prisma, PrismaRuntime: { JsonNull: JSON_NULL } };
});

import { requireUser } from '@/lib/auth';
import { prisma } from '@fitfusion/db';
import { PATCH as recipePATCH } from '@/app/api/recipes/[slug]/route';

const mockRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const store = (prisma as unknown as { __store: Map<string, Record<string, unknown>> }).__store;

const OWNER_SESSION = {
  user: { id: 'user-1', email: 'owner@example.com', status: 'active' },
  profile: null,
  subscription: null,
};

const COMPLETE_REVIEW = {
  reviewer: 'admin@example.com',
  reviewedAt: '2026-10-14',
  method: 'label cross-check',
  reference: 'USDA SR Legacy #170923',
  dietaryRechecked: true,
  allergenRechecked: true,
};

const COMPLETE_VERIFICATION = {
  checkedBy: 'admin@example.com',
  checkedAt: '2026-10-14',
  method: 'independent recomputation',
  allergenAndDietRechecked: true,
};

const DECLARED_OATS = {
  name: 'oats',
  grams: 100,
  kcal: 389,
  proteinG: 16.9,
  carbsG: 66.3,
  fatG: 6.9,
  fiberG: 10.6,
  basis: 'usda',
};

function seedRecipe(id: string, opts?: { verified?: boolean; reviewed?: boolean }) {
  const verified = opts?.verified ?? false;
  const reviewed = opts?.reviewed ?? verified;
  store.set(id, {
    id,
    slug: id,
    title: `Patch Gov ${id}`,
    userId: 'user-1',
    isPrivate: true,
    dietCategory: 'vegetarian',
    servings: 2,
    ingredients: [],
    kcalPerServing: 100,
    proteinPerServing: 5,
    carbsPerServing: 10,
    fatPerServing: 3,
    fiberPerServing: 1,
    needsReview: false,
    verified,
    verificationEvidence: verified ? { ...COMPLETE_VERIFICATION } : null,
    reviewEvidence: reviewed ? { ...COMPLETE_REVIEW } : null,
    revision: 0,
  });
}

function req(id: string, body: unknown) {
  return new Request(`http://localhost/api/recipes/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof recipePATCH>[0];
}

async function patch(id: string, body: unknown) {
  // v21.6: the server REQUIRES expectedContentHash on every PATCH
  // (recipe-governance.ts §5). These tests exercise governance, not the
  // guard, so the helper sends the hash it "read" (the seeded rows predate
  // hash tracking → explicit null, like a legacy row's GET would show).
  const b = body as Record<string, unknown> | null;
  // v21.7: the server REQUIRES the (hash, revision) guard pair on every
  // PATCH (recipe-governance.ts §5b). Defaults first so an explicitly
  // supplied guard still wins; the revision is read from the CURRENT
  // stored row so sequential writes stay fresh.
  const guarded =
    b !== null && typeof b === 'object'
      ? {
          expectedContentHash: (store.get(id)?.contentHash ?? null) as string | null,
          expectedRevision: (store.get(id)?.revision ?? 0) as number,
          ...b,
        }
      : b;
  const res = (await recipePATCH(req(id, guarded), {
    params: { slug: id },
  })) as NextResponse;
  return res;
}

beforeEach(() => {
  store.clear();
  mockRequireUser.mockReset();
  mockRequireUser.mockResolvedValue(OWNER_SESSION);
});

describe('PATCH invalidates prior review/verification on material edits', () => {
  it('ingredient change on a verified recipe → verified=false, both evidences destroyed', async () => {
    seedRecipe('p1', { verified: true });
    const res = await patch('p1', { ingredients: [DECLARED_OATS] });
    expect(res.status).toBe(200);
    const stored = store.get('p1')!;
    expect(stored.verified).toBe(false);
    expect(stored.verificationEvidence).toBeNull();
    expect(stored.reviewEvidence).toBeNull();
    // The nutrition was still recalculated for the new ingredients.
    expect(stored.kcalPerServing).toBeGreaterThan(0);
  });

  it('portions (yield) change on a verified recipe → verification cleared', async () => {
    seedRecipe('p2', { verified: true });
    const res = await patch('p2', { portions: 4 });
    expect(res.status).toBe(200);
    const stored = store.get('p2')!;
    expect(stored.verified).toBe(false);
    expect(stored.verificationEvidence).toBeNull();
    expect(stored.reviewEvidence).toBeNull();
    expect(stored.servings).toBe(4);
  });

  it('dietCategory change on a verified recipe → verification cleared (metadata branch)', async () => {
    seedRecipe('p3', { verified: true });
    const res = await patch('p3', { dietCategory: 'non_vegetarian' });
    expect(res.status).toBe(200);
    const stored = store.get('p3')!;
    expect(stored.verified).toBe(false);
    expect(stored.verificationEvidence).toBeNull();
    expect(stored.reviewEvidence).toBeNull();
    expect(stored.dietCategory).toBe('non_vegetarian');
  });

  it('ingredient change on a reviewed-only recipe → the review lapses too', async () => {
    seedRecipe('p4', { verified: false, reviewed: true });
    const res = await patch('p4', { ingredients: [DECLARED_OATS] });
    expect(res.status).toBe(200);
    const stored = store.get('p4')!;
    expect(stored.verified).toBe(false);
    expect(stored.reviewEvidence).toBeNull();
  });

  it('metadata-only edit (name) → review and verification preserved', async () => {
    seedRecipe('p5', { verified: true });
    const res = await patch('p5', { name: 'Renamed Oats' });
    expect(res.status).toBe(200);
    const stored = store.get('p5')!;
    expect(stored.verified).toBe(true);
    expect(stored.verificationEvidence).toEqual(COMPLETE_VERIFICATION);
    expect(stored.reviewEvidence).toEqual(COMPLETE_REVIEW);
    expect(stored.title).toBe('Renamed Oats');
  });

  it('yieldGrams-only PATCH → stored, nutrition untouched, evidence preserved (v21.5)', async () => {
    seedRecipe('p7', { verified: true });
    const before = store.get('p7')!;
    const res = await patch('p7', { yieldGrams: 850 });
    expect(res.status).toBe(200);
    const stored = store.get('p7')!;
    // The new batch weight is recorded…
    expect(stored.yieldGrams).toBe(850);
    // …but a yieldGrams change never alters the recorded calories or any
    // per-serving value (per-serving = batch totals ÷ portions, and
    // yieldGrams is not a divisor in that math).
    expect(stored.kcalPerServing).toBe(before.kcalPerServing);
    expect(stored.proteinPerServing).toBe(before.proteinPerServing);
    expect(stored.carbsPerServing).toBe(before.carbsPerServing);
    expect(stored.fatPerServing).toBe(before.fatPerServing);
    expect(stored.fiberPerServing).toBe(before.fiberPerServing);
    expect(stored.servings).toBe(before.servings);
    // …and the review/verification it was checked against are untouched.
    expect(stored.verified).toBe(true);
    expect(stored.verificationEvidence).toEqual(COMPLETE_VERIFICATION);
    expect(stored.reviewEvidence).toEqual(COMPLETE_REVIEW);
  });

  it('yieldGrams-only PATCH on a reviewed-only recipe → review preserved (v21.5)', async () => {
    seedRecipe('p8', { verified: false, reviewed: true });
    const res = await patch('p8', { yieldGrams: 700 });
    expect(res.status).toBe(200);
    const stored = store.get('p8')!;
    expect(stored.yieldGrams).toBe(700);
    expect(stored.verified).toBe(false);
    expect(stored.reviewEvidence).toEqual(COMPLETE_REVIEW);
    expect(stored.kcalPerServing).toBe(100);
  });

  it('yieldGrams + portions PATCH → invalidated by portions (v21.5)', async () => {
    seedRecipe('p9', { verified: true });
    const res = await patch('p9', { yieldGrams: 1200, portions: 4 });
    expect(res.status).toBe(200);
    const stored = store.get('p9')!;
    // portions is material: the evidence lapses and per-serving values are
    // re-based; the yieldGrams value is still recorded alongside.
    expect(stored.yieldGrams).toBe(1200);
    expect(stored.servings).toBe(4);
    expect(stored.verified).toBe(false);
    expect(stored.verificationEvidence).toBeNull();
    expect(stored.reviewEvidence).toBeNull();
  });

  it('unauthenticated caller → 401, recipe untouched', async () => {
    seedRecipe('p6', { verified: true });
    mockRequireUser.mockResolvedValueOnce(
      NextResponse.json(
        { error: { code: 'unauthorized', message: 'Authentication required' } },
        { status: 401 },
      ),
    );
    const res = await patch('p6', { portions: 4 });
    expect(res.status).toBe(401);
    expect(store.get('p6')!.verified).toBe(true);
  });
});
