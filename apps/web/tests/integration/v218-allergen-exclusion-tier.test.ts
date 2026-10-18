/**
 * v21.8 — P3 conservative allergen filtering + P4 incomplete-nutrition
 * tier policy.
 *
 * Pure suite (no database):
 *
 * P3 — when `excludeAllergen` is specified, the browse query must never
 * present an unscreened recipe as though it satisfied the exclusion:
 *  - buildAllergenExclusionWhere: clause shape pins
 *    `allergenScreened: true` + canonicalized NOT-hasSome terms;
 *  - recipeEligibleUnderAllergenExclusion: the same semantics against a
 *    fixture — screened+matching excluded, screened+clean included,
 *    unscreened (empty OR stale list) never presented as safe;
 *  - allergy synonyms / canonical family names resolve
 *    ('dairy'→'milk', 'gluten'→'wheat', 'tree-nut'→'tree nuts').
 *
 * P4 — `needsReview: true` never yields a Verified (or Reviewed) tier,
 * consistently at every layer:
 *  - the public serializer (serializeRecipePublic/shapeRecipeEvidence)
 *    and the canonical qualityTier() agree;
 *  - the presentation wrapper (recipeQualityTier) fails closed even for
 *    a stale/cached server response claiming tier:'verified', so the UI
 *    can never show contradictory "Verified" + "Awaiting review" labels.
 *
 * Route-level application of the clause (real Prisma) is covered by the
 * DB-backed browse suite when PostgreSQL is reachable; the clause shape
 * pinned here is exactly what the route pushes into its AND list.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAllergenExclusionWhere,
  recipeEligibleUnderAllergenExclusion,
} from '@/lib/recipe-allergen-filter';
import { shapeRecipeEvidence, serializeRecipePublic } from '@/lib/recipe-evidence';
import {
  recipeQualityTier,
  tierBadge,
  AWAITING_REVIEW_BADGE,
} from '@/lib/recipe-tier';
import type { ReviewRecord, VerificationEvidence } from '@fitfusion/core';

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

/* ------------------------------------------------------------------ */
/* P3: where-clause shape                                              */
/* ------------------------------------------------------------------ */

describe('buildAllergenExclusionWhere (v21.8 P3)', () => {
  it('returns null when no exclusion terms are given', () => {
    expect(buildAllergenExclusionWhere([])).toBeNull();
    expect(buildAllergenExclusionWhere(['', '   '])).toBeNull();
  });

  it('requires allergenScreened:true AND excludes matching labels (fail closed)', () => {
    expect(buildAllergenExclusionWhere(['milk'])).toEqual({
      allergenScreened: true,
      NOT: { allergens: { hasSome: ['milk'] } },
    });
  });

  it('resolves allergy synonyms and canonical family names', () => {
    expect(buildAllergenExclusionWhere(['dairy'])).toEqual({
      allergenScreened: true,
      NOT: { allergens: { hasSome: ['milk'] } },
    });
    expect(buildAllergenExclusionWhere(['tree-nut', 'Gluten'])).toEqual({
      allergenScreened: true,
      NOT: { allergens: { hasSome: ['tree nuts', 'wheat'] } },
    });
    expect(buildAllergenExclusionWhere(['peanut'])).toEqual({
      allergenScreened: true,
      NOT: { allergens: { hasSome: ['peanuts'] } },
    });
  });
});

/* ------------------------------------------------------------------ */
/* P3: exclusion semantics against a fixture                           */
/* ------------------------------------------------------------------ */

const SCREENED_WITH_MILK = {
  allergenScreened: true,
  allergens: ['milk', 'wheat'],
};
const SCREENED_CLEAN = { allergenScreened: true, allergens: [] };
const SCREENED_OTHER = { allergenScreened: true, allergens: ['eggs'] };
const UNSCREENED_EMPTY = { allergenScreened: false, allergens: [] };
const UNSCREENED_STALE = { allergenScreened: false, allergens: ['milk'] };
const UNSCREENED_UNKNOWN = { allergenScreened: null, allergens: [] };

describe('allergen exclusion semantics (v21.8 P3)', () => {
  it('screened recipe containing the requested allergen → excluded', () => {
    expect(recipeEligibleUnderAllergenExclusion(SCREENED_WITH_MILK, ['milk'])).toBe(false);
  });

  it('screened recipe WITHOUT the requested allergen → included', () => {
    expect(recipeEligibleUnderAllergenExclusion(SCREENED_CLEAN, ['milk'])).toBe(true);
    expect(recipeEligibleUnderAllergenExclusion(SCREENED_OTHER, ['milk'])).toBe(true);
  });

  it('unscreened recipe with EMPTY allergen list → NOT presented as safe', () => {
    // An empty list on an unscreened recipe is "never screened", not
    // "allergen-free" — it must not satisfy the exclusion request.
    expect(recipeEligibleUnderAllergenExclusion(UNSCREENED_EMPTY, ['milk'])).toBe(false);
  });

  it('unscreened recipe with STALE allergen data → NOT presented as safe', () => {
    expect(recipeEligibleUnderAllergenExclusion(UNSCREENED_STALE, ['milk'])).toBe(false);
    // …and the stale list must not rescue it under a different exclusion
    // either: unscreened is ineligible, full stop.
    expect(recipeEligibleUnderAllergenExclusion(UNSCREENED_STALE, ['peanuts'])).toBe(false);
  });

  it('unknown screening state (null) → NOT presented as safe', () => {
    expect(recipeEligibleUnderAllergenExclusion(UNSCREENED_UNKNOWN, ['milk'])).toBe(false);
  });

  it('synonym exclusions apply to screened recipes', () => {
    // 'dairy' resolves to the stored 'milk' family label.
    expect(recipeEligibleUnderAllergenExclusion(SCREENED_WITH_MILK, ['dairy'])).toBe(false);
    expect(recipeEligibleUnderAllergenExclusion(SCREENED_CLEAN, ['dairy'])).toBe(true);
    // 'gluten' resolves to the stored 'wheat' family label.
    expect(recipeEligibleUnderAllergenExclusion(SCREENED_WITH_MILK, ['gluten'])).toBe(false);
    expect(recipeEligibleUnderAllergenExclusion(SCREENED_OTHER, ['gluten'])).toBe(true);
  });

  it('no exclusion requested → every recipe eligible (unfiltered browse unchanged)', () => {
    for (const r of [
      SCREENED_WITH_MILK,
      SCREENED_CLEAN,
      UNSCREENED_EMPTY,
      UNSCREENED_STALE,
    ]) {
      expect(recipeEligibleUnderAllergenExclusion(r, [])).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* P4: serializer agreement with the canonical tier rule              */
/* ------------------------------------------------------------------ */

function publicRow(overrides: Record<string, unknown>) {
  return {
    id: 'r1',
    slug: 'test-recipe',
    title: 'Test Recipe',
    verified: false,
    verificationEvidence: null,
    reviewEvidence: null,
    needsReview: false,
    ...overrides,
  };
}

describe('tier policy with needsReview (v21.8 P4) — serializer agreement', () => {
  it('public serializer: needsReview:true + complete verified evidence → calculated-estimate (never verified)', () => {
    const shaped = serializeRecipePublic(
      publicRow({
        verified: true,
        verificationEvidence: { ...COMPLETE_VERIFICATION },
        reviewEvidence: { ...COMPLETE_REVIEW },
        needsReview: true,
      }),
      false,
    );
    expect(shaped.tier).toBe('calculated-estimate');
  });

  it('public serializer: needsReview:true + complete review only → calculated-estimate (never reviewed)', () => {
    const shaped = shapeRecipeEvidence(
      {
        verified: false,
        verificationEvidence: null,
        reviewEvidence: { ...COMPLETE_REVIEW },
        needsReview: true,
      },
      false,
    );
    expect(shaped.tier).toBe('calculated-estimate');
  });

  it('public serializer: needsReview:false + complete evidence → verified (unchanged)', () => {
    const shaped = serializeRecipePublic(
      publicRow({
        verified: true,
        verificationEvidence: { ...COMPLETE_VERIFICATION },
        reviewEvidence: { ...COMPLETE_REVIEW },
        needsReview: false,
      }),
      false,
    );
    expect(shaped.tier).toBe('verified');
  });

  it('admin serializer sees the same tier (full evidence, needsReview:true)', () => {
    const shaped = shapeRecipeEvidence(
      {
        verified: true,
        verificationEvidence: { ...COMPLETE_VERIFICATION },
        reviewEvidence: { ...COMPLETE_REVIEW },
        needsReview: true,
      },
      true,
    );
    expect(shaped.tier).toBe('calculated-estimate');
    // …while the evidence itself is still visible to the admin for
    // resolution (fail closed on the badge, not on the data).
    expect(shaped.verificationEvidence).not.toBeNull();
    expect(shaped.reviewEvidence).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* P4: presentation wrapper never contradicts "Awaiting review"       */
/* ------------------------------------------------------------------ */

describe('recipeQualityTier needsReview guard (v21.8 P4)', () => {
  it('stale server tier "verified" + needsReview:true → calculated-estimate (no contradictory labels)', () => {
    const tier = recipeQualityTier({ tier: 'verified', needsReview: true });
    expect(tier).toBe('calculated-estimate');
    // The badge the UI would render next to the "Awaiting review" marker:
    expect(tierBadge(tier).label).not.toBe('Verified');
    expect(AWAITING_REVIEW_BADGE.label).toBe('Awaiting review');
  });

  it('server tier "reviewed" + needsReview:true → calculated-estimate', () => {
    expect(recipeQualityTier({ tier: 'reviewed', needsReview: true })).toBe(
      'calculated-estimate',
    );
  });

  it('server tier "verified" + needsReview:false → verified (authority respected)', () => {
    expect(recipeQualityTier({ tier: 'verified', needsReview: false })).toBe('verified');
    expect(recipeQualityTier({ tier: 'verified' })).toBe('verified');
  });

  it('evidence fallback with needsReview:true + complete evidence → calculated-estimate', () => {
    expect(
      recipeQualityTier({
        verified: true,
        verificationEvidence: { ...COMPLETE_VERIFICATION },
        reviewEvidence: { ...COMPLETE_REVIEW },
        needsReview: true,
      }),
    ).toBe('calculated-estimate');
  });

  it('evidence fallback without needsReview keeps prior behavior', () => {
    expect(
      recipeQualityTier({
        verified: true,
        verificationEvidence: { ...COMPLETE_VERIFICATION },
      }),
    ).toBe('verified');
    expect(
      recipeQualityTier({
        verified: false,
        reviewEvidence: { ...COMPLETE_REVIEW },
      }),
    ).toBe('reviewed');
  });
});
