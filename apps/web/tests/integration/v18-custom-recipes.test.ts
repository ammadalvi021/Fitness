/**
 * V18 custom recipes: create (server-computed nutrition, water=0 kcal),
 * mine=1 listing, public exclusion, PATCH recalculation, ownership.
 * DB-backed — skipped gracefully when no PostgreSQL is reachable.
 *
 * v21.6: the server REQUIRES expectedContentHash on every PATCH
 * (recipe-governance.ts §5) — the tests echo the contentHash returned by
 * the previous response (the honest client flow: GET/create returns the
 * current revision, the client sends it back).
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as recipesGET, POST as recipesPOST } from '@/app/api/recipes/route';
import { PATCH as recipePATCH } from '@/app/api/recipes/[slug]/route';
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

const RUN = `v18r${Date.now().toString(36)}`;

describe.skipIf(!HAS_DB)('V18 custom recipes', () => {
  let token = '';
  let token2 = '';
  let flourId = '';
  let recipeId = '';
  // v21.6: the concurrency guard echoed on every PATCH (echo of the
  // contentHash the last response returned — the honest client flow).
  let recipeHash: string | null = null;
  let recipeRevision = 0;
  const recipeIds: string[] = [];

  afterAll(async () => {
    for (const id of recipeIds) {
      await prisma.recipe.delete({ where: { id } }).catch(() => {});
    }
    if (flourId) await prisma.food.delete({ where: { id: flourId } }).catch(() => {});
    await cleanupUsers();
  });

  it('registers two users and a catalogue food', async () => {
    ({ token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v18r1')));
    ({ token: token2 } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v18r2')));
    const flour = await prisma.food.create({
      data: {
        name: `${RUN} Flour`,
        servingSize: 100,
        servingUnit: '100 g',
        kcal: 340,
        proteinG: 13,
        carbsG: 72,
        fatG: 2,
        fiberG: 11,
        source: 'seeded',
      },
    });
    flourId = flour.id;
    expect(token).toBeTruthy();
  });

  it('POST computes nutrition server-side; water contributes 0 kcal', async () => {
    const res = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Test Recipe`,
          ingredients: [
            { foodId: flourId, name: 'Flour', grams: 200 },
            { name: 'Water', grams: 500, kcal: 500 },
            // V21.2 (P4): declared nutrients require a documented basis.
            { name: 'Sugar', grams: 50, kcal: 400, proteinG: 0, carbsG: 100, fatG: 0, fiberG: 0, basis: 'estimate' },
          ],
          portions: 4,
          instructions: ['Mix.', 'Cook.'],
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    const r = body.recipe;
    recipeId = r.id;
    recipeIds.push(r.id);
    // v21.6: capture the initial content revision — the first PATCH echoes
    // it back as the concurrency guard.
    recipeHash = typeof r.contentHash === 'string' ? r.contentHash : null;
    // v21.7: the guard is the (hash, revision) pair (recipe-governance.ts §5b).
    recipeRevision = typeof r.revision === 'number' ? r.revision : 0;
    // Flour 200 g -> 680 kcal / 26 P / 144 C / 4 F; sugar 50 g -> 200 kcal / 50 C;
    // water -> 0 despite the bogus 9999 kcal. Totals 880 kcal / 4 = 220.
    expect(r.kcalPerServing).toBe(220);
    expect(r.proteinPerServing).toBe(6.5);
    expect(r.carbsPerServing).toBe(48.5);
    expect(r.fatPerServing).toBe(1);
    expect(r.servings).toBe(4);
    expect(r.source).toBe('user');
    expect(r.isPrivate).toBe(true);
    expect(r.verified).toBe(false);
  });

  it('rejects unknown foodId with 404 and bad portions with 400', async () => {
    const badFood = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: 'Bad',
          ingredients: [{ foodId: 'nope', name: 'X', grams: 100 }],
          portions: 2,
          dietCategory: 'vegetarian',
        }),
        token,
      ),
    );
    expect(badFood.status).toBe(404);

    const badPortions = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: 'Bad',
          ingredients: [{ name: 'X', grams: 100 }],
          portions: 0,
          dietCategory: 'vegetarian', // V21.4: 400 must be for portions, not a missing diet
        }),
        token,
      ),
    );
    expect(badPortions.status).toBe(400);
  });

  it('GET ?mine=1 lists the user recipe; public GET excludes it', async () => {
    const mine = await readJson(
      await recipesGET(authed(new NextRequest('http://localhost/api/recipes?mine=1'), token)),
    );
    expect(mine.recipes.map((r: any) => r.id)).toContain(recipeId);

    const other = await readJson(
      await recipesGET(authed(new NextRequest('http://localhost/api/recipes?mine=1'), token2)),
    );
    expect(other.recipes.map((r: any) => r.id)).not.toContain(recipeId);

    const pub = await readJson(
      await recipesGET(new NextRequest(`http://localhost/api/recipes?q=${RUN}`)),
    );
    expect(pub.recipes.map((r: any) => r.id)).not.toContain(recipeId);
  });

  it('PATCH portions recalculates per-portion nutrition', async () => {
    const res = await recipePATCH(
      authed(jsonRequest(`http://localhost/api/recipes/${recipeId}`, 'PATCH', {
        portions: 2,
        // v21.6: the guard is required on every PATCH.
        // v21.7: the guard is the (hash, revision) pair (§5b).
        expectedContentHash: recipeHash,
        expectedRevision: recipeRevision,
      }), token),
      { params: { slug: recipeId } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.recipe.servings).toBe(2);
    expect(body.recipe.kcalPerServing).toBe(440);
    // The write moved the content revision — the next PATCH echoes the new one.
    recipeHash = typeof body.recipe.contentHash === 'string' ? body.recipe.contentHash : null;
    expect(recipeHash).not.toBeNull();
    // v21.7: every PATCH also bumps the revision token — the next PATCH
    // must carry the new value.
    recipeRevision = body.recipe.revision as number;
    expect(recipeRevision).toBeGreaterThan(0);
  });

  it('PATCH ingredients recalculates too', async () => {
    const res = await recipePATCH(
      authed(
        jsonRequest(`http://localhost/api/recipes/${recipeId}`, 'PATCH', {
          ingredients: [{ name: 'Sugar', grams: 100, kcal: 400, carbsG: 100 }],
          // v21.6: the guard is required on every PATCH.
          // v21.7: the guard is the (hash, revision) pair (§5b).
          expectedContentHash: recipeHash,
          expectedRevision: recipeRevision,
        }),
        token,
      ),
      { params: { slug: recipeId } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    // 100 g sugar -> 400 kcal total, 2 portions -> 200 per portion.
    expect(body.recipe.kcalPerServing).toBe(200);
    expect(body.recipe.carbsPerServing).toBe(50);
  });

  it("another user cannot PATCH someone else's recipe", async () => {
    const res = await recipePATCH(
      authed(jsonRequest(`http://localhost/api/recipes/${recipeId}`, 'PATCH', { portions: 9 }), token2),
      { params: { slug: recipeId } },
    );
    expect(res.status).toBe(404);
  });
});
