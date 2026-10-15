/**
 * Evidence-leak regression suite (v21.4, Worker A) — mocked (no DB).
 *
 * CONFIRMED DEFECT: `GET /api/recipes`, `GET /api/recipes/[slug]`, and the
 * `mine=1` response used to spread the full Prisma record
 * (`{ ...r, ...shapeRecipeEvidence(r, admin) }`). For non-admins,
 * `shapeRecipeEvidence` omits the `reviewEvidence`/`verificationEvidence`
 * keys, so the RAW Prisma JSONB columns stayed in the response — full
 * evidence (incl. the reviewer's email and internal reference notes)
 * leaked to anonymous and ordinary users.
 *
 * The fix: `serializeRecipePublic()` (apps/web/lib/recipe-evidence.ts)
 * strips the raw evidence columns BEFORE responding and redacts reviewer
 * identities for non-admins (no consent field exists on the record, so the
 * email defaults to redacted). These tests pin the contract:
 *  - anonymous + ordinary users: NO `reviewEvidence`/`verificationEvidence`
 *    KEYS (asserted as key absence, not just falsy values); identities
 *    masked to the public label; tier + public fields still present;
 *  - admins: full evidence objects with real identities.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const ADMIN_EMAIL = 'admin@example.com';
const USER_EMAIL = 'cook@example.com';

const current = { session: null as null | { user: { id: string; email: string } } };

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => current.session),
  requireUser: vi.fn(async () => {
    if (!current.session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return current.session;
  }),
}));
vi.mock('@/lib/admin', () => ({
  // Mirrors the real ADMIN_EMAILS allowlist behavior for this suite.
  isAdmin: vi.fn((s: { user?: { email?: string } } | null) =>
    !!s?.user?.email && s.user.email.toLowerCase() === ADMIN_EMAIL,
  ),
}));

const EVIDENCE_ROW = {
  id: 'r1',
  slug: 'daal-tadka',
  title: 'Daal Tadka',
  dietCategory: 'vegetarian',
  tags: ['vegetarian'],
  servings: 2,
  prepMin: 10,
  cookMin: 30,
  difficulty: 'easy',
  ingredients: [],
  instructions: [],
  kcalPerServing: 200,
  proteinPerServing: 8,
  carbsPerServing: 30,
  fatPerServing: 6,
  fiberPerServing: 4,
  source: 'seed',
  verified: true,
  needsReview: false,
  allergens: [],
  userId: null,
  isPrivate: false,
  // The sensitive payload: internal reference notes + the reviewer's email.
  reviewEvidence: {
    reviewer: ADMIN_EMAIL,
    reviewedAt: '2026-10-14',
    method: 'independent recomputation',
    reference: 'INTERNAL WORKING NOTES — do not publish',
    dietaryRechecked: true,
    allergenRechecked: true,
  },
  verificationEvidence: {
    checkedBy: ADMIN_EMAIL,
    checkedAt: '2026-10-14',
    method: 'independent recomputation',
    allergenAndDietRechecked: true,
  },
  cuisine: { id: 'c1', name: 'Pakistani' },
};

const PRIVATE_ROW = {
  ...EVIDENCE_ROW,
  id: 'r9',
  slug: 'my-private-curry',
  title: 'My Private Curry',
  userId: 'user-1',
  isPrivate: true,
};

vi.mock('@fitfusion/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fitfusion/db')>();
  return {
    ...actual,
    prisma: {
      recipe: {
        findMany: vi.fn(async (args: Record<string, unknown>) => {
          const where = (args.where ?? {}) as Record<string, unknown>;
          if (where.userId) return [PRIVATE_ROW]; // mine=1
          if (args.select && !args.include) {
            return [{ id: EVIDENCE_ROW.id, prepMin: 10, cookMin: 30 }];
          }
          return [EVIDENCE_ROW]; // phase 2: full rows
        }),
        findUnique: vi.fn(async () => ({ ...EVIDENCE_ROW })),
      },
    },
  };
});

import { GET as listGET } from '@/app/api/recipes/route';
import { GET as detailGET } from '@/app/api/recipes/[slug]/route';

function listReq(url: string) {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

function asAnonymous() {
  current.session = null;
}
function asUser() {
  current.session = { user: { id: 'user-1', email: USER_EMAIL } };
}
function asAdmin() {
  current.session = { user: { id: 'admin-1', email: ADMIN_EMAIL } };
}

beforeEach(() => {
  asAnonymous();
});

describe('GET /api/recipes — public list', () => {
  it('anonymous: raw evidence keys are ABSENT; identities masked; public fields present', async () => {
    asAnonymous();
    const res = (await listGET(listReq('/api/recipes'))) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipes).toHaveLength(1);
    const r = body.recipes[0] as Record<string, unknown>;
    // Key absence, not just falsy values.
    expect('reviewEvidence' in r).toBe(false);
    expect('verificationEvidence' in r).toBe(false);
    // Tier still computed server-side from the full stored evidence.
    expect(r.tier).toBe('verified');
    // Display summaries present but identities redacted (no email leak).
    expect(r.reviewInfo).toEqual({ reviewer: 'FitFusion reviewer', reviewedAt: '2026-10-14' });
    expect(r.verificationInfo).toEqual({
      checkedBy: 'FitFusion reviewer',
      checkedAt: '2026-10-14',
      method: 'independent recomputation',
    });
    // Ordinary recipe fields untouched.
    expect(r.title).toBe('Daal Tadka');
    expect(r.kcalPerServing).toBe(200);
    // The raw email / internal notes appear nowhere in the serialized row.
    expect(JSON.stringify(r)).not.toContain(ADMIN_EMAIL);
    expect(JSON.stringify(r)).not.toContain('INTERNAL WORKING NOTES');
  });

  it('ordinary authenticated user: same redaction as anonymous', async () => {
    asUser();
    const res = (await listGET(listReq('/api/recipes'))) as NextResponse;
    const body = await res.json();
    const r = body.recipes[0] as Record<string, unknown>;
    expect('reviewEvidence' in r).toBe(false);
    expect('verificationEvidence' in r).toBe(false);
    expect(r.tier).toBe('verified');
    expect(JSON.stringify(r)).not.toContain(ADMIN_EMAIL);
  });

  it('admin: full evidence objects with real identities', async () => {
    asAdmin();
    const res = (await listGET(listReq('/api/recipes'))) as NextResponse;
    const body = await res.json();
    const r = body.recipes[0] as Record<string, unknown>;
    expect(r.reviewEvidence).toMatchObject({
      reviewer: ADMIN_EMAIL,
      reference: 'INTERNAL WORKING NOTES — do not publish',
    });
    expect(r.verificationEvidence).toMatchObject({ checkedBy: ADMIN_EMAIL });
    expect(r.tier).toBe('verified');
  });
});

describe('GET /api/recipes/[slug] — detail', () => {
  const params = { params: { slug: 'daal-tadka' } };

  it('anonymous: raw evidence keys are ABSENT; identities masked', async () => {
    asAnonymous();
    const res = (await detailGET(listReq('/api/recipes/daal-tadka'), params)) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    const r = body.recipe as Record<string, unknown>;
    expect('reviewEvidence' in r).toBe(false);
    expect('verificationEvidence' in r).toBe(false);
    expect(r.tier).toBe('verified');
    expect(r.reviewInfo).toEqual({ reviewer: 'FitFusion reviewer', reviewedAt: '2026-10-14' });
    expect(JSON.stringify(r)).not.toContain(ADMIN_EMAIL);
  });

  it('ordinary user: raw evidence keys are ABSENT', async () => {
    asUser();
    const res = (await detailGET(listReq('/api/recipes/daal-tadka'), params)) as NextResponse;
    const body = await res.json();
    const r = body.recipe as Record<string, unknown>;
    expect('reviewEvidence' in r).toBe(false);
    expect('verificationEvidence' in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain('INTERNAL WORKING NOTES');
  });

  it('admin: full evidence with real identities', async () => {
    asAdmin();
    const res = (await detailGET(listReq('/api/recipes/daal-tadka'), params)) as NextResponse;
    const body = await res.json();
    const r = body.recipe as Record<string, unknown>;
    expect(r.reviewEvidence).toMatchObject({ reviewer: ADMIN_EMAIL });
    expect(r.verificationEvidence).toMatchObject({ checkedBy: ADMIN_EMAIL });
  });
});

describe('GET /api/recipes?mine=1 — owner list', () => {
  it('ordinary owner: raw evidence keys are ABSENT', async () => {
    asUser();
    const res = (await listGET(listReq('/api/recipes?mine=1'))) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipes).toHaveLength(1);
    const r = body.recipes[0] as Record<string, unknown>;
    expect(r.title).toBe('My Private Curry');
    expect('reviewEvidence' in r).toBe(false);
    expect('verificationEvidence' in r).toBe(false);
    expect(r.tier).toBe('verified');
    expect(JSON.stringify(r)).not.toContain(ADMIN_EMAIL);
  });

  it('mine=1 requires authentication', async () => {
    asAnonymous();
    const res = (await listGET(listReq('/api/recipes?mine=1'))) as NextResponse;
    expect(res.status).toBe(401);
  });
});
