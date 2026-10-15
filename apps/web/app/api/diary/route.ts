import { NextRequest, NextResponse } from 'next/server';
import { prisma, PrismaRuntime, type Prisma } from '@fitfusion/db';
import { DiaryEntrySchema, normalizeIdempotencyKey, requiresAcknowledgement, scaleMicros, scaleNutrients, sumNutrients, roundNutrients } from '@fitfusion/core';
import type { MicroNutrients, Nutrients } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { canViewRecipe } from '@/lib/recipe-access';
import { clampServings, nutritionForServings, perServingFromRecipe } from '@/lib/recipe-servings';
import { apiError, apiOk, parseDateOnly, readJson, toDateOnly, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

function foodNutrients(food: {
  kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number;
}): Nutrients {
  return {
    kcal: food.kcal,
    proteinG: food.proteinG,
    carbsG: food.carbsG,
    fatG: food.fatG,
    fiberG: food.fiberG,
  };
}

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const dateParam = req.nextUrl.searchParams.get('date');
  const date = parseDateOnly(dateParam) ?? parseDateOnly(toDateOnly(new Date()));
  if (!date) {
    return apiError('validation_error', 'date must be YYYY-MM-DD', 400);
  }
  const entries = await prisma.diaryEntry.findMany({
    where: { userId: s.user.id, date },
    orderBy: { createdAt: 'asc' },
    include: { food: { select: { id: true, name: true, servingUnit: true } } },
  });
  const totals = roundNutrients(
    sumNutrients(
      entries.map((e) => ({
        kcal: e.kcal, proteinG: e.proteinG, carbsG: e.carbsG, fatG: e.fatG, fiberG: e.fiberG,
      })),
    ),
  );
  return apiOk({ date: toDateOnly(date), entries, totals });
}

export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  // Idempotency: a repeated POST with the same key returns the original row.
  const headerKey = req.headers.get('Idempotency-Key');
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = DiaryEntrySchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid diary entry', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;
  const idempotencyKey =
    normalizeIdempotencyKey(headerKey) ?? normalizeIdempotencyKey(input.idempotencyKey ?? null);

  if (idempotencyKey) {
    const existing = await prisma.diaryEntry.findUnique({
      where: { userId_idempotencyKey: { userId: s.user.id, idempotencyKey } },
    });
    if (existing) {
      return apiOk({ entry: existing, idempotentReplay: true }, 200);
    }
  }

  if (!input.foodId && !input.customName && !input.recipeId) {
    return apiError('validation_error', 'foodId, customName or recipeId is required', 400);
  }

  // Never trust client totals: recompute from the Food when a foodId is
  // given, and from the stored Recipe when a recipeId is given. The client
  // may declare where numbers came from (manual/recipe/web/scan); anything
  // else falls back to 'manual'.
  let nutrients: Nutrients;
  // V20: micro snapshot, same scaling contract as macros. foodId path:
  // scaled from the Food's snapshot. customName/recipe paths: client
  // already scaled by servings (exactly like kcal), stored as-is after
  // rounding (recipes carry no micros, so there is nothing to recompute).
  let micros: MicroNutrients | null = null;
  let source = input.source ?? 'manual';
  let servings = input.servings;
  let customName = input.customName ?? null;
  // V21.4: recipe FK persisted at log time; durable partial-nutrition
  // indicator (null = complete values — never presented as partial).
  let recipeId: string | null = null;
  let nutritionPartial: boolean | null = null;
  if (input.recipeId) {
    // V21.4: recipe-linked logging. The recipe is resolved server-side; its
    // visibility/ownership rules are enforced via the shared canViewRecipe
    // (a private recipe of another user is rejected as not-found, leaking
    // no existence). Servings and nutrition are RECALCULATED from the
    // stored per-serving values via the authoritative serving contract —
    // client-supplied totals are never trusted on this path.
    const recipe = await prisma.recipe.findUnique({ where: { id: input.recipeId } });
    if (!recipe || !canViewRecipe(recipe, { id: s.user.id })) {
      return apiError('recipe_not_found', 'Recipe not found', 404);
    }
    // V21.4: incomplete nutrition must be explicitly acknowledged at the
    // API level — a direct POST can no longer log partial totals silently.
    const partial = requiresAcknowledgement(recipe.needsReview);
    if (partial && input.nutritionAck !== true) {
      return apiError(
        'nutrition_ack_required',
        "This recipe's nutrition is incomplete (partial totals). Acknowledge explicitly with nutritionAck: true to log it anyway.",
        400,
      );
    }
    servings = clampServings(input.servings);
    nutrients = nutritionForServings(perServingFromRecipe(recipe), servings);
    recipeId = recipe.id;
    if (!customName) customName = recipe.title;
    source = 'recipe';
    nutritionPartial = partial ? true : null;
    micros = scaleMicros(input.micros ?? null, 1);
  } else if (input.foodId) {
    const food = await prisma.food.findUnique({ where: { id: input.foodId } });
    if (!food) {
      return apiError('food_not_found', 'Food not found', 404);
    }
    nutrients = roundNutrients(scaleNutrients(foodNutrients(food), 1, input.servings));
    micros = scaleMicros((food.micros as MicroNutrients | null) ?? null, input.servings);
  } else {
    nutrients = {
      kcal: input.kcal,
      proteinG: input.proteinG ?? 0,
      carbsG: input.carbsG ?? 0,
      fatG: input.fatG ?? 0,
      fiberG: input.fiberG ?? 0,
    };
    micros = scaleMicros(input.micros ?? null, 1);
  }

  const date = parseDateOnly(input.date);
  if (!date) {
    return apiError('validation_error', 'date must be YYYY-MM-DD', 400);
  }

  const entry = await prisma.diaryEntry.create({
    data: {
      userId: s.user.id,
      date,
      mealType: input.mealType,
      foodId: input.foodId ?? null,
      customName,
      servings,
      kcal: nutrients.kcal,
      proteinG: nutrients.proteinG,
      carbsG: nutrients.carbsG,
      fatG: nutrients.fatG,
      fiberG: nutrients.fiberG,
      // V20: Prisma 5 typed client takes Prisma.DbNull (not plain null)
      // for a nullable Json field, and a JSON round-trip for the object
      // (zod-inferred optionals lack the InputJsonValue index signature).
      // Null micros = not tracked (never 0).
      micros: micros
        ? (JSON.parse(JSON.stringify(micros)) as Prisma.InputJsonValue)
        : PrismaRuntime.DbNull,
      source,
      recipeId,
      // V21.4: durable partial-nutrition marker; the returned entry carries
      // it so partial totals are never presented as complete.
      nutritionPartial,
      idempotencyKey,
    },
  });
  return apiOk({ entry }, 201);
}
