/**
 * Recipe data-quality tier badges (v21.3).
 *
 * SINGLE SOURCE OF TRUTH: `packages/core/src/recipe-claims.ts` (`qualityTier`,
 * `meetsVerifiedStandard`, `meetsReviewedStandard`, `VERIFIED_STANDARD_EVIDENCE`,
 * `ALLERGEN_CAVEAT`). This module is the thin client-side presentation layer
 * consumed by the recipe list/detail pages — badge label + tone only.
 *
 * The recipes API is the tier authority: GET /api/recipes and
 * GET /api/recipes/[slug] compute the canonical `tier` server-side from the
 * FULL stored evidence and return it in the response (alongside display
 * summaries `reviewInfo`/`verificationInfo`; full evidence objects go to
 * admins only). `recipeQualityTier()` therefore prefers the server-computed
 * `tier` when present and falls back to the canonical `qualityTier()` on
 * evidence for responses that predate it. It never contains its own tier
 * logic — a bare `verified: true` with no evidence still tiers as
 * 'calculated-estimate' here, exactly as the policy requires. The one
 * exception is the v21.8 (P4) needsReview guard: a recipe awaiting review
 * is capped at 'calculated-estimate' even when the server claims a higher
 * tier (defense in depth against stale/cached responses) — the same
 * fail-closed rule the canonical `qualityTier()` applies.
 *
 * Badge spec: `docs/recipe-data-quality.md` §1.
 */

import {
  qualityTier,
  type QualityTier,
  type ReviewRecord,
  type VerificationEvidence,
} from '@fitfusion/core';

export type { QualityTier };

export interface TierBadgeInfo {
  label: string;
  /** Subset of the LuxBadge tones (apps/web/components/luxury.tsx). */
  tone: 'success' | 'accent' | 'neutral' | 'warning';
}

/** What the API returns per recipe for badge purposes (v21.3). */
export interface RecipeTierInput {
  /** Server-computed canonical tier — preferred when present. */
  tier?: QualityTier | null;
  verified?: boolean | null;
  /** Full evidence (admin responses) — the canonical policy needs it. */
  verificationEvidence?: VerificationEvidence | null;
  reviewEvidence?: ReviewRecord | null;
  /**
   * v21.8 (P4): when true, the badge NEVER renders above
   * 'calculated-estimate' — even if a stale/cached server response claims
   * `tier: 'verified'`. The server is the tier authority and no longer
   * emits that combination; this is defense in depth so the UI can never
   * show contradictory "Verified" + "Awaiting review" labels.
   */
  needsReview?: boolean | null;
}

export function recipeQualityTier(r: RecipeTierInput): QualityTier {
  // v21.8 (P4): fail closed at the presentation layer — a recipe awaiting
  // review never renders an elevated badge, whatever the server said.
  // This demotes; it never promotes: the canonical rule is identical to
  // qualityTier()'s, applied here so version-skewed/cached responses
  // cannot produce a "Verified" badge next to an "Awaiting review" one.
  if (r.needsReview === true) return 'calculated-estimate';
  if (r.tier === 'verified' || r.tier === 'reviewed' || r.tier === 'calculated-estimate') {
    return r.tier;
  }
  return qualityTier({
    verified: Boolean(r.verified),
    verificationEvidence: r.verificationEvidence ?? null,
    reviewEvidence: r.reviewEvidence ?? null,
  });
}

/** Badge spec (docs/recipe-data-quality.md §1): label + tone per tier. */
export function tierBadge(tier: QualityTier): TierBadgeInfo {
  switch (tier) {
    case 'verified':
      return { label: 'Verified', tone: 'success' };
    case 'reviewed':
      return { label: 'Reviewed', tone: 'accent' };
    case 'calculated-estimate':
      return { label: 'Calculated estimate', tone: 'neutral' };
  }
}

/** "Awaiting review" marker for recipes with needsReview = true. */
export const AWAITING_REVIEW_BADGE: TierBadgeInfo = {
  label: 'Awaiting review',
  tone: 'warning',
};

/**
 * Canonical allergen caveat — copied VERBATIM from `ALLERGEN_CAVEAT` in
 * `packages/core/src/recipe-claims.ts`. The recipe allergen lists are
 * name-derived screening (never human-reviewed), so this must be shown
 * wherever recipe allergen info appears. If the canonical text changes,
 * update both copies.
 */
export const ALLERGEN_CAVEAT =
  'Allergen information is declared from the recipe\u2019s ingredient names only. ' +
  'It is not a certified allergen analysis: unlisted sub-ingredients, shared cooking ' +
  'equipment, and cross-contamination are not assessed. If you have a food allergy, ' +
  'verify every ingredient yourself before cooking.';
