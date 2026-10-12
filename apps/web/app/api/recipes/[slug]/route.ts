import { NextRequest, NextResponse } from 'next/server';
import { prisma, type Prisma } from '@fitfusion/db';
import { CustomRecipePatchSchema, type RecipeIngredientInput } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';
import { recipeNutrition, resolveIngredientRows, toInstructionSteps } from '../custom-recipe';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const recipe = await prisma.recipe.findUnique({
    where: { slug: params.slug },
    include: { cuisine: { select: { id: true, name: true, region: true } } },
  });
  if (!recipe) {
    return apiError('not_found', 'Recipe not found', 404);
  }
  return apiOk({ recipe });
}

/**
 * PATCH /api/recipes/[id] — update the caller's own private recipe.
 * The path param accepts the recipe id (or its slug). Changing ingredients
 * or portions triggers a full nutrition recalculation; water rows still
 * contribute 0 kcal.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const existing = await prisma.recipe.findFirst({
    where: {
      userId: s.user.id,
      OR: [{ id: params.slug }, { slug: params.slug }],
    },
  });
  if (!existing) {
    return apiError('not_found', 'Recipe not found', 404);
  }
  if (!existing.isPrivate) {
    return apiError('forbidden', 'Only your own private recipes can be edited', 403);
  }

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = CustomRecipePatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid recipe update', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;

  // Recompute nutrition whenever the ingredient list or portion count changes.
  // Stored ingredient rows are already resolved to per-100-g values, so a
  // portions-only change reuses them; a new ingredient list is resolved fresh
  // (foodId rows pick up current catalogue values).
  let ingredientsJson: Prisma.InputJsonValue | undefined;
  let servings = existing.servings;
  let perPortion: {
    kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number;
  } | null = null;
  const ingredientsChanged = input.ingredients !== undefined;
  const portionsChanged = input.portions !== undefined;

  if (ingredientsChanged || portionsChanged) {
    let rows: RecipeIngredientInput[];
    if (ingredientsChanged) {
      const resolved = await resolveIngredientRows(input.ingredients!);
      if (resolved.missingFood) {
        return apiError('food_not_found', `Food not found for ingredient "${resolved.missingFood}"`, 404);
      }
      rows = resolved.rows;
    } else {
      rows = (existing.ingredients as unknown as RecipeIngredientInput[]) ?? [];
    }
    servings = input.portions ?? existing.servings;
    perPortion = recipeNutrition(rows, servings).perPortion;
    ingredientsJson = rows as unknown as Prisma.InputJsonValue;
  }

  const recipe = await prisma.recipe.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { title: input.name.trim() } : {}),
      ...(input.dietCategory !== undefined ? { dietCategory: input.dietCategory } : {}),
      ...(input.prepMin !== undefined ? { prepMin: input.prepMin } : {}),
      ...(input.cookMin !== undefined ? { cookMin: input.cookMin } : {}),
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      ...(input.yieldGrams !== undefined ? { yieldGrams: input.yieldGrams } : {}),
      ...(input.instructions !== undefined ? { instructions: toInstructionSteps(input.instructions) } : {}),
      ...(ingredientsChanged || portionsChanged
        ? {
            servings,
            ingredients: ingredientsJson,
            kcalPerServing: perPortion!.kcal,
            proteinPerServing: perPortion!.proteinG,
            carbsPerServing: perPortion!.carbsG,
            fatPerServing: perPortion!.fatG,
            fiberPerServing: perPortion!.fiberG,
          }
        : {}),
    },
  });
  return apiOk({ recipe });
}
