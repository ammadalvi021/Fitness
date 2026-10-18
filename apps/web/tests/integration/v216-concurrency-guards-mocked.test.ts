/**
 * v21.6 ITEM 3/4 — concurrency-guard enforcement (mocked, runs on this VM).
 *
 * Pins the v21.6 contract (recipe-governance.ts §5): the silent
 * unconditional write fallback is GONE. Every write in a guarded workflow
 * (recipe PATCH, admin review / verify / clear) REQUIRES
 * `expectedContentHash`:
 *  - absent/undefined guard → 409 `stale_recipe` with an actionable
 *    message (reload the recipe/prefill and retry), nothing written;
 *  - explicit `null` → legacy NULL-hash row: the write is conditional on
 *    contentHash IS NULL (still concurrency-safe — a concurrent edit moves
 *    the hash to non-null and the write 409s);
 *  - mismatched guard → 409 `stale_recipe`, never a silent overwrite.
 *
 * Mocks `@fitfusion/db` (in-memory store + conditional-write updateMany),
 * `@/lib/admin`, `@/lib/auth`. The REAL review POST, the REAL recipe
 * PATCH, the REAL zod patch schema, the REAL serializeRecipePublic, and
 * the REAL computeRecipeContentHash execute.
 *
 * The REAL concurrency proof (two writers racing on PostgreSQL, admin
 * verify racing a real PATCH) lives in the DB-gated suite
 * v216-concurrency-guards-db.test.ts — skip-guarded here, pending a
 * database. MOCKED CONDITIONAL-UPDATE TESTS DO NOT PROVE DATABASE
 * CONCURRENCY BEHAVIOR: the map below cannot race the way PostgreSQL
 * does; it only proves the ROUTES issue conditional writes and interpret
 * the results correctly.
 *
 * Not duplicated here: Worker A's 8 pure hash/governance tests in
 * packages/core/src/recipe-governance.test.ts — including 'two recipes
 * with identical display names + grams but different foodIds produce
 * DIFFERENT hashes' (identity-aware canonicalization) and the
 * buildContentSnapshot extraction tests. Those cover the hash function;
 * this file covers the guard ENFORCEMENT around it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import {
  computeRecipeContentHash,
  CustomRecipePatchSchema,
} from '@fitfusion/core';
import { serializeRecipePublic } from '@/lib/recipe-evidence';

const { JSON_NULL } = vi.hoisted(() => ({ JSON_NULL: Symbol('prisma-json-null') }));

// ---- mocks (hoisted above imports) ----
vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(),
  isAdmin: vi.fn(() => false),
}));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  getSessionUser: vi.fn(),
}));
vi.mock('@fitfusion/db', () => {
  const store = new Map<string, Record<string, unknown>>();

  const apply = (row: Record<string, unknown>, data: Record<string, unknown>) => {
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
    return next;
  };
  // A missing/undefined stored hash is SQL NULL (like Prisma).
  const hashOf = (row: Record<string, unknown>) => (row.contentHash ?? null) as string | null;
  const findById = (id: string) => store.get(id) ?? null;
  const findBySlug = (slug: string) => {
    for (const row of store.values()) {
      if (row.slug === slug) return row;
    }
    return null;
  };

  const findUnique = vi.fn(
    async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id !== undefined) return findById(where.id as string);
      if (where.slug !== undefined) return findBySlug(where.slug as string);
      return null;
    },
  );
  const findFirst = vi.fn(
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
  );
  // Conditional write: lands only when the (id|slug, contentHash) pair
  // matches. Zero matched rows → { count: 0 } (the route answers 409).
  const updateMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id?: string; slug?: string; contentHash?: string | null; revision?: number };
      data: Record<string, unknown>;
    }) => {
      const row =
        where.id !== undefined ? findById(where.id) : where.slug !== undefined ? findBySlug(where.slug) : null;
      if (!row) return { count: 0 };
      if (where.contentHash !== undefined && hashOf(row) !== where.contentHash) {
        return { count: 0 };
      }
      // v21.7: the guard is the (hash, revision) pair — the revision
      // token must match too. A missing/undefined stored revision is SQL
      // 0 (the migration default), like Prisma.
      if (where.revision !== undefined && (row.revision ?? 0) !== where.revision) {
        return { count: 0 };
      }
      store.set(row.id as string, apply(row, data));
      return { count: 1 };
    },
  );
  const prisma = {
    __store: store,
    recipe: { findUnique, findFirst, updateMany },
  };
  return { prisma, PrismaRuntime: { JsonNull: JSON_NULL } };
});

import { requireAdmin } from '@/lib/admin';
import { requireUser } from '@/lib/auth';
import { prisma } from '@fitfusion/db';
import {
  POST as reviewPOST,
} from '@/app/api/admin/recipes/[slug]/review/route';
import { PATCH as recipePATCH } from '@/app/api/recipes/[slug]/route';

const mockRequireAdmin = requireAdmin as unknown as ReturnType<typeof vi.fn>;
const mockRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const store = (prisma as unknown as { __store: Map<string, Record<string, unknown>> }).__store;
const recipeModel = (prisma as unknown as {
  recipe: { updateMany: ReturnType<typeof vi.fn> };
}).recipe;

const ADMIN_SESSION = {
  user: { id: 'admin-1', email: 'admin@example.com', status: 'active' },
  profile: null,
  subscription: null,
};
const OWNER_SESSION = {
  user: { id: 'user-1', email: 'owner@example.com', status: 'active' },
  profile: null,
  subscription: null,
};

const REVIEW_EVIDENCE = {
  reviewedAt: '2026-10-14',
  method: 'label cross-check',
  reference: 'photo of nutrition label',
  dietaryRechecked: true,
  allergenRechecked: true,
};
const VERIFY_EVIDENCE = {
  checkedAt: '2026-10-14',
  method: 'independent recomputation',
  allergenAndDietRechecked: true,
};

function reviewReq(slug: string, body: unknown) {
  return new Request(`http://localhost/api/admin/recipes/${slug}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof reviewPOST>[0];
}

async function reviewPost(slug: string, body: unknown) {
  return (await reviewPOST(reviewReq(slug, body), {
    params: { slug },
  })) as NextResponse;
}

function patchReq(id: string, body: unknown) {
  return new Request(`http://localhost/api/recipes/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof recipePATCH>[0];
}

async function patch(id: string, body: unknown) {
  return (await recipePATCH(patchReq(id, body), {
    params: { slug: id },
  })) as NextResponse;
}

/** Seed an owner-editable private recipe. Returns its contentHash. */
function seedEditable(id: string, opts?: { contentHash?: string | null; verified?: boolean }) {
  const verified = opts?.verified ?? false;
  const content = {
    ingredients: [{ name: 'oats', grams: 100 }],
    servings: 2,
    dietCategory: 'vegetarian',
    yieldGrams: null as number | null,
    tags: [] as string[],
    allergens: [] as string[],
  };
  const hash = opts?.contentHash === undefined ? computeRecipeContentHash(content) : opts.contentHash;
  store.set(id, {
    id,
    slug: id,
    title: `Guard ${id}`,
    userId: 'user-1',
    isPrivate: true,
    dietCategory: 'vegetarian',
    tags: [],
    servings: 2,
    prepMin: 5,
    cookMin: 10,
    difficulty: 'easy',
    ingredients: [{ name: 'oats', grams: 100 }],
    instructions: ['mix'],
    kcalPerServing: 100,
    proteinPerServing: 5,
    carbsPerServing: 10,
    fatPerServing: 3,
    fiberPerServing: 1,
    yieldGrams: null,
    allergens: [],
    needsReview: false,
    verified,
    verificationEvidence: verified ? { ...VERIFY_EVIDENCE, checkedBy: 'admin@example.com' } : null,
    reviewEvidence: verified ? { ...REVIEW_EVIDENCE, reviewer: 'admin@example.com' } : null,
    contentHash: hash,
    revision: 0,
  });
  return hash as string | null;
}

/** Seed an admin-reviewable recipe. contentHash 'hash-aaa' unless given. */
function seedReviewable(slug: string, opts?: { contentHash?: string | null; reviewed?: boolean; verified?: boolean }) {
  const hash = opts?.contentHash === undefined ? 'hash-aaa' : opts.contentHash;
  store.set(slug, {
    id: slug,
    slug,
    title: `Guard Review ${slug}`,
    verified: opts?.verified ?? false,
    verificationEvidence: opts?.verified ? { ...VERIFY_EVIDENCE, checkedBy: 'admin@example.com' } : null,
    reviewEvidence: opts?.reviewed || opts?.verified ? { ...REVIEW_EVIDENCE, reviewer: 'admin@example.com' } : null,
    needsReview: false,
    ingredients: [{ name: 'oats', grams: 100, nutritionStatus: 'ok' }],
    contentHash: hash,
    revision: 0,
  });
  return hash as string | null;
}

beforeEach(() => {
  store.clear();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue(ADMIN_SESSION);
  mockRequireUser.mockReset();
  mockRequireUser.mockResolvedValue(OWNER_SESSION);
  recipeModel.updateMany.mockClear();
});

describe('v21.6 guard enforcement — recipe PATCH', () => {
  it('material PATCH (portions) WITHOUT expectedContentHash → 409 stale_recipe, nothing written, evidence NOT invalidated', async () => {
    const beforeHash = seedEditable('g1', { verified: true });
    const res = await patch('g1', { portions: 4 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('stale_recipe');
    // Actionable: the message tells the client to reload and resend the
    // guard — the write never lands unconditionally.
    expect(body.error.message).toMatch(/expectedContentHash/i);
    expect(body.error.message).toMatch(/reload/i);
    // A rejected write has NO side effects: no recalculation, no
    // invalidation of the evidence it would have lapsed.
    const stored = store.get('g1')!;
    expect(stored.servings).toBe(2);
    expect(stored.contentHash).toBe(beforeHash);
    expect(stored.verified).toBe(true);
    expect(stored.reviewEvidence).not.toBeNull();
    expect(stored.verificationEvidence).not.toBeNull();
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
  });

  it('metadata-only PATCH (prepMin) WITHOUT expectedContentHash → 409 stale_recipe (the guard is required on EVERY PATCH — §5), nothing written', async () => {
    seedEditable('g2');
    const res = await patch('g2', { prepMin: 12 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('g2')!.prepMin).toBe(5);
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
  });

  it('two simultaneous edits: the second (still carrying the old hash) 409s — no silent overwrite', async () => {
    const h1 = seedEditable('g3');
    // Edit A wins with the fresh guard.
    const resA = await patch('g3', { portions: 4, expectedContentHash: h1, expectedRevision: 0 });
    expect(resA.status).toBe(200);
    const storedAfterA = store.get('g3')!;
    expect(storedAfterA.servings).toBe(4);
    const h2 = storedAfterA.contentHash as string;
    expect(h2).not.toBe(h1);
    // Edit B still carries h1 → 409; B's change never lands.
    const resB = await patch('g3', { name: 'Stale Rename', expectedContentHash: h1, expectedRevision: 0 });
    expect(resB.status).toBe(409);
    expect((await resB.json()).error.code).toBe('stale_recipe');
    const storedAfterB = store.get('g3')!;
    expect(storedAfterB.title).not.toBe('Stale Rename');
    expect(storedAfterB.contentHash).toBe(h2);
  });

  it('PATCH with EXPLICIT null on a legacy NULL-hash row → 200; the write is conditional on contentHash IS NULL', async () => {
    seedEditable('g4', { contentHash: null });
    const res = await patch('g4', { prepMin: 9, expectedContentHash: null, expectedRevision: 0 });
    expect(res.status).toBe(200);
    expect(recipeModel.updateMany).toHaveBeenCalled();
    const where = recipeModel.updateMany.mock.calls[0][0].where;
    expect(where.id).toBe('g4');
    expect(where.contentHash).toBeNull();
    // v21.7: the legacy NULL-hash row still carries the revision token
    // (0 — the migration default) in the guard pair.
    expect(where.revision).toBe(0);
    // The row is no longer legacy — a real hash was written with the content.
    const stored = store.get('g4')!;
    expect(stored.prepMin).toBe(9);
    expect(typeof stored.contentHash).toBe('string');
  });

  it('PATCH with EXPLICIT null when the row is already hashed (a concurrent edit moved it) → 409', async () => {
    const h1 = seedEditable('g5');
    expect(h1).not.toBeNull();
    const res = await patch('g5', { prepMin: 9, expectedContentHash: null, expectedRevision: 0 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('g5')!.prepMin).toBe(5);
  });

  it('PATCH responses include the CURRENT contentHash (non-null, equal to the stored revision)', async () => {
    const h1 = seedEditable('g6');
    const res = await patch('g6', { portions: 3, expectedContentHash: h1, expectedRevision: 0 });
    expect(res.status).toBe(200);
    const body = await res.json();
    const stored = store.get('g6')!;
    expect(typeof body.recipe.contentHash).toBe('string');
    expect(body.recipe.contentHash).toBe(stored.contentHash);
    expect(body.recipe.contentHash).not.toBe(h1);
  });

  it('the PATCH schema accepts explicit null (legacy rows) and undefined; the ROUTE — not the schema — rejects the absent guard', async () => {
    expect(
      CustomRecipePatchSchema.safeParse({ prepMin: 3, expectedContentHash: null }).success,
    ).toBe(true);
    expect(
      CustomRecipePatchSchema.safeParse({ prepMin: 3 }).success,
    ).toBe(true);
    expect(
      CustomRecipePatchSchema.safeParse({ prepMin: 3, expectedContentHash: '' }).success,
    ).toBe(false);
  });

  it('serializeRecipePublic keeps contentHash on the wire (recipe detail GET contract) — null for legacy rows, string for hashed', async () => {
    const hashed = serializeRecipePublic(
      { contentHash: 'hash-xyz', verified: false, verificationEvidence: null, reviewEvidence: null, needsReview: false },
      false,
    ) as unknown as { contentHash: unknown };
    expect(hashed.contentHash).toBe('hash-xyz');
    const legacy = serializeRecipePublic(
      { contentHash: null, verified: false, verificationEvidence: null, reviewEvidence: null, needsReview: false },
      false,
    ) as unknown as { contentHash: unknown };
    expect(legacy.contentHash).toBeNull();
  });
});

describe('v21.6 guard enforcement — admin review/verify/clear', () => {
  it('review WITHOUT expectedContentHash → 409 stale_recipe (missing-guard code pinned), nothing written', async () => {
    seedReviewable('r1', { contentHash: null });
    const res = await reviewPost('r1', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('stale_recipe');
    expect(body.error.message).toMatch(/expectedContentHash/i);
    expect(store.get('r1')!.reviewEvidence).toBeNull();
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
  });

  it('verify WITHOUT expectedContentHash → 409 stale_recipe (the guard check runs before any evidence check)', async () => {
    seedReviewable('r2', { reviewed: true });
    const res = await reviewPost('r2', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('r2')!.verified).toBe(false);
  });

  it('clear WITHOUT expectedContentHash → 409 stale_recipe (clear is a guarded workflow too)', async () => {
    seedReviewable('r3', { verified: true, reviewed: true });
    const res = await reviewPost('r3', { action: 'clear' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('r3')!.verified).toBe(true);
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
  });

  it('review with EXPLICIT null on a legacy NULL-hash row → 200; conditional write on contentHash IS NULL', async () => {
    seedReviewable('r4', { contentHash: null });
    const res = await reviewPost('r4', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: null,
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.tier).toBe('reviewed');
    expect(recipeModel.updateMany).toHaveBeenCalled();
    const where = recipeModel.updateMany.mock.calls[0][0].where;
    expect(where.slug).toBe('r4');
    expect(where.contentHash).toBeNull();
    // v21.7: the guard pair — the review route matches the revision too.
    expect(where.revision).toBe(0);
    // The reviewer identity is server-set (anti-forgery untouched).
    expect(
      (store.get('r4')!.reviewEvidence as { reviewer: string }).reviewer,
    ).toBe('admin@example.com');
    // The response carries the current revision (still null — reviews do
    // not move the hash).
    expect(body.recipe.contentHash).toBeNull();
  });

  it('verify with EXPLICIT null on a legacy NULL-hash row → 200 verified', async () => {
    seedReviewable('r5', { reviewed: true, contentHash: null });
    const res = await reviewPost('r5', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      expectedContentHash: null,
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.tier).toBe('verified');
    expect(body.recipe.verified).toBe(true);
    expect(store.get('r5')!.verified).toBe(true);
    expect(body.recipe.contentHash).toBeNull(); // pinned: still null
  });

  it('stale review submission (hash moved since the GET) → 409, nothing recorded', async () => {
    seedReviewable('r6');
    const res = await reviewPost('r6', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-stale',
      expectedRevision: 0,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('r6')!.reviewEvidence).toBeNull();
  });

  it('admin verify vs concurrent ingredient change: the verify 409s — the stale write can never resurrect invalidated evidence', async () => {
    // A reviewed+verified recipe at revision h1.
    const h1 = seedEditable('r7', { verified: true });
    // A concurrent material PATCH lands first (fresh guard h1): the
    // evidence lapses AND the hash moves to h2 — atomically, in the same
    // conditional update.
    const pRes = await patch('r7', { portions: 5, expectedContentHash: h1, expectedRevision: 0 });
    expect(pRes.status).toBe(200);
    const afterPatch = store.get('r7')!;
    expect(afterPatch.verified).toBe(false);
    expect(afterPatch.reviewEvidence).toBeNull();
    expect(afterPatch.verificationEvidence).toBeNull();
    const h2 = afterPatch.contentHash as string;
    expect(h2).not.toBe(h1);
    // The admin's verify still carries the OLD guard h1 (they reviewed the
    // old content) → 409. The stale write fails; the invalidated evidence
    // is NOT restored.
    const vRes = await reviewPost('r7', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      reviewEvidence: REVIEW_EVIDENCE,
      expectedContentHash: h1,
      expectedRevision: 0,
    });
    expect(vRes.status).toBe(409);
    expect((await vRes.json()).error.code).toBe('stale_recipe');
    const afterVerify = store.get('r7')!;
    expect(afterVerify.verified).toBe(false);
    expect(afterVerify.reviewEvidence).toBeNull();
    expect(afterVerify.verificationEvidence).toBeNull();
    expect(afterVerify.contentHash).toBe(h2);
  });

  it('review POST responses include the current contentHash', async () => {
    seedReviewable('r8'); // 'hash-aaa'
    const res = await reviewPost('r8', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).recipe.contentHash).toBe('hash-aaa');
  });
});
