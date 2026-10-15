/**
 * FitFusion AI — recipe review/verification governance (v21.4).
 *
 * CANONICAL HOME of the rules that keep recorded review/verification
 * evidence honest when recipe content changes. PURE DATA MODULE: no imports
 * from @prisma/client, no side effects. Both the recipe PATCH route
 * (apps/web/app/api/recipes/[slug]/route.ts) and the admin review route
 * (apps/web/app/api/admin/recipes/[slug]/review/route.ts) implement THIS
 * policy — they must never re-declare it.
 *
 * ---------------------------------------------------------------------------
 * 1. MATERIAL-CHANGE SET
 * ---------------------------------------------------------------------------
 *
 * A "material change" is any edit that can move the numbers or claims a
 * recorded review/verification was checked against:
 *
 *   MATERIAL (invalidates prior review AND verification evidence):
 *   - `ingredients` — added, removed, or quantity-changed rows. The review
 *     record's dietary/allergen rechecks were run against the OLD list, and
 *     the recorded per-serving nutrition no longer matches.
 *   - `portions` (servings) / `yieldGrams` — the yield. Per-serving values
 *     are totals divided by the yield, so a yield change re-bases every
 *     recorded number.
 *   - `dietCategory` — the vegetarian/non_vegetarian claim itself.
 *   - `tags` — material claims (e.g. 'high-protein', 'halal-friendly');
 *     the review's dietary recheck covered the old claim set.
 *   - `allergens` — allergen declarations; the review's allergen recheck
 *     covered the old list.
 *   - Nutrition VALUES (kcal/protein/carbs/fat/fiber per serving) — these
 *     are DERIVED from ingredients + portions, never edited directly, so an
 *     ingredient/yield change already covers them. They are listed here so
 *     a future direct-edit path cannot slip through: a direct nutrition
 *     edit is material by definition.
 *
 *   NOT material (metadata-only — review/verification survive):
 *   - `name`/`title`, `prepMin`, `cookMin`, `difficulty`, `instructions`,
 *     `imageUrl`, `videoUrl`, `mealType`, `cuisineId`. None of these touch
 *     the numbers or claims the evidence was checked against.
 *
 * DECISION (documented): a material change lapses the REVIEW as well as the
 * verification. A review is not a free-floating "someone looked at it" —
 * the review record certifies dietary/allergen rechecks against a specific
 * ingredient list and a method/reference tied to specific nutrition values.
 * Keeping a 'reviewed' tier on content the reviewer never saw would be the
 * same overreach the v21.3 evidence badges were built to prevent.
 *
 * ---------------------------------------------------------------------------
 * 2. VERIFICATION-OF-INCOMPLETE-NUTRITION POLICY
 * ---------------------------------------------------------------------------
 *
 * A recipe with `needsReview === true` (unresolved ingredients / incomplete
 * nutrition) can NEVER receive a Verified nutrition badge. The required path
 * is: resolve the missing nutritional values or serving info → recalculate
 * → re-review → then verify. `needsReview` is never cleared just to permit
 * verification.
 *
 * ---------------------------------------------------------------------------
 * 3. REVIEW-ON-VERIFIED POLICY
 * ---------------------------------------------------------------------------
 *
 * Recording a NEW review on an already-verified recipe resets the
 * verification (verified=false, verification evidence destroyed) UNLESS a
 * fresh verification is performed in the same explicitly supported
 * workflow. The supported atomic workflow is the admin 'verify' action with
 * `reviewEvidence` supplied in the same call (review saved first, then the
 * verification). A bare 'review' action never preserves a verification —
 * the old verification evidence was tied to the earlier review/content.
 */

import { unresolvedIngredientNames } from './incomplete-nutrition.js';

/**
 * Field names whose change invalidates prior review/verification evidence.
 * Mirrors the writable fields of CustomRecipePatchSchema plus the
 * claim-bearing fields an admin/edit path can touch.
 */
export const MATERIAL_RECIPE_FIELDS = [
  'ingredients',
  'portions',
  'yieldGrams',
  'dietCategory',
  'tags',
  'allergens',
  // Nutrition values are derived, never direct-edited; listed so a future
  // direct-edit path is material by construction.
  'kcalPerServing',
  'proteinPerServing',
  'carbsPerServing',
  'fatPerServing',
  'fiberPerServing',
] as const;

export type MaterialRecipeField = (typeof MATERIAL_RECIPE_FIELDS)[number];

/** Writable fields that never touch the numbers or claims evidence covers. */
export const NON_MATERIAL_RECIPE_FIELDS = [
  'name',
  'title',
  'prepMin',
  'cookMin',
  'difficulty',
  'instructions',
  'imageUrl',
  'videoUrl',
  'mealType',
  'cuisineId',
] as const;

function isMaterialField(f: string): f is MaterialRecipeField {
  return (MATERIAL_RECIPE_FIELDS as readonly string[]).includes(f);
}

/**
 * Which material fields a patch touches. `patchKeys` are the keys present
 * in the parsed patch body (presence = the field was edited). Returns the
 * material subset, in MATERIAL_RECIPE_FIELDS order.
 */
export function materialFieldsTouched(patchKeys: readonly string[]): MaterialRecipeField[] {
  const touched = new Set(patchKeys);
  return MATERIAL_RECIPE_FIELDS.filter((f) => touched.has(f));
}

export interface InvalidationDecision {
  /** True when the recipe's stored review evidence must be destroyed. */
  invalidateReview: boolean;
  /** True when verified must be reset and verification evidence destroyed. */
  invalidateVerification: boolean;
  /** Human-readable reason, recorded in logs/audit copy. */
  reason: string;
}

/**
 * The invalidation decision for an edit. ANY material field touched →
 * both the review and the verification lapse (see the module doc for why
 * the review lapses too). Metadata-only edits preserve everything.
 */
export function invalidationForEdit(
  patchKeys: readonly string[],
): InvalidationDecision {
  const material = materialFieldsTouched(patchKeys);
  if (material.length === 0) {
    return {
      invalidateReview: false,
      invalidateVerification: false,
      reason: 'metadata-only edit — review/verification evidence preserved',
    };
  }
  return {
    invalidateReview: true,
    invalidateVerification: true,
    reason:
      `material change (${material.join(', ')}) — prior review and ` +
      'verification evidence were checked against the previous content',
  };
}

/**
 * Canonical verify gate: a recipe whose nutrition is incomplete
 * (`needsReview === true`) can NEVER be verified. Returns false when
 * verification must be refused.
 */
export function mayVerifyNutrition(
  needsReview: boolean | null | undefined,
): boolean {
  return needsReview !== true;
}

export interface IngredientRowLike {
  name: string;
  nutritionStatus?: string | null;
}

/**
 * The 400 error message for a verification attempt on an incomplete recipe.
 * Names the unresolved ingredients when they are known; otherwise falls
 * back to the generic wording. Always states the required path — resolve,
 * recalculate, re-review, then verify — so an admin never clears
 * `needsReview` just to get past the gate.
 */
export function incompleteVerificationBlockMessage(
  unresolvedNames: readonly string[],
): string {
  const items =
    unresolvedNames.length > 0
      ? `unresolved ingredients: ${unresolvedNames.join(', ')}`
      : 'ingredients with unknown nutrition';
  return (
    `Cannot verify: recipe nutrition is incomplete (${items}). ` +
    'Required path: resolve the missing nutritional values or serving info, ' +
    'recalculate, re-review, then verify. Do not clear the needsReview flag ' +
    'to bypass this check.'
  );
}

/**
 * Convenience: build the block message straight from stored ingredient rows.
 * Rows are the resolved rows persisted on the recipe (each may carry a
 * `nutritionStatus` of 'ok' | 'unknown' | 'incomplete').
 */
export function incompleteVerificationBlockMessageForRows(
  rows: readonly IngredientRowLike[] | null | undefined,
): string {
  return incompleteVerificationBlockMessage(
    unresolvedIngredientNames(rows ?? []),
  );
}
