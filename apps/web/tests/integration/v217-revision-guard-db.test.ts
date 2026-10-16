/**
 * v21.7 PRIORITY 1 — REAL revision-token concurrency proof (DB-gated,
 * skip-guarded).
 *
 * >>> THIS IS THE REAL CONCURRENCY PROOF <<<
 *
 * The mocked suite (v217-revision-guard-mocked) exercises the REAL route
 * code but replaces PostgreSQL with an in-memory map: it proves the routes
 * ISSUE conditional (hash, revision) writes and interpret zero-row results
 * as 409, but it cannot prove the database's atomic compare-and-write
 * behavior under genuine concurrency. THESE tests do: real route handlers,
 * real Prisma `updateMany` against a real PostgreSQL, two writers
 * genuinely racing on the (contentHash, revision) pair.
 *
 * Skip-guarded via db-guard: on this VM (no PostgreSQL) every test
 * skips — never fails. CI with a database runs them for real.
 * Run: DATABASE_URL=<redacted>
 * v217-revision-guard-db
 *
 *  - two simultaneous PATCH mutations carrying the same stale pair →
 *    exactly one 200 and one 409 (the loser never overwrites the winner);
 *  - clear vs verify race: the verify lands, the stale clear (same hash —
 *    verify moves no content — but old revision) 409s; the verification
 *    is NOT undone;
 *  - review vs clear race: the clear lands, the stale review 409s; the
 *    cleared state stays cleared;
 *  - edit vs review race: a metadata-only PATCH lands (hash UNCHANGED —
 *    identical content recomputes the identical hash — revision moved),
 *    then the stale review 409s on the revision alone. This is the exact
 *    defect v21.7 fixes: under the hash-only v21.6 guard this review
 *    would have landed on a newer review state.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { PATCH as recipePATCH } from '@/app/api/recipes/[slug]/route';
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
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as recipesPOST } from '@/app/api/recipes/route';
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
  reference: 'DB revision probe',
  dietaryRechecked: true,
  allergenRechecked: true,
};

const VERIFY_EVIDENCE = {
  checkedAt: '2026-10-14',
  method: 'independent recomputation',
  allergenAndDietRechecked: true,
};

describe.skipIf(!HAS_DB)('v21.7 real revision-token concurrency proof (PostgreSQL)', () => {
  const recipeIds: string[] = [];

  afterAll(async () => {
    for (const id of recipeIds) {
      await prisma.recipe.delete({ where: { id } }).catch(() => {});
    }
    await cleanupUsers();
  });

  /** Owner (and admin) session; ADMIN_EMAILS allowlists the same email. */
  async function adminSession() {
    const email = uniqueEmail('ff-v217-rev');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = email;
    return {
      email,
      token,
      restore: () => {
        if (prev === undefined) delete process.env.ADMIN_EMAILS;
        else process.env.ADMIN_EMAILS = prev;
      },
    };
  }

  async function createRecipe(token: string, name: string) {
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
    // A fresh row is at revision 0 (the migration default).
    expect(body.recipe.revision).toBe(0);
    return {
      id: body.recipe.id as string,
      contentHash: body.recipe.contentHash as string,
      revision: body.recipe.revision as number,
    };
  }

  async function reviewGetReq(token: string, slug: string) {
    const res = (await reviewGET(
      authed(
        jsonRequest(`http://localhost/api/admin/recipes/${slug}/review`, 'GET'),
        token,
      ),
      { params: { slug } },
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

  async function patchReq(token: string, id: string, body: unknown) {
    const res = (await recipePATCH(
      authed(jsonRequest(`http://localhost/api/recipes/${id}`, 'PATCH', body), token),
      { params: { slug: id } },
    )) as NextResponse;
    return { status: res.status, body: await readJson(res) };
  }

  it('two simultaneous PATCH mutations with the same stale pair → exactly one 200 and one 409', async () => {
    const { token, restore } = await adminSession();
    try {
      const { id, contentHash } = await createRecipe(token, 'V217 Race A');

      // Two writers, both holding the SAME pair they read (hash, rev 0).
      // PostgreSQL serializes the conditional updateMany calls, so
      // exactly one matches the pair and the other sees zero rows → 409.
      const [a, b] = await Promise.all([
        patchReq(token, id, { portions: 4, expectedContentHash: contentHash, expectedRevision: 0 }),
        patchReq(token, id, { prepMin: 33, expectedContentHash: contentHash, expectedRevision: 0 }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);

      const row = await prisma.recipe.findUnique({ where: { id } });
      expect(row).not.toBeNull();
      expect(row!.revision).toBe(1);
      const winnerChangedPortions = a.status === 200;
      expect(row!.servings).toBe(winnerChangedPortions ? 4 : 2);
      expect(row!.prepMin).toBe(winnerChangedPortions ? 10 : 33);
    } finally {
      restore();
    }
  });

  it('clear vs verify race: the verify lands, the stale clear (same hash, old revision) 409s — the verification is NOT undone', async () => {
    const { token, restore } = await adminSession();
    try {
      const { id, contentHash } = await createRecipe(token, 'V217 Race B');
      const prefill = await reviewGetReq(token, id);
      expect(prefill.status).toBe(200);

      // Admin 1 records a review against (hash, rev 0) → rev 1, hash unchanged.
      const rev = await reviewPostReq(token, id, {
        action: 'review',
        evidence: REVIEW_EVIDENCE,
        expectedContentHash: contentHash,
        expectedRevision: 0,
      });
      expect(rev.status).toBe(200);
      expect(rev.body.recipe.revision).toBe(1);
      expect(rev.body.recipe.contentHash).toBe(contentHash);

      // Admin 2's verify — holding the same (hash, rev 1) — lands → rev 2.
      const ver = await reviewPostReq(token, id, {
        action: 'verify',
        evidence: VERIFY_EVIDENCE,
        expectedContentHash: contentHash,
        expectedRevision: 1,
      });
      expect(ver.status).toBe(200);
      expect(ver.body.recipe.verified).toBe(true);
      expect(ver.body.recipe.revision).toBe(2);

      // Admin 1's stale clear still carries the OLD revision (1). The hash
      // never moved — verify touches no content — so under the hash-only
      // v21.6 guard this clear would have LANDED and silently undone the
      // verification. With the revision token it 409s.
      const clr = await reviewPostReq(token, id, {
        action: 'clear',
        expectedContentHash: contentHash,
        expectedRevision: 1,
      });
      expect(clr.status).toBe(409);
      expect(clr.body.error.code).toBe('stale_recipe');

      const row = await prisma.recipe.findUnique({ where: { id } });
      expect(row!.verified).toBe(true);
      expect(row!.verificationEvidence).not.toBeNull();
      expect(row!.revision).toBe(2);
    } finally {
      restore();
    }
  });

  it('review vs clear race: the clear lands, the stale review 409s — the cleared state stays cleared', async () => {
    const { token, restore } = await adminSession();
    try {
      const { id, contentHash } = await createRecipe(token, 'V217 Race C');

      const rev = await reviewPostReq(token, id, {
        action: 'review',
        evidence: REVIEW_EVIDENCE,
        expectedContentHash: contentHash,
        expectedRevision: 0,
      });
      expect(rev.status).toBe(200);

      // The clear lands against (hash, rev 1) → rev 2, evidence destroyed.
      const clr = await reviewPostReq(token, id, {
        action: 'clear',
        expectedContentHash: contentHash,
        expectedRevision: 1,
      });
      expect(clr.status).toBe(200);
      expect(clr.body.recipe.revision).toBe(2);

      // A second admin still holds the pre-clear prefill (same hash —
      // clear touches no content — old revision 1). Their review must
      // not resurrect the cleared state.
      const stale = await reviewPostReq(token, id, {
        action: 'review',
        evidence: { ...REVIEW_EVIDENCE, reference: 'stale second opinion' },
        expectedContentHash: contentHash,
        expectedRevision: 1,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('stale_recipe');

      const row = await prisma.recipe.findUnique({ where: { id } });
      expect(row!.verified).toBe(false);
      expect(row!.reviewEvidence).toBeNull();
      expect(row!.verificationEvidence).toBeNull();
      expect(row!.revision).toBe(2);
    } finally {
      restore();
    }
  });

  it('edit vs review race: a metadata-only PATCH lands (hash UNCHANGED, revision moved), then the stale review 409s on the revision alone', async () => {
    const { token, restore } = await adminSession();
    try {
      const { id, contentHash: h1 } = await createRecipe(token, 'V217 Race D');

      // The owner's metadata-only PATCH: same content → the route
      // recomputes the IDENTICAL hash; the revision bumps 0 → 1.
      const p = await patchReq(token, id, {
        prepMin: 45,
        expectedContentHash: h1,
        expectedRevision: 0,
      });
      expect(p.status).toBe(200);
      expect(p.body.recipe.contentHash).toBe(h1);
      expect(p.body.recipe.revision).toBe(1);

      // The admin's review was built against the pre-edit pair
      // (h1, rev 0). The hash still matches — only the revision moved —
      // so this 409 is decided by the REVISION token alone.
      const r = await reviewPostReq(token, id, {
        action: 'review',
        evidence: REVIEW_EVIDENCE,
        expectedContentHash: h1,
        expectedRevision: 0,
      });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('stale_recipe');

      const row = await prisma.recipe.findUnique({ where: { id } });
      expect(row!.prepMin).toBe(45);
      expect(row!.reviewEvidence).toBeNull();
      expect(row!.contentHash).toBe(h1);
      expect(row!.revision).toBe(1);
    } finally {
      restore();
    }
  });
});
