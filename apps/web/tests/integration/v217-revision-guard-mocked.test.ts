/**
 * v21.7 PRIORITY 1 — revision token for review-state concurrency (mocked,
 * runs on this VM).
 *
 * THE DEFECT: `expectedContentHash` does not change on review/verify/clear
 * (they touch no recipe content), so two concurrent admin actions could
 * pass the SAME hash guard and silently overwrite each other's review
 * state. v21.7 closes this with `revision`: a mutation counter that
 * increments on EVERY recipe or review-state mutation — material PATCH,
 * metadata-only PATCH, admin review, admin verify, admin clear — in the
 * SAME atomic conditional updateMany as the mutation itself
 * (recipe-governance.ts §5b). The client sends the (hash, revision) pair
 * it read; the write lands only if BOTH still match; zero matched rows →
 * 409 `stale_recipe`.
 *
 * This file pins the v21.7 contract with the REAL review POST, the REAL
 * recipe PATCH, the REAL zod patch schema, and the REAL computeRecipeContentHash:
 *  - absent expectedRevision → 409 `stale_recipe` with an actionable
 *    message naming expectedRevision (PATCH, review, verify, clear);
 *  - stale expectedRevision (correct hash, wrong revision) → 409;
 *  - malformed expectedRevision (negative, non-integer) → 400;
 *  - two simultaneous mutations carrying the same pair → exactly one 200
 *    and one 409 (the loser never overwrites the winner);
 *  - clear vs verify race: the stale clear 409s, the verification is
 *    NOT undone;
 *  - review vs clear race: the stale review 409s, the cleared state stays;
 *  - review vs review race: the second 409s, the first review's evidence
 *    is intact;
 *  - edit vs review race, both directions: the stale side 409s and the
 *    winner's state is intact;
 *  - metadata-only PATCH increments revision but preserves review AND
 *    verification evidence (content-evidence invalidation policy is §1
 *    and unchanged by the revision token — it does not move the hash
 *    either, since the content is identical);
 *  - legacy pre-v21.7 rows (no revision field) guard with explicit
 *    expectedRevision: 0 and the write lands;
 *  - GET prefill and all write responses carry the current revision;
 *  - the revision token never counts as a material edit.
 *
 * Mocks `@fitfusion/db` (in-memory store + conditional-write updateMany),
 * `@/lib/admin`, `@/lib/auth`.
 *
 * HONESTY LABEL — READ BEFORE CITING THESE TESTS AS PROOF: the mocked
 * suites exercise the REAL route code but replace PostgreSQL with an
 * in-memory map. The map cannot race the way PostgreSQL does: "simultaneous"
 * calls here serialize through JavaScript's single-threaded event loop, so
 * they prove the ROUTES issue the conditional (hash, revision) writes and
 * interpret zero-row results as 409 — they DO NOT prove the database's
 * atomic compare-and-write behavior under genuine concurrency. The REAL
 * concurrency proof is the DB-gated suite v217-revision-guard-db.test.ts
 * — skip-guarded here, pending a database.
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
      // Prisma `{ increment: n }` token, exactly like the real client.
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
  // A missing/undefined stored hash is SQL NULL (like Prisma); a
  // missing/undefined stored revision is SQL 0 (the migration default).
  const hashOf = (row: Record<string, unknown>) => (row.contentHash ?? null) as string | null;
  const revOf = (row: Record<string, unknown>) => (row.revision ?? 0) as number;
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
  // Conditional write: lands only when the (id|slug, contentHash, revision)
  // triple matches — exactly the shape the v21.7 routes issue.
  // Zero matched rows → { count: 0 } (the route answers 409).
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
      if (where.revision !== undefined && revOf(row) !== where.revision) {
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
  GET as reviewGET,
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

async function reviewGet(slug: string) {
  const req = new Request(`http://localhost/api/admin/recipes/${slug}/review`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  }) as unknown as Parameters<typeof reviewGET>[0];
  return (await reviewGET(req, { params: { slug } })) as NextResponse;
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
    title: `Rev ${id}`,
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
    contentHash: computeRecipeContentHash(content),
    revision: 0,
  });
  return computeRecipeContentHash(content);
}

function seedReviewable(slug: string, opts?: { reviewed?: boolean; verified?: boolean }) {
  store.set(slug, {
    id: slug,
    slug,
    title: `Rev Review ${slug}`,
    verified: opts?.verified ?? false,
    verificationEvidence: opts?.verified ? { ...VERIFY_EVIDENCE, checkedBy: 'admin@example.com' } : null,
    reviewEvidence: opts?.reviewed || opts?.verified ? { ...REVIEW_EVIDENCE, reviewer: 'admin@example.com' } : null,
    needsReview: false,
    ingredients: [{ name: 'oats', grams: 100, nutritionStatus: 'ok' }],
    contentHash: 'hash-aaa',
    revision: 0,
  });
}

beforeEach(() => {
  store.clear();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue(ADMIN_SESSION);
  mockRequireUser.mockReset();
  mockRequireUser.mockResolvedValue(OWNER_SESSION);
  recipeModel.updateMany.mockClear();
});

describe('v21.7 guard pair — missing expectedRevision → 409', () => {
  it('PATCH WITHOUT expectedRevision (hash present) → 409 stale_recipe naming expectedRevision, nothing written', async () => {
    const h1 = seedEditable('m1');
    const res = await patch('m1', { prepMin: 12, expectedContentHash: h1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('stale_recipe');
    expect(body.error.message).toMatch(/expectedRevision/i);
    expect(body.error.message).toMatch(/reload/i);
    const stored = store.get('m1')!;
    expect(stored.prepMin).toBe(5);
    expect(stored.revision).toBe(0);
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
  });

  it('review WITHOUT expectedRevision → 409 stale_recipe (missing-revision code pinned), nothing written', async () => {
    seedReviewable('m2');
    const res = await reviewPost('m2', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('stale_recipe');
    expect(body.error.message).toMatch(/expectedRevision/i);
    expect(store.get('m2')!.reviewEvidence).toBeNull();
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
  });

  it('verify WITHOUT expectedRevision → 409 stale_recipe, nothing verified', async () => {
    seedReviewable('m3', { reviewed: true });
    const res = await reviewPost('m3', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      expectedContentHash: 'hash-aaa',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('m3')!.verified).toBe(false);
  });

  it('clear WITHOUT expectedRevision → 409 stale_recipe, status intact', async () => {
    seedReviewable('m4', { verified: true, reviewed: true });
    const res = await reviewPost('m4', {
      action: 'clear',
      expectedContentHash: 'hash-aaa',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('m4')!.verified).toBe(true);
    expect(recipeModel.updateMany).not.toHaveBeenCalled();
  });
});

describe('v21.7 guard pair — malformed expectedRevision → 400', () => {
  it('PATCH with negative expectedRevision → schema 400 (the route never sees it)', async () => {
    seedEditable('x1');
    const res = await patch('x1', { prepMin: 3, expectedContentHash: 'hash-x', expectedRevision: -1 });
    expect(res.status).toBe(400);
  });

  it('PATCH with non-integer expectedRevision → schema 400', async () => {
    seedEditable('x2');
    const res = await patch('x2', { prepMin: 3, expectedContentHash: 'hash-x', expectedRevision: 1.5 });
    expect(res.status).toBe(400);
  });

  it('review with non-integer expectedRevision → 400 validation_error', async () => {
    seedReviewable('x3');
    const res = await reviewPost('x3', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 'zero',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation_error');
  });

  it('the schema accepts a non-negative integer revision', () => {
    expect(
      CustomRecipePatchSchema.safeParse({
        prepMin: 3,
        expectedContentHash: 'h',
        expectedRevision: 0,
      }).success,
    ).toBe(true);
    expect(
      CustomRecipePatchSchema.safeParse({
        prepMin: 3,
        expectedContentHash: 'h',
        expectedRevision: 42,
      }).success,
    ).toBe(true);
    expect(
      CustomRecipePatchSchema.safeParse({
        prepMin: 3,
        expectedContentHash: 'h',
        expectedRevision: -1,
      }).success,
    ).toBe(false);
  });
});

describe('v21.7 guard pair — stale revision → 409 (correct hash, wrong revision)', () => {
  it('PATCH with the right hash but a WRONG revision → 409, recipe untouched', async () => {
    const h1 = seedEditable('s1');
    const res = await patch('s1', { prepMin: 12, expectedContentHash: h1, expectedRevision: 99 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    const stored = store.get('s1')!;
    expect(stored.prepMin).toBe(5);
    expect(stored.revision).toBe(0);
  });

  it('review with the right hash but a WRONG revision → 409, nothing recorded', async () => {
    seedReviewable('s2');
    const res = await reviewPost('s2', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 7,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_recipe');
    expect(store.get('s2')!.reviewEvidence).toBeNull();
  });

  it('the write is conditional on the PAIR: both halves are in the where', async () => {
    const h1 = seedEditable('s3');
    const res = await patch('s3', { prepMin: 9, expectedContentHash: h1, expectedRevision: 0 });
    expect(res.status).toBe(200);
    const where = recipeModel.updateMany.mock.calls[0][0].where;
    expect(where.id).toBe('s3');
    expect(where.contentHash).toBe(h1);
    expect(where.revision).toBe(0);
    // …and the SAME statement increments the revision.
    expect(recipeModel.updateMany.mock.calls[0][0].data.revision).toEqual({ increment: 1 });
    expect(store.get('s3')!.revision).toBe(1);
  });
});

describe('v21.7 review-state races (mocked — see honesty label in the file header)', () => {
  it('clear vs verify race: a verify lands, then a STALE clear (same hash, old revision) 409s — the verification is NOT undone', async () => {
    seedReviewable('c1', { reviewed: true });
    // The verifier's write lands first: revision 0 → 1.
    const v = await reviewPost('c1', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(v.status).toBe(200);
    expect(store.get('c1')!.verified).toBe(true);
    expect(store.get('c1')!.revision).toBe(1);
    // The admin holding the pre-verify prefill clears with the OLD
    // revision. The hash never moved (clear/verify touch no content), so
    // under v21.6 this write would have LANDED and silently undone the
    // verification. With the revision token it 409s.
    const c = await reviewPost('c1', {
      action: 'clear',
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(c.status).toBe(409);
    expect((await c.json()).error.code).toBe('stale_recipe');
    const after = store.get('c1')!;
    expect(after.verified).toBe(true);
    expect(after.verificationEvidence).not.toBeNull();
    expect(after.reviewEvidence).not.toBeNull();
    expect(after.revision).toBe(1);
  });

  it('review vs clear race: a clear lands, then a STALE review (same hash, old revision) 409s — the cleared state stays', async () => {
    seedReviewable('c2', { reviewed: true, verified: true });
    const c = await reviewPost('c2', {
      action: 'clear',
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(c.status).toBe(200);
    const cleared = store.get('c2')!;
    expect(cleared.verified).toBe(false);
    expect(cleared.reviewEvidence).toBeNull();
    expect(cleared.revision).toBe(1);
    // The reviewer still holds the pre-clear prefill (same hash — clear
    // touches no content). Their review must not resurrect evidence.
    const r = await reviewPost('c2', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('stale_recipe');
    expect(store.get('c2')!.reviewEvidence).toBeNull();
    expect(store.get('c2')!.verified).toBe(false);
    expect(store.get('c2')!.revision).toBe(1);
  });

  it('review vs review race: the first review lands, the second (stale revision) 409s — the first review is intact', async () => {
    seedReviewable('c3');
    const r1 = await reviewPost('c3', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(r1.status).toBe(200);
    const body1 = await r1.json();
    // The response carries the NEW revision for the next write.
    expect(body1.recipe.revision).toBe(1);
    // The second admin's review carries the old revision.
    const r2 = await reviewPost('c3', {
      action: 'review',
      evidence: { ...REVIEW_EVIDENCE, reference: 'second opinion' },
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(r2.status).toBe(409);
    expect((await r2.json()).error.code).toBe('stale_recipe');
    const stored = store.get('c3')!;
    expect((stored.reviewEvidence as { reference: string }).reference).toBe('photo of nutrition label');
    expect(stored.revision).toBe(1);
  });

  it('edit vs review race (review wins): a review lands, then a STALE owner PATCH (same hash, old revision) 409s — the review state is intact', async () => {
    const h1 = seedEditable('e1');
    const r = await reviewPost('e1', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: h1,
      expectedRevision: 0,
    });
    expect(r.status).toBe(200);
    expect(store.get('e1')!.revision).toBe(1);
    // The owner's PATCH still carries the pre-review pair. The hash is
    // unchanged (reviews touch no content), so the revision is what fails.
    const p = await patch('e1', { prepMin: 99, expectedContentHash: h1, expectedRevision: 0 });
    expect(p.status).toBe(409);
    expect((await p.json()).error.code).toBe('stale_recipe');
    const stored = store.get('e1')!;
    expect(stored.prepMin).toBe(5);
    expect(stored.reviewEvidence).not.toBeNull();
    expect(stored.revision).toBe(1);
  });

  it('edit vs review race (edit wins): a PATCH lands, then a STALE review (old hash AND old revision) 409s — the edit is intact', async () => {
    const h1 = seedEditable('e2');
    const p = await patch('e2', { prepMin: 21, expectedContentHash: h1, expectedRevision: 0 });
    expect(p.status).toBe(200);
    const after = store.get('e2')!;
    expect(after.revision).toBe(1);
    // The metadata-only edit did NOT move the hash (same content → same
    // hash) — the 409 below is decided by the REVISION token alone. This
    // is precisely the hole v21.7 closes: under the hash-only guard this
    // review would have LANDED on a newer review state.
    expect(after.contentHash).toBe(h1);
    const r = await reviewPost('e2', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: h1,
      expectedRevision: 0,
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('stale_recipe');
    expect(store.get('e2')!.reviewEvidence).toBeNull();
    expect(store.get('e2')!.revision).toBe(1);
  });

  it('two simultaneous mutations carrying the same pair → exactly one 200 and one 409 (the loser never overwrites the winner)', async () => {
    const h1 = seedEditable('t1');
    // NOTE the honesty label in the file header: the map cannot race
    // like PostgreSQL — this proves both writers go through the same
    // conditional write and the loser reads zero rows.
    const [a, b] = await Promise.all([
      patch('t1', { prepMin: 30, expectedContentHash: h1, expectedRevision: 0 }),
      reviewPost('t1', {
        action: 'review',
        evidence: REVIEW_EVIDENCE,
        expectedContentHash: h1,
        expectedRevision: 0,
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const stored = store.get('t1')!;
    expect(stored.revision).toBe(1);
    if (a.status === 200) {
      expect(stored.prepMin).toBe(30);
      expect(stored.reviewEvidence).toBeNull();
    } else {
      expect(stored.prepMin).toBe(5);
      expect(stored.reviewEvidence).not.toBeNull();
    }
  });
});

describe('v21.7 revision token semantics', () => {
  it('metadata-only PATCH increments revision but PRESERVES review + verification evidence and does NOT move the content hash', async () => {
    const h1 = seedEditable('sem1', { verified: true });
    const res = await patch('sem1', { prepMin: 12, expectedContentHash: h1, expectedRevision: 0 });
    expect(res.status).toBe(200);
    const body = await res.json();
    const stored = store.get('sem1')!;
    // The mutation counter moved…
    expect(stored.revision).toBe(1);
    expect(body.recipe.revision).toBe(1);
    // …but the content identity did not (identical content → identical hash)…
    expect(stored.contentHash).toBe(h1);
    expect(body.recipe.contentHash).toBe(h1);
    // …and the §1 evidence policy is untouched by the revision token:
    // metadata-only edits preserve evidence.
    expect(stored.verified).toBe(true);
    expect(stored.reviewEvidence).not.toBeNull();
    expect(stored.verificationEvidence).not.toBeNull();
  });

  it('a material PATCH moves BOTH the hash and the revision, and lapses evidence per §1', async () => {
    const h1 = seedEditable('sem2', { verified: true });
    const res = await patch('sem2', { portions: 4, expectedContentHash: h1, expectedRevision: 0 });
    expect(res.status).toBe(200);
    const stored = store.get('sem2')!;
    expect(stored.revision).toBe(1);
    expect(stored.contentHash).not.toBe(h1);
    expect(stored.verified).toBe(false);
    expect(stored.reviewEvidence).toBeNull();
    expect(stored.verificationEvidence).toBeNull();
  });

  it('legacy pre-v21.7 rows (no revision field — treated as SQL 0) guard with explicit expectedRevision: 0', async () => {
    seedReviewable('leg1');
    // Simulate a row written before the v21.7 migration: no revision
    // column value at all.
    const row = store.get('leg1')!;
    delete row.revision;
    const res = await reviewPost('leg1', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(res.status).toBe(200);
    expect(store.get('leg1')!.revision).toBe(1);
  });

  it('GET prefill returns the current revision (0 for pre-v21.7 rows)', async () => {
    seedReviewable('g1');
    const res = await reviewGet('g1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision).toBe(0);
    expect(body.contentHash).toBe('hash-aaa');
  });

  it('review POST responses carry the NEW revision; the next write must use it', async () => {
    seedReviewable('g2');
    const r1 = await reviewPost('g2', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: 'hash-aaa',
      expectedRevision: 0,
    });
    expect(r1.status).toBe(200);
    const fresh = (await r1.json()).recipe.revision as number;
    expect(fresh).toBe(1);
    const r2 = await reviewPost('g2', {
      action: 'clear',
      expectedContentHash: 'hash-aaa',
      expectedRevision: fresh,
    });
    expect(r2.status).toBe(200);
    expect((await r2.json()).recipe.revision).toBe(2);
    expect(store.get('g2')!.revision).toBe(2);
  });

  it('the revision token never counts as a material edit — a guard-only write lapses nothing', async () => {
    const h1 = seedEditable('sem3', { verified: true });
    // prepMin-only edit with the full pair: metadata, so the hash is
    // identical and evidence survives; the revision still bumps (it is a
    // mutation, §5b).
    const res = await patch('sem3', { prepMin: 7, expectedContentHash: h1, expectedRevision: 0 });
    expect(res.status).toBe(200);
    const stored = store.get('sem3')!;
    expect(stored.contentHash).toBe(h1);
    expect(stored.revision).toBe(1);
    expect(stored.verified).toBe(true);
    expect(stored.reviewEvidence).not.toBeNull();
  });

  it('serializeRecipePublic keeps revision on the wire (recipe detail GET contract)', async () => {
    const shaped = serializeRecipePublic(
      { revision: 3, contentHash: 'hash-xyz', verified: false, verificationEvidence: null, reviewEvidence: null, needsReview: false },
      false,
    ) as unknown as { revision: unknown };
    expect(shaped.revision).toBe(3);
  });

  it('a rejected write has NO side effects — no revision bump, no invalidation', async () => {
    const h1 = seedEditable('sem4', { verified: true });
    const res = await patch('sem4', { portions: 9, expectedContentHash: h1, expectedRevision: 12345 });
    expect(res.status).toBe(409);
    const stored = store.get('sem4')!;
    expect(stored.servings).toBe(2);
    expect(stored.revision).toBe(0);
    expect(stored.contentHash).toBe(h1);
    expect(stored.verified).toBe(true);
    expect(stored.reviewEvidence).not.toBeNull();
  });
});
