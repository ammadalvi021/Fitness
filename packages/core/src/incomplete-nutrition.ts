/**
 * FitFusion AI — incomplete-nutrition protection (v21.3).
 *
 * PURE helpers (no DOM, no network) for the "partial nutrition" UX guards.
 * Partial recipe nutrition must never flow SILENTLY into diary or meal-plan
 * totals:
 *
 * - `requiresAcknowledgement(needsReview)` — true when the recipe's totals
 *   are partial. The `needsReview` flag is the signal: no flag, no guard,
 *   so complete recipes are unaffected.
 * - `blocksMealPlanAddition(needsReview)` — meal-plan additions are BLOCKED
 *   (not merely acknowledged). Plan additions feed auto-totals across days
 *   where partial numbers disappear into daily targets with no per-view
 *   flag — the more dangerous surface, so it gets the stronger guard.
 * - `unresolvedIngredientNames(rows)` — names of the ingredient rows whose
 *   nutrition contributed 0 (status 'unknown' | 'incomplete'), for the
 *   honest "partial — excludes: X, Y" copy.
 * - `partialTotalsSummary(names)` — copy-safe summary of the partial
 *   totals. NEVER calls partial totals "complete" or "an estimate"; the
 *   exact wording is pinned by tests.
 */

export type IngredientRowStatus = 'ok' | 'unknown' | 'incomplete';

export interface IngredientRowStatusLike {
  name: string;
  /**
   * Resolution status stored alongside each resolved ingredient row
   * ('ok' when fully resolved; 'unknown' | 'incomplete' contribute 0).
   * Absent/null = not tracked per-row (older seed rows) — such rows are
   * NOT treated as unresolved; the needsReview flag carries the signal.
   */
  nutritionStatus?: string | null;
}

/**
 * True when this ingredient row's nutrition contributed 0 to the recipe
 * totals (nutrition unknown, or serving weight un-convertible).
 */
export function isUnresolvedRow(row: IngredientRowStatusLike): boolean {
  return row.nutritionStatus === 'unknown' || row.nutritionStatus === 'incomplete';
}

/**
 * Names of the ingredient rows whose nutrition contributed 0, in order.
 * Blank names are skipped. Rows without a tracked status are NOT included —
 * the exclusion copy then falls back to the generic "unknown nutrition"
 * wording via `partialTotalsSummary([])`.
 */
export function unresolvedIngredientNames(
  rows: readonly IngredientRowStatusLike[],
): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (isUnresolvedRow(row) && row.name.trim().length > 0) {
      names.push(row.name.trim());
    }
  }
  return names;
}

/**
 * True when an explicit acknowledgement is required BEFORE this recipe's
 * nutrition flows into diary totals. The `needsReview` flag is the signal —
 * complete recipes (`false` / absent / null) need no acknowledgement.
 */
export function requiresAcknowledgement(needsReview?: boolean | null): boolean {
  return needsReview === true;
}

/**
 * True when adding this recipe to a meal plan must be BLOCKED (not merely
 * acknowledged). Decision (v21.3): a meal-plan addition silently folds
 * partial numbers into the plan's auto-totals across days, with no
 * per-view flag on the plans page — so the stronger guard applies there.
 * Complete the nutrition review first.
 */
export function blocksMealPlanAddition(needsReview?: boolean | null): boolean {
  return needsReview === true;
}

/** Max ingredient names named inline before "and N more". */
export const MAX_NAMED_UNRESOLVED = 5;

/**
 * Copy-safe summary of the partial totals. The wording contract:
 * - always starts with "partial — excludes:" so the values are never
 *   presented as complete;
 * - never uses the words "complete" or "estimate";
 * - names the unresolved ingredients when known, otherwise the generic
 *   "ingredients with unknown nutrition".
 */
export function partialTotalsSummary(unresolvedNames: readonly string[]): string {
  if (unresolvedNames.length === 0) {
    return 'partial — excludes: ingredients with unknown nutrition';
  }
  const shown = unresolvedNames.slice(0, MAX_NAMED_UNRESOLVED);
  const rest = unresolvedNames.length - shown.length;
  return `partial — excludes: ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}
