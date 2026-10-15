/**
 * V21.2 nutrition correctness (P1 + P4) — server-side ingredient resolution.
 *
 * DB-backed — skipped gracefully when no PostgreSQL is reachable
 * (db-guard). The pure logic is covered without a DB by
 * packages/core/src/{serving-weight,custom-ingredients,density}.test.ts.
 *
 * P1: per-100-g factor uses the canonical serving weight (servingWeightG →
 *     servingUnit annotation → normalization), never `100 / servingSize`.
 *     Chapati (count) and milk (volume) must produce realistic totals;
 *     unknown serving weights mark the recipe needsReview (INCOMPLETE).
 * P4: a name+grams-only row must NOT silently contribute 0 — unknown
 *     ingredients are flagged "nutrition unknown" and force needsReview;
 *     declared nutrients require all five + a basis; the explicit
 *     KNOWN_ZERO list (water, salt, plain spices) stays zero.
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
const RUN = `v212n${Date.now().toString(36)}`;

describe.skipIf(!HAS_DB)('V21.2 nutrition correctness (P1 + P4)', () => {
  let token = '';
  let chapatiId = '';
  let milkId = '';
  let mysteryId = '';
  const foodIds: string[] = [];
  const recipeIds: string[] = [];

  afterAll(async () => {
    for (const id of recipeIds) {
      await prisma.recipe.delete({ where: { id } }).catch(() => {});
    }
    for (const id of foodIds) {
      await prisma.food.delete({ where: { id } }).catch(() => {});
    }
    await cleanupUsers();
  });

  it('registers a user and catalogue foods with count/volume/unknown servings', async () => {
    ({ token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v212n')));
    const chapati = await prisma.food.create({
      data: {
        name: `${RUN} Chapati`,
        servingSize: 1,
        servingUnit: 'piece (30g)',
        servingWeightG: 30, // canonical: 1 piece = 30 g
        kcal: 90, proteinG: 3, carbsG: 18, fatG: 1, fiberG: 3,
        source: 'seeded',
      },
    });
    const milk = await prisma.food.create({
      data: {
        name: `${RUN} Whole Milk`,
        servingSize: 250,
        servingUnit: 'ml (1 cup)',
        servingWeightG: 257.5, // 250 ml × 1.03 g/ml
        kcal: 150, proteinG: 8, carbsG: 12, fatG: 8, fiberG: 0,
        source: 'seeded',
      },
    });
    const mystery = await prisma.food.create({
      data: {
        name: `${RUN} Mystery Pack`,
        servingSize: 1,
        servingUnit: 'packet', // no gram equivalent, no density → unknown
        kcal: 200, proteinG: 5, carbsG: 30, fatG: 6, fiberG: 2,
        source: 'seeded',
      },
    });
    chapatiId = chapati.id;
    milkId = milk.id;
    mysteryId = mystery.id;
    foodIds.push(chapatiId, milkId, mysteryId);
    expect(token).toBeTruthy();
  });

  it('P1: count servings convert via servingWeightG — chapati is 300 kcal/100 g, not 9000', async () => {
    const res = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Chapati Test`,
          ingredients: [{ foodId: chapatiId, name: 'Chapati', grams: 60 }],
          portions: 2,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    recipeIds.push(body.recipe.id);
    // 60 g × 300 kcal/100 g = 180 kcal total → 90 per serving.
    expect(body.recipe.kcalPerServing).toBe(90);
    expect(body.recipe.proteinPerServing).toBe(3);
    expect(body.nutritionIncomplete).toBe(false);
    expect(body.recipe.needsReview).toBe(false);
  });

  it('P1: volume servings convert via servingWeightG — milk is ≈58 kcal/100 g', async () => {
    const res = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Milk Test`,
          ingredients: [{ foodId: milkId, name: 'Milk', grams: 250 }],
          portions: 1,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    recipeIds.push(body.recipe.id);
    // 250 g × (150 × 100/257.5)/100 = 145.6 kcal — NOT the 150 kcal the
    // old 100/servingSize math produced.
    expect(body.recipe.kcalPerServing).toBeCloseTo(145.6, 0);
    expect(body.nutritionIncomplete).toBe(false);
  });

  it('P1: unknown serving weight marks the recipe needsReview (INCOMPLETE, never guessed)', async () => {
    const res = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Mystery Test`,
          ingredients: [
            { foodId: chapatiId, name: 'Chapati', grams: 30 },
            { foodId: mysteryId, name: 'Mystery Pack', grams: 100 },
          ],
          portions: 1,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    recipeIds.push(body.recipe.id);
    expect(body.nutritionIncomplete).toBe(true);
    expect(body.recipe.needsReview).toBe(true);
    expect(body.nutritionWarnings.length).toBeGreaterThan(0);
    // Only the chapati contributes: 30 g × 300/100 = 90 kcal.
    expect(body.recipe.kcalPerServing).toBe(90);
    // The stored row records the incomplete status.
    const rows = body.recipe.ingredients as { name: string; nutritionStatus: string }[];
    expect(rows.find((r) => r.name === 'Mystery Pack')?.nutritionStatus).toBe('incomplete');
  });

  it('P4: an unknown "chicken"-like ingredient is flagged, never silently zeroed', async () => {
    const res = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Unknown Test`,
          ingredients: [
            { name: 'Water', grams: 500 },
            { name: `${RUN} Chicken-ish mystery meat`, grams: 100 },
          ],
          portions: 1,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    recipeIds.push(body.recipe.id);
    expect(body.nutritionIncomplete).toBe(true);
    expect(body.recipe.needsReview).toBe(true);
    expect(
      body.nutritionWarnings.some((w: string) => w.includes('nutrition unknown')),
    ).toBe(true);
    // Both rows contribute 0 — but the unknown one is flagged, not silently zeroed.
    expect(body.recipe.kcalPerServing).toBe(0);
    const rows = body.recipe.ingredients as { name: string; nutritionStatus: string }[];
    expect(rows.find((r) => r.name.includes('mystery meat'))?.nutritionStatus).toBe('unknown');
    expect(rows.find((r) => r.name === 'Water')?.nutritionStatus).toBe('ok');
  });

  it('P4: known-zero salt stays zero and does not force review', async () => {
    const res = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Salt Test`,
          ingredients: [{ name: 'Salt', grams: 5 }],
          portions: 1,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    recipeIds.push(body.recipe.id);
    expect(body.recipe.kcalPerServing).toBe(0);
    expect(body.nutritionIncomplete).toBe(false);
    expect(body.recipe.needsReview).toBe(false);
  });

  it('P4: declared nutrients require all five + a basis', async () => {
    const declared = {
      name: `${RUN} Sauce`, grams: 100,
      kcal: 120, proteinG: 2, carbsG: 10, fatG: 8, fiberG: 1,
    };
    // With basis: accepted and counted.
    const okRes = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Declared Test`,
          ingredients: [{ ...declared, basis: 'label' }],
          portions: 1,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(okRes.status).toBe(201);
    const okBody = await readJson(okRes);
    recipeIds.push(okBody.recipe.id);
    expect(okBody.recipe.kcalPerServing).toBe(120);
    expect(okBody.nutritionIncomplete).toBe(false);

    // Without basis: rejected (400).
    const noBasis = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} No Basis`,
          ingredients: [declared],
          portions: 1,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(noBasis.status).toBe(400);

    // Partial declaration: rejected (400).
    const partial = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Partial`,
          ingredients: [{ name: 'X', grams: 100, kcal: 50, proteinG: 1, basis: 'estimate' }],
          portions: 1,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    expect(partial.status).toBe(400);
  });

  it('PATCH refreshes needsReview when ingredients change', async () => {
    // Start complete.
    const create = await recipesPOST(
      authed(
        jsonRequest('http://localhost/api/recipes', 'POST', {
          name: `${RUN} Patch Test`,
          ingredients: [{ foodId: chapatiId, name: 'Chapati', grams: 30 }],
          portions: 1,
          dietCategory: 'vegetarian', // V21.4: required at creation (never defaulted)
        }),
        token,
      ),
    );
    const created = await readJson(create);
    recipeIds.push(created.recipe.id);
    expect(created.recipe.needsReview).toBe(false);

    // Add an unknown ingredient → needsReview flips on, totals exclude it.
    const patchReq = new NextRequest(
      `http://localhost/api/recipes/${created.recipe.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ingredients: [
            { foodId: chapatiId, name: 'Chapati', grams: 30 },
            { name: `${RUN} Another mystery`, grams: 50 },
          ],
        }),
      },
    );
    const patched = await recipePATCH(authed(patchReq, token), {
      params: { slug: created.recipe.id },
    });
    expect(patched.status).toBe(200);
    const patchedBody = await readJson(patched);
    expect(patchedBody.nutritionIncomplete).toBe(true);
    expect(patchedBody.recipe.needsReview).toBe(true);
    expect(patchedBody.recipe.kcalPerServing).toBe(90);
    expect(patchedBody.nutritionWarnings.length).toBeGreaterThan(0);
  });

  it('GET mine=1 exposes needsReview so the UI can show "nutrition incomplete"', async () => {
    const res = await recipesGET(
      authed(
        new NextRequest('http://localhost/api/recipes?mine=1'),
        token,
      ),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const flagged = (body.recipes as { needsReview: boolean }[]).filter(
      (r) => r.needsReview,
    );
    expect(flagged.length).toBeGreaterThan(0);
  });
});
