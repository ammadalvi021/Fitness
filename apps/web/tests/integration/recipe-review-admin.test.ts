/**
 * Admin recipe review workflow (v21.3) — POST/GET /api/admin/recipes/[slug]/review.
 *
 * Authz (DB-free): anonymous callers get 401 on both verbs — requireAdmin
 * fails before any database work because getSessionUser returns null with
 * no session cookie.
 *
 * Happy path + evidence validation (DB-gated, skip-guarded — no PostgreSQL
 * on this VM): admin records a review (tier → 'reviewed'), verification
 * requires a complete review first, verify accepts both evidence sets in one
 * call, clear resets everything, non-admin gets 403, reviewer identity is
 * server-set from the session.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import {
  GET as reviewGET,
  POST as reviewPOST,
} from '@/app/api/admin/recipes/[slug]/review/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

const envStack: Array<Record<string, string | undefined>> = [];
function pushEnv(vars: Record<string, string | undefined>) {
  envStack.push(
    Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]])),
  );
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  while (envStack.length) {
    const snap = envStack.pop()!;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

const REVIEW_BODY = {
  action: 'review',
  evidence: {
    reviewedAt: '2026-10-14',
    method: 'independent recomputation',
    reference: 'USDA SR Legacy #170923',
    dietaryRechecked: true,
    allergenRechecked: true,
  },
};

const VERIFY_BODY = {
  action: 'verify',
  evidence: {
    checkedAt: '2026-10-14',
    method: 'independent recomputation',
    allergenAndDietRechecked: true,
  },
};

async function createRecipe(slug: string) {
  const recipe = await prisma.recipe.create({
    data: {
      slug,
      title: `Review Test ${slug}`,
      dietCategory: 'vegetarian',
      tags: [],
      servings: 2,
      prepMin: 10,
      cookMin: 10,
      difficulty: 'easy',
      ingredients: [],
      instructions: [],
      kcalPerServing: 100,
      proteinPerServing: 5,
      carbsPerServing: 10,
      fatPerServing: 3,
      fiberPerServing: 1,
      source: 'test',
      verified: false,
      allergens: [],
    },
  });
  return recipe;
}

describe('admin review endpoint — authz (no DB required)', () => {
  it('anonymous POST → 401', async () => {
    const res = await reviewPOST(
      jsonRequest('http://localhost/api/admin/recipes/x/review', 'POST', {
        action: 'review',
      }),
      { params: { slug: 'x' } },
    );
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe('unauthorized');
  });

  it('anonymous GET → 401', async () => {
    const res = await reviewGET(
      jsonRequest('http://localhost/api/admin/recipes/x/review', 'GET'),
      { params: { slug: 'x' } },
    );
    expect(res.status).toBe(401);
  });
});

describe('admin review endpoint — workflow (DB-gated)', () => {
  if (!HAS_DB) {
    it('skipped: no PostgreSQL on this VM', () => {});
    return;
  }

  const createdSlugs: string[] = [];
  afterAll(async () => {
    for (const slug of createdSlugs) {
      await prisma.recipe.delete({ where: { slug } }).catch(() => {});
    }
    await cleanupUsers();
  });

  async function adminSession() {
    const email = uniqueEmail('ff-review-admin');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    pushEnv({ ADMIN_EMAILS: email });
    return { email, token };
  }

  async function authedJson(token: string, slug: string, body: unknown) {
    return reviewPOST(
      authed(
        jsonRequest(
          `http://localhost/api/admin/recipes/${slug}/review`,
          'POST',
          body,
        ),
        token,
      ),
      { params: { slug } },
    );
  }

  it('non-admin user → 403', async () => {
    const slug = `review-403-${Date.now()}`;
    await createRecipe(slug);
    createdSlugs.push(slug);
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-review-user'),
    );
    pushEnv({ ADMIN_EMAILS: 'someone-else@example.com' });
    const res = await authedJson(token, slug, REVIEW_BODY);
    expect(res.status).toBe(403);
  });

  it('review with incomplete evidence → 400 with field errors', async () => {
    const slug = `review-400-${Date.now()}`;
    await createRecipe(slug);
    createdSlugs.push(slug);
    const { token } = await adminSession();
    const res = await authedJson(token, slug, {
      action: 'review',
      evidence: { method: 'other' }, // missing date, reference, rechecks
    });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details).toMatch(/reference/);
  });

  it('unknown action → 400', async () => {
    const slug = `review-act-${Date.now()}`;
    await createRecipe(slug);
    createdSlugs.push(slug);
    const { token } = await adminSession();
    const res = await authedJson(token, slug, { action: 'promote' });
    expect(res.status).toBe(400);
  });

  it('full workflow: review → verify → clear', async () => {
    const slug = `review-flow-${Date.now()}`;
    await createRecipe(slug);
    createdSlugs.push(slug);
    const { email, token } = await adminSession();

    // 1. record a review — reviewer identity must be the session email,
    //    even though the client sent a forged one.
    const revRes = await authedJson(token, slug, {
      action: 'review',
      evidence: { ...REVIEW_BODY.evidence, reviewer: 'mallory@example.com' },
    });
    expect(revRes.status).toBe(200);
    const revBody = await readJson(revRes);
    expect(revBody.recipe.tier).toBe('reviewed');
    expect(revBody.recipe.reviewEvidence.reviewer).toBe(email);

    // 2. admin GET returns full evidence to admins.
    const getRes = await reviewGET(
      authed(
        jsonRequest(`http://localhost/api/admin/recipes/${slug}/review`, 'GET'),
        token,
      ),
      { params: { slug } },
    );
    expect(getRes.status).toBe(200);
    const getBody = await readJson(getRes);
    expect(getBody.tier).toBe('reviewed');
    expect(getBody.reviewer).toBe(email);
    expect(getBody.reviewEvidence.reference).toBe('USDA SR Legacy #170923');

    // 3. verify with an incomplete review record stored → needs the review
    //    in the same call. Use a fresh recipe with NO review: verify must
    //    fail without reviewEvidence.
    const slug2 = `review-flow2-${Date.now()}`;
    await createRecipe(slug2);
    createdSlugs.push(slug2);
    const vRes1 = await authedJson(token, slug2, VERIFY_BODY);
    expect(vRes1.status).toBe(400);

    // 4. verify with both evidence sets in one call → 'verified'.
    const vRes2 = await authedJson(token, slug2, {
      ...VERIFY_BODY,
      reviewEvidence: REVIEW_BODY.evidence,
    });
    expect(vRes2.status).toBe(200);
    const vBody2 = await readJson(vRes2);
    expect(vBody2.recipe.tier).toBe('verified');
    expect(vBody2.recipe.verified).toBe(true);
    expect(vBody2.recipe.verificationEvidence.checkedBy).toBe(email);
    // The one-call review was persisted too.
    expect(vBody2.recipe.reviewEvidence.reviewer).toBe(email);

    // 5. verify on the already-reviewed recipe (stored review suffices).
    const vRes3 = await authedJson(token, slug, VERIFY_BODY);
    expect(vRes3.status).toBe(200);
    expect((await readJson(vRes3)).recipe.tier).toBe('verified');

    // 6. clear destroys all status.
    const cRes = await authedJson(token, slug, { action: 'clear' });
    expect(cRes.status).toBe(200);
    const cBody = await readJson(cRes);
    expect(cBody.recipe.tier).toBe('calculated-estimate');
    expect(cBody.recipe.verified).toBe(false);
    expect(cBody.recipe.reviewEvidence).toBeNull();
    expect(cBody.recipe.verificationEvidence).toBeNull();
  });

  it('missing recipe → 404', async () => {
    const { token } = await adminSession();
    const res = await authedJson(token, 'no-such-recipe-xyz', REVIEW_BODY);
    expect(res.status).toBe(404);
  });
});
