import { NextRequest, NextResponse } from 'next/server';
import { prisma, PrismaRuntime, type Prisma } from '@fitfusion/db';
import {
  CustomRecipePatchSchema,
  invalidationForEdit,
  type RecipeIngredientInput,
} from '@fitfusion/core';
import { getSessionUser, requireUser } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { canViewRecipe } from '@/lib/recipe-access';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';
import { serializeRecipePublic } from '@/lib/recipe-evidence';
import { recipeNutrition, resolveIngredientRows, toInstructionSteps } from '../custom-recipe';

export const dynamic = 'force-dynamic';

/**
 * Serving contract (v21.2) — the response fields mean exactly this:
 * - kcalPerServing / proteinPerServing / carbsPerServing / fatPerServing /
 *   fiberPerServing are nutrients for ONE serving. Nutrition for N servings =
 *   per-serving × N (clients must never multiply/divide these by the yield
 *   factor again).
 * - `servings` is the recipe's original yield; `ingredients[].grams` are
 *   quantities for that original yield — displayed quantities scale by
 *   (selectedYield / servings).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const recipe = await prisma.recipe.findUnique({
    where: { slug: params.slug },
    include: { cuisine: { select: { id: true, name: true, region: true } } },
  });
  if (!recipe) {
    return apiError('not_found', 'Recipe not found', 404);
  }
  // Private recipes are visible only to their owner. Any other viewer
  // (anonymous or authenticated non-owner) gets a 404 so the recipe's
  // existence is not leaked.
  const s = await getSessionUser(req);
  if (!canViewRecipe(recipe, s ? s.user : null)) {
    return apiError('not_found', 'Recipe not found', 404);
  }
  // v21.3: the server is the tier authority — tier is computed canonically
  // from full evidence; full evidence objects go to admins only.
  // v21.4: serializeRecipePublic strips the raw evidence columns before
  // responding (the old `{ ...recipe, ...shapeRecipeEvidence() }` spread
  // left the raw JSONB fields in place for non-admins).
  const admin = !!s && isAdmin(s);
  return apiOk({ recipe: serializeRecipePublic(recipe, admin) });
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

  // v21.4 governance: a material edit (ingredients, portions/yield,
  // dietCategory — the canonical set lives in
  // packages/core/src/recipe-governance.ts) lapses the prior review AND the
  // verification: the recorded evidence was checked against the previous
  // content, and a recipe must never stay Verified on stale evidence.
  // Metadata-only edits (name, times, difficulty, instructions) preserve
  // both. The invalidation rides inside the SAME single prisma.update call
  // below, so the recipe is never left half-invalidated.
  const invalidation = invalidationForEdit(Object.keys(input));
  const invalidationData: Prisma.RecipeUpdateInput = {
    ...(invalidation.invalidateVerification
      ? { verified: false, verificationEvidence: PrismaRuntime.JsonNull }
      : {}),
    ...(invalidation.invalidateReview
      ? { reviewEvidence: PrismaRuntime.JsonNull }
      : {}),
  };

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
    // V21.2 (P4/P1): a new ingredient list can complete or newly invalidate
    // nutrition — refresh needsReview with the ingredients. A portions-only
    // change reuses the stored rows and preserves the existing flag.
    let patchNeedsReview: boolean | undefined;
    let nutritionWarnings: string[] = [];
    if (ingredientsChanged) {
      const resolved = await resolveIngredientRows(input.ingredients!);
      if (resolved.missingFood) {
        return apiError('food_not_found', `Food not found for ingredient "${resolved.missingFood}"`, 404);
      }
      rows = resolved.rows;
      patchNeedsReview = resolved.nutritionIncomplete;
      nutritionWarnings = resolved.warnings;
    } else {
      rows = (existing.ingredients as unknown as RecipeIngredientInput[]) ?? [];
    }
    servings = input.portions ?? existing.servings;
    perPortion = recipeNutrition(rows, servings).perPortion;
    ingredientsJson = rows as unknown as Prisma.InputJsonValue;

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
        servings,
        ingredients: ingredientsJson,
        kcalPerServing: perPortion!.kcal,
        proteinPerServing: perPortion!.proteinG,
        carbsPerServing: perPortion!.carbsG,
        fatPerServing: perPortion!.fatG,
        fiberPerServing: perPortion!.fiberG,
        ...(patchNeedsReview !== undefined ? { needsReview: patchNeedsReview } : {}),
        ...invalidationData,
      },
    });
    // v21.4: never return the raw Prisma record — strip the evidence
    // columns (an admin-reviewed private recipe would otherwise leak the
    // reviewer's email to its owner).
    return apiOk({
      recipe: serializeRecipePublic(recipe, isAdmin(s)),
      nutritionWarnings,
      nutritionIncomplete: patchNeedsReview ?? existing.needsReview,
    });
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
        ...invalidationData,
    },
  });
  // v21.4: never return the raw Prisma record — strip the evidence columns.
  return apiOk({ recipe: serializeRecipePublic(recipe, isAdmin(s)) });
}
