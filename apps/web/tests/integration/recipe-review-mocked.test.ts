/**
 * Admin recipe review endpoint (v21.3) — FULL WORKFLOW, mocked (no DB).
 *
 * The DB-backed suite (recipe-review-admin.test.ts) skip-guards when no
 * PostgreSQL is reachable. This file mocks `@fitfusion/db` and `@/lib/admin`
 * so the entire happy path actually executes on this VM: evidence
 * validation, the verify-requires-review gate, the one-call
 * review+verify path, clear, and the server-set reviewer identity.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const { JSON_NULL } = vi.hoisted(() => ({ JSON_NULL: Symbol('prisma-json-null') }));

// ---- mocks (hoisted above imports) ----
vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@fitfusion/db', () => {
  const store = new Map<string, Record<string, unknown>>();
  const prisma = {
    __store: store,
    recipe: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        return store.get(where.slug) ?? null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { slug: string };
          data: Record<string, unknown>;
        }) => {
          const row = store.get(where.slug);
          if (!row) throw new Error('not found');
          const next = { ...row };
          for (const [k, v] of Object.entries(data)) {
            next[k] = v === JSON_NULL ? null : v;
          }
          store.set(where.slug, next);
          return next;
        },
      ),
    },
  };
  return { prisma, PrismaRuntime: { JsonNull: JSON_NULL } };
});

import { requireAdmin } from '@/lib/admin';
import { prisma } from '@fitfusion/db';
import {
  GET as reviewGET,
  POST as reviewPOST,
} from '@/app/api/admin/recipes/[slug]/review/route';

const mockRequireAdmin = requireAdmin as unknown as ReturnType<typeof vi.fn>;
const store = (prisma as unknown as { __store: Map<string, Record<string, unknown>> }).__store;

const ADMIN_SESSION = {
  user: { id: 'admin-1', email: 'admin@example.com', status: 'active' },
  profile: null,
  subscription: null,
};

function seedRecipe(slug: string) {
  store.set(slug, {
    slug,
    title: `Mocked ${slug}`,
    verified: false,
    verificationEvidence: null,
    reviewEvidence: null,
  });
}

function req(slug: string, method: string, body?: unknown) {
  return new Request(`http://localhost/api/admin/recipes/${slug}/review`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as Parameters<typeof reviewPOST>[0];
}

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

beforeEach(() => {
  store.clear();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue(ADMIN_SESSION);
});

describe('review happy path (mocked)', () => {
  it('review → tier reviewed; reviewer identity is server-set from the session', async () => {
    seedRecipe('m1');
    const res = (await reviewPOST(req('m1', 'POST', {
      action: 'review',
      // forged identity — the server must overwrite it with the session email
      evidence: { ...REVIEW_EVIDENCE, reviewer: 'mallory@example.com' },
    }), { params: { slug: 'm1' } })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.tier).toBe('reviewed');
    expect(body.recipe.reviewEvidence.reviewer).toBe('admin@example.com');
    expect(body.recipe.verified).toBe(false);
  });

  it('review with incomplete evidence → 400 (missing reference + rechecks)', async () => {
    seedRecipe('m2');
    const res = (await reviewPOST(req('m2', 'POST', {
      action: 'review',
      evidence: { reviewedAt: '2026-10-14', method: 'other' },
    }), { params: { slug: 'm2' } })) as NextResponse;
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details).toMatch(/reference/);
  });

  it('verify without any review record → 400', async () => {
    seedRecipe('m3');
    const res = (await reviewPOST(req('m3', 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
    }), { params: { slug: 'm3' } })) as NextResponse;
    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toMatch(/review/i);
  });

  it('verify accepts reviewEvidence in the same call → verified', async () => {
    seedRecipe('m4');
    const res = (await reviewPOST(req('m4', 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      reviewEvidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'm4' } })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.tier).toBe('verified');
    expect(body.recipe.verified).toBe(true);
    expect(body.recipe.verificationEvidence.checkedBy).toBe('admin@example.com');
    expect(body.recipe.reviewEvidence.reviewer).toBe('admin@example.com');
  });

  it('verify on an already-reviewed recipe (stored review suffices) → verified', async () => {
    seedRecipe('m5');
    await reviewPOST(req('m5', 'POST', { action: 'review', evidence: REVIEW_EVIDENCE }), {
      params: { slug: 'm5' },
    });
    const res = (await reviewPOST(req('m5', 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
    }), { params: { slug: 'm5' } })) as NextResponse;
    expect(res.status).toBe(200);
    expect((await res.json()).recipe.tier).toBe('verified');
  });

  it('clear destroys all status', async () => {
    seedRecipe('m6');
    await reviewPOST(req('m6', 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      reviewEvidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'm6' } });
    const res = (await reviewPOST(req('m6', 'POST', { action: 'clear' }), {
      params: { slug: 'm6' },
    })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.tier).toBe('calculated-estimate');
    expect(body.recipe.verified).toBe(false);
    expect(body.recipe.reviewEvidence).toBeNull();
    expect(body.recipe.verificationEvidence).toBeNull();
  });

  it('GET returns full evidence + session reviewer identity for admins', async () => {
    seedRecipe('m7');
    await reviewPOST(req('m7', 'POST', { action: 'review', evidence: REVIEW_EVIDENCE }), {
      params: { slug: 'm7' },
    });
    const res = (await reviewGET(req('m7', 'GET'), {
      params: { slug: 'm7' },
    })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('reviewed');
    expect(body.reviewer).toBe('admin@example.com');
    expect(body.reviewEvidence.reference).toBe('photo of nutrition label');
  });

  it('non-admin session → 403 passthrough from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: { code: 'forbidden', message: 'Admin access required' } },
        { status: 403 },
      ),
    );
    seedRecipe('m8');
    const res = (await reviewPOST(req('m8', 'POST', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'm8' } })) as NextResponse;
    expect(res.status).toBe(403);
  });

  it('missing recipe → 404', async () => {
    const res = (await reviewPOST(req('ghost', 'POST', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'ghost' } })) as NextResponse;
    expect(res.status).toBe(404);
  });
});

describe('v21.4 — review on a verified recipe resets the verification', () => {
  async function seedVerified(slug: string) {
    seedRecipe(slug);
    const res = (await reviewPOST(req(slug, 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      reviewEvidence: REVIEW_EVIDENCE,
    }), { params: { slug } })) as NextResponse;
    expect(res.status).toBe(200);
  }

  it("a bare 'review' on a verified recipe → verified=false, verification evidence destroyed", async () => {
    await seedVerified('r1');
    const res = (await reviewPOST(req('r1', 'POST', {
      action: 'review',
      evidence: { ...REVIEW_EVIDENCE, reference: 'second look, new label photo' },
    }), { params: { slug: 'r1' } })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    // The old verification is gone — never Verified on earlier evidence.
    expect(body.recipe.verified).toBe(false);
    expect(body.recipe.verificationEvidence).toBeNull();
    expect(body.recipe.verificationReset).toBe(true);
    // The new review IS recorded — tier drops to reviewed.
    expect(body.recipe.tier).toBe('reviewed');
    expect(body.recipe.reviewEvidence.reference).toBe(
      'second look, new label photo',
    );
    const stored = store.get('r1')!;
    expect(stored.verified).toBe(false);
    expect(stored.verificationEvidence).toBeNull();
  });

  it("'review' on a non-verified recipe leaves verification state alone", async () => {
    seedRecipe('r2');
    const res = (await reviewPOST(req('r2', 'POST', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'r2' } })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.verified).toBe(false);
    expect(body.recipe.verificationReset).toBe(false);
    expect(body.recipe.tier).toBe('reviewed');
  });

  it('re-verification after a reset succeeds only with fresh verification evidence', async () => {
    await seedVerified('r3');
    // Reset via a fresh review.
    await reviewPOST(req('r3', 'POST', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'r3' } });
    expect(store.get('r3')!.verified).toBe(false);

    // Stale attempt: incomplete verification evidence → still 400.
    const bad = (await reviewPOST(req('r3', 'POST', {
      action: 'verify',
      evidence: { checkedAt: '2026-10-14', method: 'other' },
    }), { params: { slug: 'r3' } })) as NextResponse;
    expect(bad.status).toBe(400);
    expect(store.get('r3')!.verified).toBe(false);

    // Fresh evidence in the supported verify workflow → verified again.
    const good = (await reviewPOST(req('r3', 'POST', {
      action: 'verify',
      evidence: { ...VERIFY_EVIDENCE, method: 'lab analysis' },
    }), { params: { slug: 'r3' } })) as NextResponse;
    expect(good.status).toBe(200);
    const body = await good.json();
    expect(body.recipe.verified).toBe(true);
    expect(body.recipe.tier).toBe('verified');
    expect(body.recipe.verificationEvidence.method).toBe('lab analysis');
  });
});

describe('v21.4 — incomplete nutrition can never be verified', () => {
  const INCOMPLETE_ROWS = [
    { name: 'oats', grams: 50, nutritionStatus: 'ok' },
    { name: 'mystery spice', grams: 5, nutritionStatus: 'unknown' },
    { name: 'weird oil', grams: 10, nutritionStatus: 'incomplete' },
  ];

  function seedIncomplete(slug: string, ingredients: unknown) {
    seedRecipe(slug);
    const row = store.get(slug)!;
    row.needsReview = true;
    row.ingredients = ingredients;
  }

  it('verify on a needsReview=true recipe → 400 naming the unresolved ingredients', async () => {
    seedIncomplete('i1', INCOMPLETE_ROWS);
    const res = (await reviewPOST(req('i1', 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      reviewEvidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'i1' } })) as NextResponse;
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('incomplete_nutrition');
    expect(body.error.message).toMatch(/mystery spice/);
    expect(body.error.message).toMatch(/weird oil/);
    expect(body.error.message).toMatch(/re-review, then verify/);
    // Nothing was written — the recipe is untouched.
    const stored = store.get('i1')!;
    expect(stored.verified).toBe(false);
    expect(stored.needsReview).toBe(true);
  });

  it('verify on an already-verified but incomplete recipe → 400 (no re-verification shortcut)', async () => {
    seedIncomplete('i2', INCOMPLETE_ROWS);
    const row = store.get('i2')!;
    row.verified = true;
    row.verificationEvidence = { ...VERIFY_EVIDENCE };
    row.reviewEvidence = { ...REVIEW_EVIDENCE };
    const res = (await reviewPOST(req('i2', 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
    }), { params: { slug: 'i2' } })) as NextResponse;
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('incomplete_nutrition');
  });

  it('flag set but no per-row status → 400 with generic wording, never a crash', async () => {
    seedIncomplete('i3', [{ name: 'oats', grams: 50 }]);
    const res = (await reviewPOST(req('i3', 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      reviewEvidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'i3' } })) as NextResponse;
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('incomplete_nutrition');
    expect(body.error.message).toMatch(/unknown nutrition/);
  });

  it('a complete recipe (needsReview=false) still verifies through the normal workflow', async () => {
    seedRecipe('i4');
    const row = store.get('i4')!;
    row.needsReview = false;
    row.ingredients = [{ name: 'oats', grams: 50, nutritionStatus: 'ok' }];
    const res = (await reviewPOST(req('i4', 'POST', {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      reviewEvidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'i4' } })) as NextResponse;
    expect(res.status).toBe(200);
    expect((await res.json()).recipe.verified).toBe(true);
  });

  it('GET surfaces needsReview + unresolvedIngredients so the admin sees why', async () => {
    seedIncomplete('i5', INCOMPLETE_ROWS);
    const res = (await reviewGET(req('i5', 'GET'), {
      params: { slug: 'i5' },
    })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsReview).toBe(true);
    expect(body.verificationBlocked).toBe(true);
    expect(body.unresolvedIngredients).toEqual(['mystery spice', 'weird oil']);
  });

  it('GET on a complete recipe reports verification not blocked', async () => {
    seedRecipe('i6');
    const res = (await reviewGET(req('i6', 'GET'), {
      params: { slug: 'i6' },
    })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsReview).toBe(false);
    expect(body.verificationBlocked).toBe(false);
    expect(body.unresolvedIngredients).toEqual([]);
  });
});

describe('authz edge cases (mocked requireAdmin passthrough)', () => {
  it('anonymous caller → 401 passthrough from requireAdmin (POST)', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: { code: 'unauthorized', message: 'Sign in required' } },
        { status: 401 },
      ),
    );
    seedRecipe('a1');
    const res = (await reviewPOST(req('a1', 'POST', {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'a1' } })) as NextResponse;
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
    // The recipe was NOT touched.
    expect(store.get('a1')!.reviewEvidence).toBeNull();
  });

  it('anonymous caller → 401 passthrough from requireAdmin (GET)', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json(
        { error: { code: 'unauthorized', message: 'Sign in required' } },
        { status: 401 },
      ),
    );
    seedRecipe('a2');
    const res = (await reviewGET(req('a2', 'GET'), {
      params: { slug: 'a2' },
    })) as NextResponse;
    expect(res.status).toBe(401);
  });

  it('a forged checkedBy on verify is overwritten by the session email', async () => {
    seedRecipe('a3');
    const res = (await reviewPOST(req('a3', 'POST', {
      action: 'verify',
      evidence: { ...VERIFY_EVIDENCE, checkedBy: 'mallory@example.com' },
      reviewEvidence: REVIEW_EVIDENCE,
    }), { params: { slug: 'a3' } })) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipe.tier).toBe('verified');
    expect(body.recipe.verificationEvidence.checkedBy).toBe('admin@example.com');
    // The stored row carries the session identity too, not the forgery.
    const stored = store.get('a3')!;
    expect(
      (stored.verificationEvidence as { checkedBy: string }).checkedBy,
    ).toBe('admin@example.com');
  });
});

