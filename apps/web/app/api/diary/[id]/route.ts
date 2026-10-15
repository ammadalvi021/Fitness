import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { DiaryEntrySchema, roundNutrients, scaleNutrients } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { canViewRecipe } from '@/lib/recipe-access';
import { nutritionForServings, perServingFromRecipe } from '@/lib/recipe-servings';
import { apiError, apiOk, parseDateOnly, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

async function ownedEntry(userId: string, id: string) {
  return prisma.diaryEntry.findFirst({ where: { id, userId } });
}

// V21.4: recipeId/nutritionAck are log-time fields — a PATCH cannot re-link
// an entry to a different recipe or retro-ack partial nutrition.
const PatchSchema = DiaryEntrySchema.partial().omit({
  idempotencyKey: true,
  recipeId: true,
  nutritionAck: true,
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const existing = await ownedEntry(s.user.id, params.id);
  if (!existing) {
    return apiError('not_found', 'Diary entry not found', 404);
  }
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = PatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid diary entry', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;

  const data: Record<string, unknown> = {};
  if (input.mealType !== undefined) data.mealType = input.mealType;
  if (input.customName !== undefined) data.customName = input.customName;
  if (input.date !== undefined) {
    const d = parseDateOnly(input.date);
    if (!d) return apiError('validation_error', 'date must be YYYY-MM-DD', 400);
    data.date = d;
  }

  // Recompute nutrients server-side when servings/food change.
  const servings = input.servings ?? existing.servings;
  const foodId = input.foodId !== undefined ? input.foodId : existing.foodId;
  if (input.servings !== undefined) data.servings = input.servings;
  if (input.foodId !== undefined) {
    data.foodId = input.foodId;
    // V21.4: re-linking to a Food drops the recipe linkage (and its partial
    // marker) — the entry is no longer recipe-computed from this point.
    if (existing.recipeId) {
      data.recipeId = null;
      data.nutritionPartial = null;
    }
  }
  const nutrientFieldsSupplied =
    input.kcal !== undefined ||
    input.proteinG !== undefined ||
    input.carbsG !== undefined ||
    input.fatG !== undefined ||
    input.fiberG !== undefined;
  if (foodId) {
    const food = await prisma.food.findUnique({ where: { id: foodId } });
    if (!food) return apiError('food_not_found', 'Food not found', 404);
    const n = roundNutrients(
      scaleNutrients(
        { kcal: food.kcal, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, fiberG: food.fiberG },
        1,
        servings,
      ),
    );
    Object.assign(data, { kcal: n.kcal, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG, fiberG: n.fiberG });
  } else {
    // V21.4: entries logged from a recipe keep the server-computed totals —
    // a servings/totals edit re-derives from the stored recipe (same
    // authoritative contract as the POST path) rather than trusting client
    // values. Only when the recipe is gone or no longer viewable does the
    // edit fall back to the manual-entry behavior.
    let recomputedFromRecipe = false;
    if (existing.recipeId && (input.servings !== undefined || nutrientFieldsSupplied)) {
      const recipe = await prisma.recipe.findUnique({ where: { id: existing.recipeId } });
      if (recipe && canViewRecipe(recipe, { id: s.user.id })) {
        const n = nutritionForServings(perServingFromRecipe(recipe), servings);
        Object.assign(data, { kcal: n.kcal, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG, fiberG: n.fiberG });
        recomputedFromRecipe = true;
      }
    }
    if (!recomputedFromRecipe && nutrientFieldsSupplied) {
      // Custom (non-food) entries: accept the provided values.
      if (input.kcal !== undefined) data.kcal = input.kcal;
      if (input.proteinG !== undefined) data.proteinG = input.proteinG;
      if (input.carbsG !== undefined) data.carbsG = input.carbsG;
      if (input.fatG !== undefined) data.fatG = input.fatG;
      if (input.fiberG !== undefined) data.fiberG = input.fiberG;
    }
  }

  const entry = await prisma.diaryEntry.update({ where: { id: existing.id }, data });
  return apiOk({ entry });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const existing = await ownedEntry(s.user.id, params.id);
  if (!existing) {
    return apiError('not_found', 'Diary entry not found', 404);
  }
  await prisma.diaryEntry.delete({ where: { id: existing.id } });
  return apiOk({ deleted: true });
}
