/**
 * Stale admin reviews / stale PATCH writes — mocked, no DB.
 *
 * v21.6 CONTRACT (this file was rewritten from the v21.5 P4 suite when the
 * guard became REQUIRED — recipe-governance.ts §5): there is no longer a
 * silent unconditional write path. A guarded workflow (material or
 * metadata-only recipe PATCH, admin review / verify / clear) with an
 * ABSENT `expectedContentHash` is rejected with 409 `stale_recipe` and an
 * actionable message (reload the recipe/prefill and retry). Legacy
 * NULL-hash rows use the EXPLICIT `null` guard: the write is conditional
 * on contentHash IS NULL — a concurrent edit moves the hash to non-null
 * and the write 409s exactly like a hash mismatch.
 *
 * Mocks `@fitfusion/db` (in-memory recipe store with a conditional-write
 * updateMany), `@/lib/admin`, and `@/lib/auth`. The REAL review POST, the
 * REAL recipe PATCH, the REAL zod patch schema, and the REAL
 * computeRecipeContentHash execute:
 *
 *  review POST:
 *  - stale expectedContentHash → 409 stale_recipe, nothing written;
 *  - fresh expectedContentHash → proceeds (200);
 *  - ABSENT expectedContentHash → 409 stale_recipe (guard is required;
 *    the pre-v21.5 unguarded path was removed in v21.6), nothing written;
 *  - explicit null on a legacy NULL-hash row → conditional write succeeds;
 *  - verify: needsReview flipped true between the initial read and the
 *    write → 400 incomplete_nutrition, no write (defense in depth);
 *  - GET returns contentHash for the admin UI prefill (null for legacy).
 *
 *  recipe PATCH:
 *  - stale expectedContentHash → 409 stale_recipe, recipe untouched
 *    (no invalidation side effects from a rejected write);
 *  - fresh expectedContentHash → 200 and the stored contentHash is
 *    recomputed from the merged post-write content in the same update;
 *  - metadata-only edit (name) WITHOUT a guard → 409 (the guard is
 *    required on every PATCH, not just material edits — §5);
 *  - ingredient edit WITHOUT a guard → 409 (the silent fallback is gone);
 *  - explicit null on a legacy NULL-hash row → 200; explicit null when
 *    the row is already hashed → 409.
 *
 * NOTE on what these mocked tests prove: they exercise the REAL route
 * logic (schema parsing, guard checks, conditional updateMany calls) but
 * the "conditional write" here is an in-memory map — it cannot prove
 * PostgreSQL's atomic compare-and-write behavior under real concurrency.
 * The real concurrency proof is the DB-gated suite
 * (v216-concurrency-guards-db.test.ts), skip-guarded here pending a DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { computeRecipeContentHash } from '@fitfusion/core';

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
  const matchesWhere = (
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ) => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.slug !== undefined && row.slug !== where.slug) return false;
    // Conditional-write guard: a supplied contentHash must match exactly.
    if (
      where.contentHash !== undefined &&
      row.contentHash !== where.contentHash
    ) {
      return false;
    }
    // v21.7: the guard is the (hash, revision) pair — a supplied
    // revision token must match too.
    if (
      where.revision !== undefined &&
      (row.revision ?? 0) !== where.revision
    ) {
      return false;
    }
    return true;
  };
  const findByWhere = (where: Record<string, unknown>) => {
    for (const row of store.values()) {
      if (matchesWhere(row, where)) return row;
    }
    return null;
  };

  // v21.5 test hook: the review POST re-reads the recipe immediately before
  // a verify write. flipNeedsReviewOnNextRead makes the NEXT findUnique
  // report needsReview=true (simulating a concurrent PATCH landing
  // between the handler's initial read and its write).
  const hooks = { flipNeedsReviewOnNextRead: false };

  const findUnique = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const row = findByWhere(where);
    if (!row) return null;
    if (hooks.flipNeedsReviewOnNextRead) {
      hooks.flipNeedsReviewOnNextRead = false;
      return { ...row, needsReview: true };
    }
    return row;
  });
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
  const update = vi.fn(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const row = findByWhere(where);
      if (!row) throw new Error('not found');
      const next = apply(row, data);
      store.set(row.id as string, next);
      return next;
    },
  );
  const updateMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const row = findByWhere(where);
      if (!row) return { count: 0 };
      store.set(row.id as string, apply(row, data));
      return { count: 1 };
    },
  );
  const prisma = {
    __store: store,
    __hooks: hooks,
    recipe: { findUnique, findFirst, update, updateMany },
  };
  return { prisma, PrismaRuntime: { JsonNull: JSON_NULL } };
});

import { requireAdmin } from '@/lib/admin';
import { requireUser } from '@/lib/auth';
import { prisma } from '@fitfusion/db';
import {
  GET as reviewGET,
  POST as reviewPOST,
} from '@/app/api/admin/recipes/[slug]/review/route';
import { PATCH as recipePATCH } from '@/app/api/recipes/[slug]/route';

const mockRequireAdmin = requireAdmin as unknown as ReturnType<typeof vi.fn>;
const mockRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const store = (prisma as unknown as { __store: Map<string, Record<string, unknown>> }).__store;
const hooks = (prisma as unknown as { __hooks: { flipNeedsReviewOnNextRead: boolean } }).__hooks;
const recipeModel = (prisma as unknown as {
  recipe: { update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
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

/** Seed an admin-reviewable recipe. contentHash 'hash-aaa' unless given. */
function seedReviewable(
  slug: string,
  opts?: { contentHash?: string | null; reviewed?: boolean; needsReview?: boolean },
) {
  const hash = opts?.contentHash === undefined ? 'hash-aaa' : opts.contentHash;
  store.set(slug, {
    id: slug,
    slug,
    title: `Stale Gov ${slug}`,
    verified: false,
    verificationEvidence: null,
    reviewEvidence: opts?.reviewed ? { ...REVIEW_EVIDENCE, reviewer: 'admin@example.com' } : null,
    needsReview: opts?.needsReview ?? false,
    ingredients: [{ name: 'oats', grams: 100, nutritionStatus: 'ok' }],
    contentHash: hash,
    revision: 0,
  });
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

/** Seed an owner-editable private recipe with a computed content hash. */
function seedEditable(id: string, opts?: { verified?: boolean }) {
  const verified = opts?.verified ?? false;
  const content = {
    ingredients: [{ name: 'oats', grams: 100 }],
    servings: 2,
    dietCategory: 'vegetarian',
    yieldGrams: null as number | null,
    tags: [] as string[],
    allergens: [] as string[],
  };
  store.set(id, {
    id,
    slug: id,
    title: `Stale Patch ${id}`,
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
    verificationEvidence: verified ? { ...VERIFY_EVIDENCE } : null,
    reviewEvidence: verified
      ? { ...REVIEW_EVIDENCE, reviewer: 'admin@example.com' }
      : null,
    contentHash: computeRecipeContentHash(content),
    revision: 0,
  });
  return computeRecipeContentHash(content);
}

beforeEach(() => {
  store.clear();
  hooks.flipNeedsReviewOnNextRead = false;
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue(ADMIN_SESSION);
  mockRequireUser.mockReset();
  mockRequireUser.mockResolvedValue(OWNER_SESSION);
  for (const fn of [recipeModel.update, recipeModel.updateMany, recipeModel.findUnique]) {
    fn.mockClear();
  }
});

describe('review POST — optimistic concurrency (v21.5)', () => {
  it("review with a STALE expectedContentHash → 409 stale_recipe, nothing written", async () => {
    seedReviewable('s1');
    const res = await reviewPost('s1', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-stale',
      expectedRevision: 0,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('stale_recipe');
    // Nothing was written — the review was NOT recorded.
    expect(store.get('s1')!.reviewEvidence).toBeNull();
    expect(recipeModel.update).not.toHaveBeenCalled();
  });

  it('review with a FRESH expectedContentHash → 200, write proceeds', async () => {
    seedReviewable('s2');
    const res = await reviewPost('s2', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.tier).toBe('reviewed');
    expect(recipeModel.updateMany).toHaveBeenCalled();
    const stored = store.get('s2')!;
    expect(
      (stored.reviewEvidence as { reviewer: string }).reviewer,
    ).toBe('admin@example.com');
  });

  it('review WITHOUT expectedContentHash → 409 stale_recipe (the guard is required since v21.6), nothing written', async () => {
    seedReviewable('s3', { contentHash: null });
    const res = await reviewPost('s3', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('stale_recipe');
    // Actionable: the message tells the admin to reload and resend the
    // guard, never to retry blindly.
    expect(body.error.message).toMatch(/expectedContentHash/i);
    // Nothing was written — the review was NOT recorded.
    expect(store.get('s3')!.reviewEvidence).toBeNull();
    expect(recipeModel.update).not.toHaveBeenCalled();
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
  });

  it('review with EXPLICIT null on a legacy NULL-hash row → 200, conditional write on contentHash IS NULL', async () => {
    seedReviewable('s3b', { contentHash: null });
    const res = await reviewPost('s3b', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: null,
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.tier).toBe('reviewed');
    // The write went through the conditional path with a null guard —
    // never an unconditional write.
    expect(recipeModel.updateMany).toHaveBeenCalled();
    const where = recipeModel.updateMany.mock.calls[0][0].where;
    expect(where.slug).toBe('s3b');
    expect(where.contentHash).toBeNull();
  });

  it('review with EXPLICIT null when the row is already hashed (concurrent edit moved it) → 409', async () => {
    seedReviewable('s3c'); // 'hash-aaa'
    const res = await reviewPost('s3c', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: null,
      expectedRevision: 0,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('s3c')!.reviewEvidence).toBeNull();
  });

  it('malformed expectedContentHash → 400 validation_error, nothing written', async () => {
    seedReviewable('s4');
    const res = await reviewPost('s4', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 42,
      expectedRevision: 0,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation_error');
    expect(store.get('s4')!.reviewEvidence).toBeNull();
  });

  it("verify with a STALE expectedContentHash → 409, verification NOT recorded", async () => {
    seedReviewable('s5', { reviewed: true });
    const res = await reviewPost('s5', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      expectedContentHash: 'hash-stale',
      expectedRevision: 0,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('s5')!.verified).toBe(false);
  });

  it('verify refused when needsReview flipped true between the read and the write (defense in depth)', async () => {
    // Stored row is complete (reviewed, needsReview=false, NULL hash) — the
    // legacy row sends the EXPLICIT null guard (v21.6: no guard → 409, so
    // the defense-in-depth path would never be reached without it). The
    // re-read immediately before the write then sees needsReview=true (a
    // concurrent PATCH landed).
    seedReviewable('s6', { reviewed: true, contentHash: null });
    hooks.flipNeedsReviewOnNextRead = true;
    const res = await reviewPost('s6', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      expectedContentHash: null,
      expectedRevision: 0,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('incomplete_nutrition');
    // NO write happened — verification was refused before any update.
    expect(recipeModel.update).not.toHaveBeenCalled();
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
    expect(store.get('s6')!.verified).toBe(false);
  });

  it('GET returns the contentHash for the admin UI prefill', async () => {
    seedReviewable('s7');
    const res = (await reviewGET(
      new Request(`http://localhost/api/admin/recipes/s7/review`) as unknown as Parameters<
        typeof reviewGET
      >[0],
      { params: { slug: 's7' } },
    )) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contentHash).toBe('hash-aaa');
  });
});

describe('recipe PATCH — optimistic concurrency (v21.5)', () => {
  it('PATCH with a STALE expectedContentHash → 409, recipe untouched', async () => {
    seedEditable('p1', { verified: true });
    const res = await patch('p1', {
      portions: 4,
      expectedContentHash: 'hash-stale',
      expectedRevision: 0,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    // A rejected write has NO side effects: nutrition, servings, and the
    // old verification evidence are all exactly as before.
    const stored = store.get('p1')!;
    expect(stored.servings).toBe(2);
    expect(stored.verified).toBe(true);
    expect(stored.reviewEvidence).not.toBeNull();
    expect(stored.verificationEvidence).not.toBeNull();
  });

  it('PATCH with a FRESH expectedContentHash → 200; the stored hash is recomputed from the merged content in the same update', async () => {
    const beforeHash = seedEditable('p2', { verified: true });
    const res = await patch('p2', {
      portions: 4,
      expectedContentHash: beforeHash,
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    const stored = store.get('p2')!;
    expect(stored.servings).toBe(4);
    // The hash moved (servings are part of the canonical content) and
    // matches an independent recomputation over the post-write content.
    const expected = computeRecipeContentHash({
      ingredients: [{ name: 'oats', grams: 100 }],
      servings: 4,
      dietCategory: 'vegetarian',
      yieldGrams: null,
      tags: [],
      allergens: (stored.allergens as string[]) ?? [],
    });
    expect(stored.contentHash).toBe(expected);
    expect(stored.contentHash).not.toBe(beforeHash);
    // A material edit still invalidated the old evidence (unchanged policy).
    expect(stored.verified).toBe(false);
    expect(stored.reviewEvidence).toBeNull();
  });

  it('metadata-only PATCH (name) WITHOUT a guard → 409 (the guard is required on every PATCH, not just material edits — §5), nothing written', async () => {
    const beforeHash = seedEditable('p3', { verified: true });
    const res = await patch('p3', { name: 'Renamed Oats' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('stale_recipe');
    // A rejected write has NO side effects — the metadata-only change was
    // NOT applied unconditionally.
    const stored = store.get('p3')!;
    expect(stored.title).not.toBe('Renamed Oats');
    expect(stored.contentHash).toBe(beforeHash);
    expect(stored.verified).toBe(true);
    expect(stored.reviewEvidence).not.toBeNull();
    expect(stored.verificationEvidence).not.toBeNull();
  });

  it('ingredient PATCH WITHOUT a guard → 409 (the pre-v21.6 silent fallback is gone), nothing written', async () => {
    const beforeHash = seedEditable('p4', { verified: true });
    const res = await patch('p4', {
      ingredients: [{ ...DECLARED_OATS, name: 'barley', grams: 80 }],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    // Nothing was written — no invalidation, no recalculation.
    const stored = store.get('p4')!;
    expect(stored.contentHash).toBe(beforeHash);
    expect(stored.verified).toBe(true);
    expect(stored.reviewEvidence).not.toBeNull();
    expect(stored.verificationEvidence).not.toBeNull();
  });

  it('PATCH with EXPLICIT null on a legacy NULL-hash row → 200; the write is conditional on contentHash IS NULL', async () => {
    // Legacy row: seeded without a contentHash (NULL in production).
    store.set('p4b', {
      id: 'p4b',
      slug: 'p4b',
      title: 'Legacy Oats',
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
      verified: false,
      verificationEvidence: null,
      reviewEvidence: null,
      contentHash: null,
    });
    const res = await patch('p4b', {
      prepMin: 7,
      expectedContentHash: null,
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    const stored = store.get('p4b')!;
    expect(stored.prepMin).toBe(7);
    // The write computed a real hash for the row (it is no longer legacy).
    expect(typeof stored.contentHash).toBe('string');
    expect(stored.contentHash).not.toBeNull();
  });

  it('PATCH with EXPLICIT null when the row already has a hash (concurrent edit moved it) → 409', async () => {
    seedEditable('p4c', { verified: true });
    const res = await patch('p4c', {
      prepMin: 9,
      expectedContentHash: null,
      expectedRevision: 0,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('p4c')!.prepMin).not.toBe(9);
  });

  it('expectedContentHash never counts as a material edit (guard alone invalidates nothing)', async () => {
    const beforeHash = seedEditable('p5', { verified: true });
    // A PATCH whose only content key is the guard + a metadata field.
    const res = await patch('p5', {
      prepMin: 6,
      expectedContentHash: beforeHash,
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    const stored = store.get('p5')!;
    expect(stored.verified).toBe(true);
    expect(stored.contentHash).toBe(beforeHash);
  });
});
