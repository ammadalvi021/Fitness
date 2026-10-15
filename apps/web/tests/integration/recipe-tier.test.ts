/**
 * Recipe badge policy — end-to-end through the web wrapper (v21.3, Worker D).
 *
 * The canonical policy lives in `packages/core/src/recipe-claims.ts`
 * (`qualityTier`, `meetsVerifiedStandard`, `meetsReviewedStandard`) and is
 * pinned there. THIS file pins the web presentation wrapper
 * (`@/lib/recipe-tier.ts`), which is the only other place a badge decision
 * can be made:
 *  - a bare `verified: true` with null/partial evidence still tiers as
 *    'calculated-estimate' through the wrapper — the wrapper adds NO new
 *    logic and never promotes an unevidenced flag;
 *  - the 'reviewed' tier needs a COMPLETE ReviewRecord; blank-string
 *    evidence fields are rejected (trimmed, not truthy-checked);
 *  - the server-computed `tier` is preferred when present (the recipes API
 *    is the tier authority — it computes the canonical tier from the FULL
 *    stored evidence), and anything else falls back to the canonical
 *    evidence computation.
 *
 * Pure — no database.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLERGEN_CAVEAT,
  AWAITING_REVIEW_BADGE,
  recipeQualityTier,
  tierBadge,
} from '@/lib/recipe-tier';
import {
  ALLERGEN_CAVEAT as CORE_ALLERGEN_CAVEAT,
  type ReviewRecord,
  type VerificationEvidence,
} from '@fitfusion/core';

const BLANK_CHECKED_BY: VerificationEvidence = {
  checkedBy: '   ',
  checkedAt: '2026-10-14',
  method: 'independent recomputation',
  allergenAndDietRechecked: true,
};

const COMPLETE_VERIFICATION: VerificationEvidence = {
  checkedBy: 'admin@example.com',
  checkedAt: '2026-10-14',
  method: 'independent recomputation',
  allergenAndDietRechecked: true,
};

const COMPLETE_REVIEW: ReviewRecord = {
  reviewer: 'admin@example.com',
  reviewedAt: '2026-10-14',
  method: 'label cross-check',
  reference: 'USDA SR Legacy #170923',
  dietaryRechecked: true,
  allergenRechecked: true,
};

describe('recipeQualityTier — badge policy through the wrapper', () => {
  it('bare verified:true with null/partial evidence → calculated-estimate', () => {
    expect(recipeQualityTier({ verified: true })).toBe('calculated-estimate');
    expect(
      recipeQualityTier({ verified: true, verificationEvidence: null }),
    ).toBe('calculated-estimate');
    expect(
      recipeQualityTier({ verified: true, verificationEvidence: undefined }),
    ).toBe('calculated-estimate');
  });

  it('evidence with blank strings is rejected (trimmed, not truthy-checked)', () => {
    expect(
      recipeQualityTier({
        verified: true,
        verificationEvidence: BLANK_CHECKED_BY,
      }),
    ).toBe('calculated-estimate');
    expect(
      recipeQualityTier({
        verified: false,
        reviewEvidence: { ...COMPLETE_REVIEW, reviewer: '   ' },
      }),
    ).toBe('calculated-estimate');
    expect(
      recipeQualityTier({
        verified: false,
        reviewEvidence: { ...COMPLETE_REVIEW, reference: '' },
      }),
    ).toBe('calculated-estimate');
  });

  it('unparseable dates are rejected', () => {
    expect(
      recipeQualityTier({
        verified: true,
        verificationEvidence: { ...COMPLETE_VERIFICATION, checkedAt: 'yesterday-ish' },
      }),
    ).toBe('calculated-estimate');
    expect(
      recipeQualityTier({
        verified: false,
        reviewEvidence: { ...COMPLETE_REVIEW, reviewedAt: 'soon' },
      }),
    ).toBe('calculated-estimate');
  });

  it('flag + complete evidence → verified; complete review record → reviewed', () => {
    expect(
      recipeQualityTier({
        verified: true,
        verificationEvidence: COMPLETE_VERIFICATION,
      }),
    ).toBe('verified');
    expect(
      recipeQualityTier({ verified: false, reviewEvidence: COMPLETE_REVIEW }),
    ).toBe('reviewed');
  });

  it('reviewed tier requires BOTH recheck flags — one false fails', () => {
    expect(
      recipeQualityTier({
        verified: false,
        reviewEvidence: { ...COMPLETE_REVIEW, allergenRechecked: false },
      }),
    ).toBe('calculated-estimate');
  });
});

describe('recipeQualityTier — server tier is preferred (API is the authority)', () => {
  it('a server-computed tier wins over local evidence state', () => {
    // The server computed these canonically from the FULL stored evidence;
    // the wrapper must not second-guess them.
    expect(recipeQualityTier({ tier: 'verified' })).toBe('verified');
    expect(recipeQualityTier({ tier: 'reviewed' })).toBe('reviewed');
    expect(
      recipeQualityTier({ tier: 'calculated-estimate', verified: true }),
    ).toBe('calculated-estimate');
  });

  it('an unrecognized tier value falls back to the evidence computation', () => {
    expect(
      recipeQualityTier({
        tier: 'gold-star' as unknown as 'verified',
        verified: true,
      }),
    ).toBe('calculated-estimate');
    expect(
      recipeQualityTier({
        tier: null,
        verified: true,
        verificationEvidence: COMPLETE_VERIFICATION,
      }),
    ).toBe('verified');
  });
});

describe('tierBadge — badge spec', () => {
  it('labels and tones are pinned per tier', () => {
    expect(tierBadge('verified')).toEqual({ label: 'Verified', tone: 'success' });
    expect(tierBadge('reviewed')).toEqual({ label: 'Reviewed', tone: 'accent' });
    expect(tierBadge('calculated-estimate')).toEqual({
      label: 'Calculated estimate',
      tone: 'neutral',
    });
  });

  it('the "Awaiting review" marker is the warning badge', () => {
    expect(AWAITING_REVIEW_BADGE).toEqual({
      label: 'Awaiting review',
      tone: 'warning',
    });
  });

  it('the allergen caveat copy is verbatim the canonical core text', () => {
    expect(ALLERGEN_CAVEAT).toBe(CORE_ALLERGEN_CAVEAT);
  });
});
