import { NextRequest, NextResponse } from 'next/server';
import { prisma, PrismaRuntime, type Prisma, type Recipe } from '@fitfusion/db';
import {
  buildContentSnapshot,
  computeRecipeContentHash,
  CustomRecipePatchSchema,
  dietAllergenRecheckNeeded,
  checkRecipeDiet,
  dietAmbiguityWarning,
  dietConflictMessage,
  invalidationForEdit,
  screenIngredientAllergens,
} from '@fitfusion/core';
import { getSessionUser, requireUser } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { canViewRecipe } from '@/lib/recipe-access';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';
import { serializeRecipePublic } from '@/lib/recipe-evidence';
import {
  recipeNutrition,
  resolveIngredientRows,
  toInstructionSteps,
  toDietScreenRows,
  ingredientAllergenScreenNames,
  storedRowAllergenKey,
  storedRowAllergenScreenNames,
  type ResolvedRow,
  type StoredIngredientRow,
} from '../custom-recipe';

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

  // v21.4/v21.5 governance: a material edit (ingredients, portions,
  // dietCategory, tags, allergens — the canonical set lives in
  // packages/core/src/recipe-governance.ts) lapses the prior review AND the
  // verification: the recorded evidence was checked against the previous
  // content, and a recipe must never stay Verified on stale evidence.
  // Metadata-only edits (name, times, difficulty, instructions, yieldGrams)
  // preserve both. yieldGrams (v21.5) is the cook's informational reference
  // for the cooked batch weight — it is NOT a divisor in the per-serving
  // math, so a yieldGrams-only PATCH stores the value with nutrition
  // untouched and evidence preserved; calories are never recomputed just
  // to clear a review flag. The invalidation rides inside the SAME single
  // prisma.update call below, so the recipe is never left half-invalidated.
  // v21.5 (P4): `expectedContentHash` is a write guard, not a content
  // field — it must never count as a material edit (a client that sends
  // it on every PATCH would otherwise invalidate evidence it never
  // changed).
  const invalidation = invalidationForEdit(
    Object.keys(input).filter(
      (k) => k !== 'expectedContentHash' && k !== 'expectedRevision',
    ),
  );
  const invalidationData: Prisma.RecipeUpdateInput = {
    ...(invalidation.invalidateVerification
      ? { verified: false, verificationEvidence: PrismaRuntime.JsonNull }
      : {}),
    ...(invalidation.invalidateReview
      ? { reviewEvidence: PrismaRuntime.JsonNull }
      : {}),
  };

  // ------------------------------------------------------------------
  // V21.5 (P4) optimistic concurrency, V21.6: the guard is REQUIRED,
  // V21.7: the guard is the (contentHash, revision) PAIR (§5b).
  // ------------------------------------------------------------------
  // The new contentHash is computed from the MERGED post-write content
  // (stored values for untouched fields, patch values for edited fields)
  // and written in the SAME atomic update as every other change — the
  // recipe is never left with a hash that doesn't match its content.
  //
  // V21.6 (recipe-governance.ts §5): every PATCH carries a concurrency
  // guard — there is NO silent unconditional write path anymore. The client
  // sends the hash it read (`expectedContentHash`, a string), or EXPLICIT
  // null for legacy rows that predate hash tracking (the GET returns
  // `contentHash: null` for those). Absent/undefined guard → 409
  // `stale_recipe` with an actionable message (reload and retry); the
  // write never lands unconditionally.
  //
  // V21.7 (recipe-governance.ts §5b): the guard is a PAIR — the client
  // must also send `expectedRevision` (the integer revision token it
  // read). The revision increments on EVERY mutation (including
  // review/verify/clear, which never move the content hash), so the pair
  // closes the review-state overwrite hole. Absent/undefined revision →
  // 409 `stale_recipe`, same as the hash. The zod schema already rejects
  // malformed values (non-integer, negative) before we get here.
  const expectedContentHash = input.expectedContentHash;
  if (expectedContentHash === undefined) {
    return apiError(
      'stale_recipe',
      'Recipe write requires expectedContentHash (the contentHash you read, or explicit null for recipes that predate hash tracking). Reload the recipe and retry.',
      409,
      'expectedContentHash was not supplied',
    );
  }
  const expectedRevision = input.expectedRevision;
  if (expectedRevision === undefined) {
    return apiError(
      'stale_recipe',
      'Recipe write requires expectedRevision (the revision token you read; 0 for recipes written before v21.7). Reload the recipe and retry.',
      409,
      'expectedRevision was not supplied',
    );
  }

  function staleRecipeError(): NextResponse {
    return apiError(
      'stale_recipe',
      'Recipe content changed since you loaded it. Reload the recipe and retry.',
      409,
      'expectedContentHash did not match the stored contentHash',
    );
  }

  // V21.5 (P3 drive-by): `existing` is narrowed non-null here, but TS
  // discards narrowing for variables captured inside a closure body
  // (TS18047) — capture the id once so guardedUpdate typechecks.
  const existingId = existing.id;

  async function guardedUpdate(
    data: Prisma.RecipeUpdateInput,
  ): Promise<Recipe | null> {
    // V21.6: always conditional. `contentHash: null` matches a legacy
    // NULL-hash row (Prisma translates it to IS NULL); a concurrent edit
    // moves the hash to non-null, so the write fails with 409 exactly
    // like a hash mismatch. There is no unconditional path.
    // V21.7: the `where` also matches `revision: expectedRevision`, and
    // the SAME statement increments it (`revision: { increment: 1 }`).
    // Review/verify/clear bump the revision without touching the hash, so
    // a stale write against a changed review state fails here with 409 —
    // a stale review, verify or clear can never silently undo a newer
    // state, and two concurrent mutations can never both land.
    const res = await prisma.recipe.updateMany({
      where: { id: existingId, contentHash: expectedContentHash, revision: expectedRevision },
      data: { ...data, revision: { increment: 1 } },
    });
    if (res.count === 0) return null;
    // The conditional write already won the race; this read is only for
    // the response body. (A deletion in the gap is impossible here —
    // recipes are never hard-deleted by a user — but null still maps to
    // the safe 409, never a crash.)
    return prisma.recipe.findUnique({ where: { id: existingId } });
  }

  // V21.6: snapshot building is owned by @fitfusion/core's
  // buildContentSnapshot (single source of truth) — this local helper is
  // gone; both hash sites below go through it.

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

  // V21.5 (P1): the previous ingredient identity for the allergen recheck —
  // stored rows carry the canonical catalogue name since v21.5 (older rows
  // fall back to their stored display name). Compared against the NEW
  // canonical names so a display-name-only rename is NOT a material change,
  // while a real ingredient add/remove/swap IS.
  const storedRows = (existing.ingredients as unknown as StoredIngredientRow[] | null) ?? [];
  const prevDietAllergen = {
    ingredients: storedRows.map(storedRowAllergenKey),
    dietCategory: existing.dietCategory,
  };

  // V21.5 (P1): allergen re-screening. Whenever the recheck runs, BOTH
  // `allergens` and `allergenScreened` update together inside the SAME
  // atomic prisma.update as the rest of the patch — a stale screened list
  // can never be left behind, and non-material edits never touch either
  // field. Failed validation (the 400s above) returns before any update,
  // so nothing is ever partially written.
  function allergenRescreenData(screenNames: string[]): Prisma.RecipeUpdateInput {
    return {
      allergens: screenIngredientAllergens(screenNames),
      allergenScreened: true,
    };
  }

  if (ingredientsChanged || portionsChanged) {
    let rows: ResolvedRow[];
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
      // Portions-only: reuse the stored rows (already per-100-g resolved).
      rows = (existing.ingredients as unknown as ResolvedRow[] | null) ?? [];
    }
    servings = input.portions ?? existing.servings;
    perPortion = recipeNutrition(rows, servings).perPortion;
    ingredientsJson = rows as unknown as Prisma.InputJsonValue;

    // V21.5 (P1+P2): re-screen when the ingredient identity set or the diet
    // category materially changed. Screening runs on CANONICAL names +
    // aliases (never client display aliases), exactly like creation.
    let allergenUpdate: Prisma.RecipeUpdateInput | undefined;
    const nextDietAllergen = {
      ingredients: ingredientsChanged
        ? rows.map((r) => r.canonicalName)
        : prevDietAllergen.ingredients,
      dietCategory: input.dietCategory ?? existing.dietCategory,
    };
    if (dietAllergenRecheckNeeded(prevDietAllergen, nextDietAllergen)) {
      allergenUpdate = allergenRescreenData(
        ingredientsChanged
          ? rows.flatMap(ingredientAllergenScreenNames)
          : storedRows.flatMap(storedRowAllergenScreenNames),
      );
    }

    // V21.5 (P3): re-check the vegetarian declaration when the ingredient
    // list or the diet category changes (a portions-only edit changes
    // nothing about what's in the recipe, so it doesn't re-screen).
    // Conflict → 400 naming the ingredient(s). Ambiguous free text →
    // needsReview forced true with a warning (never assumed vegetarian).
    let dietWarnings: string[] = [];
    if (ingredientsChanged || input.dietCategory !== undefined) {
      const effectiveDiet = input.dietCategory ?? existing.dietCategory;
      const dietCheck = checkRecipeDiet(toDietScreenRows(rows), effectiveDiet);
      if (!dietCheck.ok) {
        return apiError(
          'diet_conflict',
          dietConflictMessage(dietCheck.conflicts, effectiveDiet),
          400,
        );
      }
      if (dietCheck.ambiguous.length) {
        dietWarnings = [dietAmbiguityWarning(dietCheck.ambiguous)];
        nutritionWarnings.push(...dietWarnings);
        patchNeedsReview = true;
      }
    }

    const updateData: Prisma.RecipeUpdateInput = {
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
      ...(allergenUpdate ?? {}),
      ...invalidationData,
    };
    // V21.5 (P4): the new contentHash over the MERGED post-write content
    // (resolved rows, merged servings/dietCategory/yieldGrams, the
    // rescreened allergen list when the recheck ran) — stored in the SAME
    // atomic update, so hash and content can never diverge.
    // V21.6: the snapshot is built by buildContentSnapshot (@fitfusion/core,
    // single source of truth) — the resolved rows carry foodId/canonicalName
    // identity, so the hash now distinguishes same-named ingredients.
    updateData.contentHash = computeRecipeContentHash(
      buildContentSnapshot({
        ingredients: rows,
        servings,
        dietCategory: input.dietCategory ?? existing.dietCategory,
        yieldGrams:
          input.yieldGrams !== undefined
            ? input.yieldGrams
            : existing.yieldGrams,
        tags: existing.tags ?? [],
        allergens:
          (updateData.allergens as string[] | undefined) ??
          existing.allergens ??
          [],
      }),
    );

    const recipe = await guardedUpdate(updateData);
    if (!recipe) return staleRecipeError();
    // v21.4: never return the raw Prisma record — strip the evidence
    // columns (an admin-reviewed private recipe would otherwise leak the
    // reviewer's email to its owner).
    return apiOk({
      recipe: serializeRecipePublic(recipe, isAdmin(s)),
      nutritionWarnings,
      nutritionIncomplete: patchNeedsReview ?? existing.needsReview,
      // v21.5 (P3): vegetarian-declaration ambiguity warnings.
      dietWarnings,
    });
  }

  // V21.5 (P1): diet-category-only change (metadata branch) — re-screen
  // against the STORED ingredient names (no re-resolve needed), in the same
  // atomic update. Non-material edits (prepMin etc.) leave
  // allergens/allergenScreened untouched.
  let metadataAllergenUpdate: Prisma.RecipeUpdateInput | undefined;
  if (
    input.dietCategory !== undefined &&
    dietAllergenRecheckNeeded(prevDietAllergen, {
      ingredients: prevDietAllergen.ingredients,
      dietCategory: input.dietCategory,
    })
  ) {
    metadataAllergenUpdate = allergenRescreenData(
      storedRows.flatMap(storedRowAllergenScreenNames),
    );
  }

  // V21.5 (P3): a dietCategory-only change re-checks the vegetarian
  // declaration against the STORED rows. v21.5+ rows carry canonicalName /
  // foodCategoryName / rowSource in the stored JSON; older rows screen on
  // the display name with no trusted source (conservative).
  // Conflict → 400 naming the ingredient(s). Ambiguous free text →
  // needsReview forced true with a warning.
  let metadataDietWarnings: string[] = [];
  if (input.dietCategory !== undefined) {
    const dietCheck = checkRecipeDiet(
      toDietScreenRows(storedRows),
      input.dietCategory,
    );
    if (!dietCheck.ok) {
      return apiError(
        'diet_conflict',
        dietConflictMessage(dietCheck.conflicts, input.dietCategory),
        400,
      );
    }
    if (dietCheck.ambiguous.length) {
      metadataDietWarnings = [dietAmbiguityWarning(dietCheck.ambiguous)];
    }
  }

  const metadataUpdateData: Prisma.RecipeUpdateInput = {
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
      ...(metadataAllergenUpdate ?? {}),
      // v21.5 (P3): ambiguous vegetarian-declaration ingredients keep the
      // recipe under review.
      ...(metadataDietWarnings.length ? { needsReview: true } : {}),
      ...invalidationData,
  };
  // V21.5 (P4): recompute the contentHash over the merged content in the
  // SAME atomic update. Metadata-only edits (name, times, instructions)
  // recompute the IDENTICAL hash — evidence survives. Any content change
  // (including a rescreened allergen list) moves it.
  // V21.6: the snapshot is built from the STORED rows by buildContentSnapshot
  // (@fitfusion/core, single source of truth), identity included.
  metadataUpdateData.contentHash = computeRecipeContentHash(
    buildContentSnapshot({
      ingredients: existing.ingredients,
      servings: existing.servings,
      dietCategory: input.dietCategory ?? existing.dietCategory,
      yieldGrams:
        input.yieldGrams !== undefined
          ? input.yieldGrams
          : existing.yieldGrams,
      tags: existing.tags ?? [],
      allergens:
        (metadataUpdateData.allergens as string[] | undefined) ??
        existing.allergens ??
        [],
    }),
  );

  const recipe = await guardedUpdate(metadataUpdateData);
  if (!recipe) return staleRecipeError();
  // v21.4: never return the raw Prisma record — strip the evidence columns.
  // v21.5 (P3): vegetarian-declaration ambiguity warnings.
  return apiOk({
    recipe: serializeRecipePublic(recipe, isAdmin(s)),
    dietWarnings: metadataDietWarnings,
  });
}
