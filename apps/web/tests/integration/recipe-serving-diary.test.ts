/**
 * v21.4 (Worker C) — diary recipe persistence + server-side recalculation.
 *
 * Defect (confirmed): POST /api/diary accepted `recipeId` from
 * buildRecipeDiaryPayload() but stripped it (DiaryEntrySchema had no such
 * field), never persisted it, and trusted client totals.
 *
 * Contract under test:
 * - a recipeId POST resolves the stored recipe, enforces
 *   visibility/ownership via canViewRecipe (private recipe of another user
 *   -> 404 with no existence leak), and RECALCULATES servings/nutrition
 *   server-side from the stored per-serving values — tampered client totals
 *   are overridden;
 * - recipeId is persisted on the diary record and returned on diary fetch;
 * - invalid recipe IDs are rejected;
 * - incomplete (needsReview) recipes require explicit nutritionAck: true at
 *   the API level (silent partial logging is rejected), and acknowledged
 *   partial entries carry nutritionPartial: true so the display never
 *   presents them as complete;
 * - manual entries (no recipeId) are unaffected.
 *
 * DB-gated: skips gracefully when no PostgreSQL is reachable (this dev VM);
 * CI with a database runs it.
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as diaryPOST, GET as diaryGET } from '@/app/api/diary/route';
import { PATCH as diaryPATCH } from '@/app/api/diary/[id]/route';
import { buildRecipeDiaryPayload } from '@/lib/recipe-servings';
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

const PER_SERVING = { kcal: 400, proteinG: 30, carbsG: 20, fatG: 15, fiberG: 5 };

let seq = 0;
function makeRecipe(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.recipe.create({
    data: {
      slug: `v214-diary-${Date.now()}-${seq}`,
      title: `Diary Test Recipe ${seq}`,
      dietCategory: 'vegetarian',
      tags: [],
      servings: 4,
      prepMin: 10,
      cookMin: 10,
      difficulty: 'easy',
      ingredients: [],
      instructions: [],
      kcalPerServing: PER_SERVING.kcal,
      proteinPerServing: PER_SERVING.proteinG,
      carbsPerServing: PER_SERVING.carbsG,
      fatPerServing: PER_SERVING.fatG,
      fiberPerServing: PER_SERVING.fiberG,
      source: 'test',
      verified: false,
      allergens: [],
      ...overrides,
    },
  });
}

describe('diary recipeId persistence + server recalculation (DB-gated)', () => {
  let token = '';
  let ownerToken = '';
  let strangerToken = '';
  let strangerId = '';
  let completeRecipe: { id: string };
  let incompleteRecipe: { id: string };
  let privateRecipe: { id: string };
  const recipeIds: string[] = [];

  afterAll(async () => {
    for (const id of recipeIds) {
      await prisma.recipe.delete({ where: { id } }).catch(() => {});
    }
    await cleanupUsers();
  });

  it('registers a user, an owner and a stranger', async () => {
    if (!HAS_DB) return;
    const me = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v214'));
    token = me.token;
    const owner = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v214-own'));
    ownerToken = owner.token;
    const stranger = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v214-str'));
    strangerToken = stranger.token;
    strangerId = stranger.userId;
    expect(token).toBeTruthy();
  });

  it('creates complete, incomplete and private recipes', async () => {
    if (!HAS_DB) return;
    const complete = await makeRecipe({ needsReview: false });
    const incomplete = await makeRecipe({ needsReview: true });
    const priv = await makeRecipe({ userId: strangerId, isPrivate: true, source: 'user' });
    completeRecipe = { id: complete.id };
    incompleteRecipe = { id: incomplete.id };
    privateRecipe = { id: priv.id };
    recipeIds.push(complete.id, incomplete.id, priv.id);
    expect(complete.needsReview).toBe(false);
    expect(incomplete.needsReview).toBe(true);
  });

  it('persists recipeId and stores server-computed totals (tampered client totals overridden)', async () => {
    if (!HAS_DB) return;
    const payload = {
      ...buildRecipeDiaryPayload({
        recipeId: completeRecipe.id,
        title: 'Diary Test Recipe',
        servingsEaten: 2,
        perServing: PER_SERVING,
        date: '2026-10-15',
        mealType: 'dinner',
      }),
      // Tampered client totals: the server must ignore these.
      kcal: 9999,
      proteinG: 999,
    };
    const res = await diaryPOST(authed(jsonRequest('http://localhost/api/diary', 'POST', payload), token));
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.entry.recipeId).toBe(completeRecipe.id);
    expect(body.entry.servings).toBe(2);
    // Server recalculation: per-serving × 2, never the tampered values.
    expect(body.entry.kcal).toBe(800);
    expect(body.entry.proteinG).toBe(60);
    expect(body.entry.carbsG).toBe(40);
    expect(body.entry.fatG).toBe(30);
    expect(body.entry.fiberG).toBe(10);
    expect(body.entry.source).toBe('recipe');
    expect(body.entry.nutritionPartial).toBeNull();
  });

  it('returns recipeId and nutritionPartial on diary fetch', async () => {
    if (!HAS_DB) return;
    const res = await diaryGET(
      authed(jsonRequest('http://localhost/api/diary?date=2026-10-15', 'GET'), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const entry = body.entries.find((e: any) => e.recipeId === completeRecipe.id);
    expect(entry).toBeTruthy();
    expect(entry.recipeId).toBe(completeRecipe.id);
    expect(entry.nutritionPartial).toBeNull();
  });

  it('rejects an invalid recipe ID', async () => {
    if (!HAS_DB) return;
    const payload = {
      ...buildRecipeDiaryPayload({
        recipeId: 'recipe-does-not-exist',
        title: 'Ghost Recipe',
        servingsEaten: 1,
        perServing: PER_SERVING,
        date: '2026-10-15',
        mealType: 'lunch',
      }),
    };
    const res = await diaryPOST(authed(jsonRequest('http://localhost/api/diary', 'POST', payload), token));
    expect(res.status).toBe(404);
    expect((await readJson(res)).error.code).toBe('recipe_not_found');
  });

  it('rejects a private recipe of another user (no existence leak)', async () => {
    if (!HAS_DB) return;
    const payload = {
      ...buildRecipeDiaryPayload({
        recipeId: privateRecipe.id,
        title: 'Private Recipe',
        servingsEaten: 1,
        perServing: PER_SERVING,
        date: '2026-10-15',
        mealType: 'lunch',
      }),
    };
    // Non-owner: 404, same as nonexistent.
    const denied = await diaryPOST(
      authed(jsonRequest('http://localhost/api/diary', 'POST', payload), ownerToken),
    );
    expect(denied.status).toBe(404);
    expect((await readJson(denied)).error.code).toBe('recipe_not_found');
    // Owner may log it.
    const allowed = await diaryPOST(
      authed(jsonRequest('http://localhost/api/diary', 'POST', payload), strangerToken),
    );
    expect(allowed.status).toBe(201);
    expect((await readJson(allowed)).entry.recipeId).toBe(privateRecipe.id);
  });

  it('rejects an incomplete recipe without explicit acknowledgement', async () => {
    if (!HAS_DB) return;
    const payload = buildRecipeDiaryPayload({
      recipeId: incompleteRecipe.id,
      title: 'Incomplete Recipe',
      servingsEaten: 1,
      perServing: PER_SERVING,
      date: '2026-10-15',
      mealType: 'dinner',
    });
    const res = await diaryPOST(authed(jsonRequest('http://localhost/api/diary', 'POST', payload), token));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('nutrition_ack_required');
  });

  it('allows an incomplete recipe with explicit acknowledgement and marks it partial', async () => {
    if (!HAS_DB) return;
    const payload = {
      ...buildRecipeDiaryPayload({
        recipeId: incompleteRecipe.id,
        title: 'Incomplete Recipe',
        servingsEaten: 1,
        perServing: PER_SERVING,
        date: '2026-10-15',
        mealType: 'dinner',
      }),
      nutritionAck: true,
    };
    const res = await diaryPOST(authed(jsonRequest('http://localhost/api/diary', 'POST', payload), token));
    expect(res.status).toBe(201);
    const body = await readJson(res);
    // Server still recalculates the totals; only the ack differs.
    expect(body.entry.kcal).toBe(400);
    // Durable partial indicator — the display must never present this as complete.
    expect(body.entry.nutritionPartial).toBe(true);

    // Diary fetch surfaces the partial marker too.
    const fetched = await diaryGET(
      authed(jsonRequest('http://localhost/api/diary?date=2026-10-15', 'GET'), token),
    );
    const entries = (await readJson(fetched)).entries as any[];
    const partial = entries.find((e) => e.id === body.entry.id);
    expect(partial.nutritionPartial).toBe(true);
  });

  it('needs no acknowledgement for a complete recipe', async () => {
    if (!HAS_DB) return;
    const payload = buildRecipeDiaryPayload({
      recipeId: completeRecipe.id,
      title: 'Complete Recipe',
      servingsEaten: 1,
      perServing: PER_SERVING,
      date: '2026-10-15',
      mealType: 'breakfast',
    });
    const res = await diaryPOST(authed(jsonRequest('http://localhost/api/diary', 'POST', payload), token));
    expect(res.status).toBe(201);
    expect((await readJson(res)).entry.nutritionPartial).toBeNull();
  });

  it('manual entries without recipeId are stored exactly as sent', async () => {
    if (!HAS_DB) return;
    const payload = {
      date: '2026-10-15',
      mealType: 'snack',
      customName: 'Handful of almonds',
      servings: 1.5,
      kcal: 247,
      proteinG: 9,
      carbsG: 9,
      fatG: 21,
      fiberG: 5,
    };
    const res = await diaryPOST(authed(jsonRequest('http://localhost/api/diary', 'POST', payload), token));
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.entry.recipeId).toBeNull();
    expect(body.entry.nutritionPartial).toBeNull();
    expect(body.entry.kcal).toBe(247);
    expect(body.entry.proteinG).toBe(9);
    expect(body.entry.source).toBe('manual');
  });

  it('PATCH servings on a recipe entry recomputes from the recipe', async () => {
    if (!HAS_DB) return;
    const payload = buildRecipeDiaryPayload({
      recipeId: completeRecipe.id,
      title: 'Patch Target',
      servingsEaten: 1,
      perServing: PER_SERVING,
      date: '2026-10-15',
      mealType: 'lunch',
    });
    const created = await diaryPOST(authed(jsonRequest('http://localhost/api/diary', 'POST', payload), token));
    const entryId = (await readJson(created)).entry.id as string;

    // Tampered PATCH totals are recomputed, not trusted.
    const patched = await diaryPATCH(
      authed(
        jsonRequest(`http://localhost/api/diary/${entryId}`, 'PATCH', { servings: 3, kcal: 12345 }),
        token,
      ),
      { params: { id: entryId } },
    );
    expect(patched.status).toBe(200);
    const body = await readJson(patched);
    expect(body.entry.servings).toBe(3);
    expect(body.entry.kcal).toBe(1200);
    expect(body.entry.proteinG).toBe(90);
    expect(body.entry.recipeId).toBe(completeRecipe.id);
  });
});
