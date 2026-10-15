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
 * 'calculated-estimate' here, exactly as the policy requires.
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
}

export function recipeQualityTier(r: RecipeTierInput): QualityTier {
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
