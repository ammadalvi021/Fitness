/**
 * Admin review endpoint — v21.4 validation tightening (Worker A), mocked (no DB).
 *
 * Pins the server-side policy in
 * apps/web/app/api/admin/recipes/[slug]/review/route.ts:
 *  - review/verification methods are validated against the controlled
 *    vocabularies (REVIEW_METHODS / VERIFICATION_METHODS from
 *    @fitfusion/core): unsupported, blank, and oversized values → 400;
 *  - review/verification dates must be real ISO calendar dates inside the
 *    permitted window (not before the app existed, not in the future) → 400;
 *  - client-supplied reviewer/checkedBy identities are ignored — the
 *    session email is server-set;
 *  - a bare method string never constitutes verification (the v21.3
 *    evidence requirements stay in force).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const { JSON_NULL } = vi.hoisted(() => ({ JSON_NULL: Symbol('prisma-json-null') }));

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
import { POST as reviewPOST } from '@/app/api/admin/recipes/[slug]/review/route';

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
    needsReview: false,
    ingredients: [],
    verificationEvidence: null,
    reviewEvidence: null,
  });
}

function req(slug: string, body: unknown) {
  return new Request(`http://localhost/api/admin/recipes/${slug}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof reviewPOST>[0];
}

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function tomorrowYMD(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const GOOD_REVIEW = {
  reviewedAt: todayYMD(),
  method: 'label cross-check',
  reference: 'photo of nutrition label',
  dietaryRechecked: true,
  allergenRechecked: true,
};
const GOOD_VERIFY = {
  checkedAt: todayYMD(),
  method: 'independent recomputation',
  allergenAndDietRechecked: true,
};

async function post(slug: string, body: unknown) {
  const res = (await reviewPOST(req(slug, body), { params: { slug } })) as NextResponse;
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  store.clear();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue(ADMIN_SESSION);
});

describe('review method validation', () => {
  it('unsupported method → 400', async () => {
    seedRecipe('v1');
    const { status, body } = await post('v1', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, method: 'vibes-based guesswork' },
    });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('method must be one of');
  });

  it('blank method → 400', async () => {
    seedRecipe('v2');
    const { status } = await post('v2', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, method: '   ' },
    });
    expect(status).toBe(400);
  });

  it('oversized method → 400', async () => {
    seedRecipe('v3');
    const { status } = await post('v3', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, method: 'x'.repeat(5000) },
    });
    expect(status).toBe(400);
  });

  it('every REVIEW_METHODS member is accepted', async () => {
    const methods = [
      'independent recomputation',
      'label cross-check',
      'lab analysis',
      'other',
    ] as const;
    for (const [i, method] of methods.entries()) {
      const slug = `v-ok-${i}`;
      seedRecipe(slug);
      const { status } = await post(slug, {
        action: 'review',
        evidence: { ...GOOD_REVIEW, method },
      });
      expect(status).toBe(200);
    }
  });
});

describe('review date validation', () => {
  it('future reviewedAt → 400', async () => {
    seedRecipe('d1');
    const { status, body } = await post('d1', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, reviewedAt: tomorrowYMD() },
    });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('reviewedAt');
  });

  it('reviewedAt before the app existed → 400', async () => {
    seedRecipe('d2');
    const { status } = await post('d2', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, reviewedAt: '2020-05-01' },
    });
    expect(status).toBe(400);
  });

  it('non-ISO reviewedAt → 400 (Date.parse would have accepted it)', async () => {
    seedRecipe('d3');
    const { status } = await post('d3', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, reviewedAt: 'Oct 14 2026' },
    });
    expect(status).toBe(400);
  });

  it('impossible calendar date → 400', async () => {
    seedRecipe('d4');
    const { status } = await post('d4', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, reviewedAt: '2026-02-30' },
    });
    expect(status).toBe(400);
  });

  it("today's date passes", async () => {
    seedRecipe('d5');
    const { status, body } = await post('d5', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, reviewedAt: todayYMD() },
    });
    expect(status).toBe(200);
    expect(body.recipe.tier).toBe('reviewed');
  });
});

describe('identity anti-forgery', () => {
  it('client-supplied reviewer is ignored — the session email wins', async () => {
    seedRecipe('i1');
    const { status, body } = await post('i1', {
      action: 'review',
      evidence: { ...GOOD_REVIEW, reviewer: 'mallory@evil.example' },
    });
    expect(status).toBe(200);
    expect(body.recipe.reviewEvidence.reviewer).toBe('admin@example.com');
  });

  it('client-supplied checkedBy is ignored on verify — the session email wins', async () => {
    seedRecipe('i2');
    const { status, body } = await post('i2', {
      action: 'verify',
      evidence: { ...GOOD_VERIFY, checkedBy: 'mallory@evil.example' },
      reviewEvidence: GOOD_REVIEW,
    });
    expect(status).toBe(200);
    expect(body.recipe.verificationEvidence.checkedBy).toBe('admin@example.com');
    expect(body.recipe.reviewEvidence.reviewer).toBe('admin@example.com');
  });
});

describe('verification method validation', () => {
  it('unsupported verification method → 400', async () => {
    seedRecipe('m1');
    const { status } = await post('m1', {
      action: 'verify',
      evidence: { ...GOOD_VERIFY, method: 'hand-waving' },
      reviewEvidence: GOOD_REVIEW,
    });
    expect(status).toBe(400);
  });

  it('blank verification method → 400', async () => {
    seedRecipe('m2');
    const { status } = await post('m2', {
      action: 'verify',
      evidence: { ...GOOD_VERIFY, method: '' },
      reviewEvidence: GOOD_REVIEW,
    });
    expect(status).toBe(400);
  });

  it('future checkedAt → 400', async () => {
    seedRecipe('m3');
    const { status } = await post('m3', {
      action: 'verify',
      evidence: { ...GOOD_VERIFY, checkedAt: tomorrowYMD() },
      reviewEvidence: GOOD_REVIEW,
    });
    expect(status).toBe(400);
  });
});

describe('v21.3 evidence requirements stay in force', () => {
  it('a bare method string never verifies — missing recheck flag → 400', async () => {
    seedRecipe('e1');
    const { status } = await post('e1', {
      action: 'verify',
      evidence: { ...GOOD_VERIFY, allergenAndDietRechecked: false },
      reviewEvidence: GOOD_REVIEW,
    });
    expect(status).toBe(400);
  });

  it('verify still requires a complete review record first', async () => {
    seedRecipe('e2');
    const { status } = await post('e2', {
      action: 'verify',
      evidence: GOOD_VERIFY,
      // no reviewEvidence supplied and none stored
    });
    expect(status).toBe(400);
  });

  it('valid review+verify in one call → 200, tier verified', async () => {
    seedRecipe('e3');
    const { status, body } = await post('e3', {
      action: 'verify',
      evidence: GOOD_VERIFY,
      reviewEvidence: GOOD_REVIEW,
    });
    expect(status).toBe(200);
    expect(body.recipe.tier).toBe('verified');
    expect(body.recipe.verified).toBe(true);
  });
});
