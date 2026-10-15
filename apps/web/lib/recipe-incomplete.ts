/**
 * Admin review screen — incomplete-nutrition status helper (v21.4).
 *
 * PURE helper (no DOM, no network) consumed by two surfaces:
 *  - the admin review API GET /api/admin/recipes/[slug]/review, which
 *    returns `needsReview` + `unresolvedIngredients` so the panel can show
 *    WHY verification is blocked;
 *  - the AdminRecipeReview client panel, which renders the warning block.
 *
 * Canonical policy (packages/core/src/recipe-governance.ts): a recipe with
 * `needsReview === true` can NEVER be verified. The admin API rejects the
 * verify action with 400; this helper shapes the display data.
 */
import { unresolvedIngredientNames } from '@fitfusion/core';

export interface IncompleteRecipeInput {
  needsReview?: boolean | null;
  ingredients?: unknown;
}

export interface IncompleteStatus {
  /** True when the recipe's nutrition is incomplete. */
  needsReview: boolean;
  /** Names of ingredient rows whose nutrition contributed 0 (may be empty
   *  for older rows that carry no per-row status — the flag still blocks). */
  unresolvedIngredients: string[];
  /** True when the Verify action must be refused for this recipe. */
  verificationBlocked: boolean;
}

function asRows(v: unknown): Array<{ name: string; nutritionStatus?: string | null }> {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is { name: string; nutritionStatus?: string | null } =>
      typeof r === 'object' && r !== null && typeof (r as { name?: unknown }).name === 'string',
  );
}

/** Shape a recipe's incomplete-nutrition status for the admin review UI. */
export function incompleteStatusForAdmin(
  recipe: IncompleteRecipeInput,
): IncompleteStatus {
  const needsReview = recipe.needsReview === true;
  const unresolvedIngredients = unresolvedIngredientNames(asRows(recipe.ingredients));
  return {
    needsReview,
    unresolvedIngredients,
    verificationBlocked: needsReview,
  };
}
