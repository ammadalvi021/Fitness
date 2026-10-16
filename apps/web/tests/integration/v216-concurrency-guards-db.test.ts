/**
 * v21.6 ITEM 4 — REAL concurrency proof (DB-gated, skip-guarded).
 *
 * >>> THIS IS THE REAL CONCURRENCY PROOF <<<
 *
 * The mocked suites (v216-concurrency-guards-mocked,
 * recipe-stale-content-mocked) exercise the REAL route code but replace
 * PostgreSQL with an in-memory map: they prove the routes ISSUE
 * conditional writes and interpret the row counts correctly, but they
 * cannot prove the database's atomic compare-and-write behavior under
 * genuine concurrency. THESE tests do: real route handlers, real Prisma
 * `updateMany` against a real PostgreSQL, two writers genuinely racing.
 *
 * Skip-guarded via db-guard: on this VM (no PostgreSQL) every test
 * skips — never fails. CI with a database runs them for real.
 * Run: DATABASE_URL=<redacted>
 * v216-concurrency-guards-db
 *
 *  - two simultaneous PATCH edits carrying the same stale guard → exactly
 *    one 200 and one 409 (the loser never overwrites the winner);
 *  - admin verify vs a concurrent material PATCH → the stale verify 409s;
 *    the invalidated evidence is never resurrected;
 *  - legacy NULL-hash row + explicit null guard → the conditional write
 *    on contentHash IS NULL succeeds and writes a real hash;
 *  - legacy NULL-hash row + ABSENT guard → 409 (no silent fallback, even
 *    for legacy rows).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as recipesPOST } from '@/app/api/recipes/route';
import { PATCH as recipePATCH } from '@/app/api/recipes/[slug]/route';
import {
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

const REVIEW_EVIDENCE = {
  reviewedAt: '2026-10-14',
  method: 'label cross-check',
  reference: 'DB concurrency probe',
  dietaryRechecked: true,
  allergenRechecked: true,
};

const VERIFY_EVIDENCE = {
  checkedAt: '2026-10-14',
  method: 'independent recomputation',
  allergenAndDietRechecked: true,
};

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

describe.skipIf(!HAS_DB)('v21.6 real concurrency proof (PostgreSQL)', () => {
  const recipeIds: string[] = [];

  afterAll(async () => {
    for (const id of recipeIds) {
      await prisma.recipe.delete({ where: { id } }).catch(() => {});
    }
    await cleanupUsers();
  });

  /** Owner (and admin) session; ADMIN_EMAILS allowlists the same email. */
  async function ownerSession() {
    const email = uniqueEmail('ff-v216-conc');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    pushEnv({ ADMIN_EMAILS: email });
    return { email, token };
  }

  async function createRecipe(token: string, name: string): Promise<{ id: string; contentHash: string; revision: number }> {
    const res = (await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name,
          ingredients: [DECLARED_OATS],
          portions: 2,
          instructions: ['Mix.'],
          dietCategory: 'vegetarian',
        }),
        token,
      ),
    )) as NextResponse;
    expect(res.status).toBe(201);
    const body = await readJson(res);
    recipeIds.push(body.recipe.id);
    expect(typeof body.recipe.contentHash).toBe('string');
    // v21.7: the guard is the (hash, revision) pair (recipe-governance.ts
    // §5b) — a fresh row is at revision 0 (the migration default).
    expect(body.recipe.revision).toBe(0);
    return { id: body.recipe.id, contentHash: body.recipe.contentHash, revision: body.recipe.revision };
  }

  async function patch(token: string, id: string, body: unknown) {
    const res = (await recipePATCH(
      authed(jsonRequest(`http://localhost/api/recipes/${id}`, 'PATCH', body), token),
      { params: { slug: id } },
    )) as NextResponse;
    return { status: res.status, body: await readJson(res) };
  }

  async function reviewPostReq(token: string, slug: string, body: unknown) {
    const res = (await reviewPOST(
      authed(
        jsonRequest(`http://localhost/api/admin/recipes/${slug}/review`, 'POST', body),
        token,
      ),
      { params: { slug } },
    )) as NextResponse;
    return { status: res.status, body: await readJson(res) };
  }

  it('two simultaneous PATCH edits with the same stale guard → exactly one 200 and one 409 (the loser never overwrites)', async () => {
    const { token } = await ownerSession();
    const { id, contentHash } = await createRecipe(token, 'V216 Race A');

    // Two writers, both holding the SAME revision they read (h1). They
    // race: PostgreSQL serializes the conditional updateMany calls, so
    // exactly one matches and the other sees zero rows → 409.
    const [a, b] = await Promise.all([
      patch(token, id, { portions: 4, expectedContentHash: contentHash, expectedRevision: 0 }),
      patch(token, id, { prepMin: 33, expectedContentHash: contentHash, expectedRevision: 0 }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    // The winner's change is intact; the loser's change never landed.
    const row = await prisma.recipe.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    const winnerChangedPortions = a.status === 200;
    expect(row!.servings).toBe(winnerChangedPortions ? 4 : 2);
    expect(row!.prepMin).toBe(winnerChangedPortions ? 10 : 33);
    expect(typeof row!.contentHash).toBe('string');
    expect(row!.contentHash).not.toBe(contentHash);
  });

  it('admin verify vs a concurrent material PATCH → the stale verify 409s; invalidated evidence is never resurrected', async () => {
    const { token } = await ownerSession();
    const { id, contentHash: h1 } = await createRecipe(token, 'V216 Race B');

    // 1. Admin records a review against (h1, rev 0). The review bumps the
    //    revision to 1 without moving the hash (§5b).
    const rev = await reviewPostReq(token, id, {
      action: 'review',
      evidence: REVIEW_EVIDENCE,
      expectedContentHash: h1,
      expectedRevision: 0,
    });
    expect(rev.status).toBe(200);
    expect(rev.body.recipe.revision).toBe(1);

    // 2. A concurrent material PATCH lands (fresh guard (h1, rev 1)): the
    //    review is invalidated AND the hash moves — atomically, and the
    //    revision bumps to 2.
    const p = await patch(token, id, { portions: 6, expectedContentHash: h1, expectedRevision: 1 });
    expect(p.status).toBe(200);
    const h2 = p.body.recipe.contentHash as string;
    expect(h2).not.toBe(h1);
    expect(p.body.recipe.revision).toBe(2);
    expect(p.body.recipe.verified).toBe(false);

    // 3. The admin's verify — built against the OLD content (stale h1)
    //    and the OLD review state (stale rev 0), carrying a review record
    //    for content that no longer exists → 409. The stale write fails;
    //    it does NOT re-verify the new content.
    const v = await reviewPostReq(token, id, {
      action: 'verify',
      evidence: VERIFY_EVIDENCE,
      reviewEvidence: REVIEW_EVIDENCE,
      expectedContentHash: h1,
      expectedRevision: 0,
    });
    expect(v.status).toBe(409);
    expect(v.body.error.code).toBe('stale_recipe');
    const row = await prisma.recipe.findUnique({ where: { id } });
    expect(row!.verified).toBe(false);
    expect(row!.reviewEvidence).toBeNull();
    expect(row!.verificationEvidence).toBeNull();
  });

  it('legacy NULL-hash row + explicit null guard → conditional write succeeds and the row gains a real hash', async () => {
    const { email, token } = await ownerSession();
    // Simulate a pre-backfill legacy row: contentHash IS NULL. (Created
    // directly because the create route always writes a hash.)
    const slug = `v216-legacy-${Date.now()}`;
    const legacy = await prisma.recipe.create({
      data: {
        slug,
        title: 'V216 Legacy Row',
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
        isPrivate: true,
        userId: (await prisma.user.findUnique({ where: { email } }))!.id,
        contentHash: null,
      },
    });
    recipeIds.push(legacy.id);

    const p = await patch(token, legacy.id, {
      prepMin: 15,
      expectedContentHash: null,
      // v21.7: legacy rows (pre-v21.7 writes) guard with explicit
      // expectedRevision: 0 — the migration default.
      expectedRevision: 0,
    });
    expect(p.status).toBe(200);
    const row = await prisma.recipe.findUnique({ where: { id: legacy.id } });
    expect(row!.prepMin).toBe(15);
    expect(typeof row!.contentHash).toBe('string');
  });

  it('legacy NULL-hash row + ABSENT guard → 409 (no silent fallback, even for legacy rows)', async () => {
    const { email, token } = await ownerSession();
    const slug = `v216-legacy2-${Date.now()}`;
    const legacy = await prisma.recipe.create({
      data: {
        slug,
        title: 'V216 Legacy Row 2',
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
        isPrivate: true,
        userId: (await prisma.user.findUnique({ where: { email } }))!.id,
        contentHash: null,
      },
    });
    recipeIds.push(legacy.id);

    const p = await patch(token, legacy.id, { prepMin: 99 });
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('stale_recipe');
    const row = await prisma.recipe.findUnique({ where: { id: legacy.id } });
    expect(row!.prepMin).toBe(10);
  });
});
