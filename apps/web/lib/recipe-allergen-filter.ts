/**
 * FitFusion AI — conservative allergen exclusion for the recipes browse API
 * (v21.8 P3).
 *
 * PURE (no DB I/O): builds the Prisma where-clause for `excludeAllergen`
 * and documents the fail-closed semantics. Shared by
 * `apps/web/app/api/recipes/route.ts`. Unit-testable without a database.
 *
 * SEMANTICS (conservative / fail closed):
 * - Exclusion terms resolve to canonical allergen-family labels via
 *   `resolveAllergenExclusionTerms` (@fitfusion/core): synonyms and
 *   canonical family names ('dairy' → 'milk', 'gluten' → 'wheat',
 *   'peanut' → 'peanuts', 'tree nut' → 'tree nuts', …) are honored, so a
 *   user-typed term can never silently miss the stored family label.
 *   Unmapped terms pass through unchanged — the NOT clause still applies
 *   to the raw stored label, so a user's exclusion request is never
 *   silently dropped.
 * - The clause ALSO requires `allergenScreened: true`. A recipe whose
 *   allergen list was never screened is EXCLUDED from filtered results —
 *   it can never be presented as though it satisfied the exclusion
 *   request. An unscreened recipe with an empty `allergens` list is NOT
 *   "allergen-free"; the clause treats it as unknown, never as safe.
 * - Screening is name-derived only (see ALLERGEN_CAVEAT in
 *   @fitfusion/core): never an allergy-safety guarantee. The recipe
 *   detail page shows the caveat wherever allergen info appears.
 *
 * Design choice (documented): unscreened recipes are EXCLUDED from
 * filtered results rather than returned in a separate "unknown
 * screening" section, because the API returns a single flat paginated
 * list and the browse UI renders one results grid — a separate section
 * would need a new response shape and a second paginated stream.
 * Exclusion is the fail-closed option: nothing unscreened can be
 * mistaken for an eligible result.
 */
import type { Prisma } from '@fitfusion/db';
import { resolveAllergenExclusionTerms } from '@fitfusion/core';

/**
 * Build the Prisma where-clause for an allergen exclusion, or null when
 * no exclusion terms were given (no filtering at all — the unfiltered
 * browse list keeps showing unscreened recipes with their honest
 * "screening not performed" labeling on the detail page).
 */
export function buildAllergenExclusionWhere(
  excludeAllergen: readonly (string | null | undefined)[],
): Prisma.RecipeWhereInput | null {
  const terms = resolveAllergenExclusionTerms(excludeAllergen);
  if (terms.length === 0) return null;
  return {
    // Fail closed: unscreened recipes can never satisfy an exclusion.
    allergenScreened: true,
    NOT: { allergens: { hasSome: terms } },
  };
}

/**
 * Pure matcher expressing the SAME semantics as
 * `buildAllergenExclusionWhere`, for tests and documentation: a recipe is
 * ELIGIBLE under an exclusion iff it was allergen-screened AND its stored
 * allergen list contains none of the resolved exclusion terms. Anything
 * unscreened — even with an empty or stale list — is ineligible.
 * (Mirrors Prisma: `allergenScreened: true` equality + exact
 * `allergens hasSome` element match on canonical family labels.)
 */
export function recipeEligibleUnderAllergenExclusion(
  recipe: {
    allergenScreened: boolean | null | undefined;
    allergens: readonly (string | null | undefined)[];
  },
  excludeAllergen: readonly (string | null | undefined)[],
): boolean {
  const terms = resolveAllergenExclusionTerms(excludeAllergen);
  if (terms.length === 0) return true;
  if (recipe.allergenScreened !== true) return false;
  const have = new Set(
    recipe.allergens
      .map((a) => (a ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  return !terms.some((t) => have.has(t));
}
