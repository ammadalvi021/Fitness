/**
 * Recipe claims policy tests (v21.3) — PURE (no database).
 *
 * The canonical policy lives in ./recipe-claims.ts (moved here from
 * packages/db/prisma/recipe-claims-policy.ts). These tests pin the
 * governance behavior:
 *  - a bare `verified: true` flag with no evidence is NOT a stronger claim
 *    (tiers as 'calculated-estimate');
 *  - 'verified' requires the flag AND complete VerificationEvidence;
 *  - 'reviewed' requires a complete ReviewRecord (all fields, both recheck
 *    flags true) — no `humanReviewed` boolean shortcut;
 *  - reviewer identity, dates, methods, and reference are validated
 *    server-side; clients cannot forge partial evidence into a tier.
 */
import { describe, expect, it } from 'vitest';
import {
  REVIEW_DATE_MIN_ISO,
  REVIEW_METHODS,
  VERIFICATION_METHODS,
  VERIFIED_STANDARD_EVIDENCE,
  isReviewMethod,
  isStrictIsoDate,
  isVerificationMethod,
  meetsReviewedStandard,
  meetsVerifiedStandard,
  qualityTier,
  reviewDateInWindow,
  type ReviewRecord,
  type VerificationEvidence,
} from './recipe-claims.js';

const COMPLETE_VERIFICATION: VerificationEvidence = {
  checkedBy: 'admin@example.com',
  checkedAt: '2026-10-14',
  method: 'independent recomputation',
  allergenAndDietRechecked: true,
};

const COMPLETE_REVIEW: ReviewRecord = {
  reviewer: 'admin@example.com',
  reviewedAt: '2026-10-14',
  method: 'independent recomputation',
  reference: 'USDA SR Legacy #170923',
  dietaryRechecked: true,
  allergenRechecked: true,
};

describe('qualityTier — verified', () => {
  it('bare verified:true with NO evidence tiers as calculated-estimate', () => {
    expect(qualityTier({ verified: true })).toBe('calculated-estimate');
    expect(
      qualityTier({ verified: true, verificationEvidence: undefined }),
    ).toBe('calculated-estimate');
    expect(qualityTier({ verified: true, verificationEvidence: null })).toBe(
      'calculated-estimate',
    );
  });

  it('flag + complete evidence tiers as verified', () => {
    expect(
      qualityTier({
        verified: true,
        verificationEvidence: COMPLETE_VERIFICATION,
      }),
    ).toBe('verified');
  });

  it('flag + INCOMPLETE evidence stays calculated-estimate', () => {
    const incomplete: VerificationEvidence[] = [
      { ...COMPLETE_VERIFICATION, checkedBy: '' },
      { ...COMPLETE_VERIFICATION, checkedBy: '   ' },
      { ...COMPLETE_VERIFICATION, checkedAt: 'not-a-date' },
      { ...COMPLETE_VERIFICATION, method: '' },
      { ...COMPLETE_VERIFICATION, allergenAndDietRechecked: false },
    ];
    for (const evidence of incomplete) {
      expect(meetsVerifiedStandard(evidence)).toBe(false);
      expect(qualityTier({ verified: true, verificationEvidence: evidence })).toBe(
        'calculated-estimate',
      );
    }
  });
});

describe('qualityTier — reviewed (v21.3 ReviewRecord)', () => {
  it('complete review record tiers as reviewed', () => {
    expect(
      qualityTier({ verified: false, reviewEvidence: COMPLETE_REVIEW }),
    ).toBe('reviewed');
  });

  it('incomplete review record tiers as calculated-estimate (no boolean shortcut)', () => {
    const incomplete: ReviewRecord[] = [
      { ...COMPLETE_REVIEW, reviewer: '' },
      { ...COMPLETE_REVIEW, reviewer: '   ' },
      { ...COMPLETE_REVIEW, reviewedAt: '' },
      { ...COMPLETE_REVIEW, reviewedAt: 'yesterday-ish' },
      { ...COMPLETE_REVIEW, method: '' },
      { ...COMPLETE_REVIEW, reference: '' },
      { ...COMPLETE_REVIEW, dietaryRechecked: false },
      { ...COMPLETE_REVIEW, allergenRechecked: false },
    ];
    for (const record of incomplete) {
      expect(meetsReviewedStandard(record)).toBe(false);
      expect(qualityTier({ verified: false, reviewEvidence: record })).toBe(
        'calculated-estimate',
      );
    }
    expect(qualityTier({ verified: false, reviewEvidence: null })).toBe(
      'calculated-estimate',
    );
  });

  it('verified wins when both review and verification evidence are complete', () => {
    expect(
      qualityTier({
        verified: true,
        verificationEvidence: COMPLETE_VERIFICATION,
        reviewEvidence: COMPLETE_REVIEW,
      }),
    ).toBe('verified');
  });

  it('complete review + bare verified flag (no verification evidence) tiers as reviewed', () => {
    expect(
      qualityTier({ verified: true, reviewEvidence: COMPLETE_REVIEW }),
    ).toBe('reviewed');
  });

  it('review evidence alone can never produce verified', () => {
    expect(
      qualityTier({ verified: false, reviewEvidence: COMPLETE_REVIEW }),
    ).not.toBe('verified');
  });
});

describe('meetsReviewedStandard / meetsVerifiedStandard — forgery resistance', () => {
  it('rejects non-objects and partial objects', () => {
    expect(meetsReviewedStandard(null)).toBe(false);
    expect(meetsReviewedStandard(undefined)).toBe(false);
    expect(meetsVerifiedStandard(null)).toBe(false);
    expect(meetsVerifiedStandard(undefined)).toBe(false);
  });

  it('a client claiming reviewer identity cannot skip the recheck flags', () => {
    const forged: ReviewRecord = {
      ...COMPLETE_REVIEW,
      reviewer: 'mallory@example.com',
      dietaryRechecked: false,
      allergenRechecked: false,
    };
    expect(meetsReviewedStandard(forged)).toBe(false);
    expect(qualityTier({ verified: false, reviewEvidence: forged })).toBe(
      'calculated-estimate',
    );
  });

  it('VERIFIED_STANDARD_EVIDENCE lists the four requirements', () => {
    expect(VERIFIED_STANDARD_EVIDENCE.length).toBe(4);
  });

  it('REVIEW_METHODS exposes the documented method list', () => {
    expect([...REVIEW_METHODS]).toEqual([
      'independent recomputation',
      'label cross-check',
      'lab analysis',
      'other',
    ]);
  });

  it('VERIFICATION_METHODS is a controlled vocabulary next to REVIEW_METHODS', () => {
    expect([...VERIFICATION_METHODS]).toEqual([
      'independent recomputation',
      'authoritative source cross-check',
      'label cross-check',
      'lab analysis',
      'other',
    ]);
  });
});

describe('method vocabulary predicates (v21.4)', () => {
  it('isReviewMethod accepts each enum member (trimmed) and nothing else', () => {
    for (const m of REVIEW_METHODS) expect(isReviewMethod(m)).toBe(true);
    expect(isReviewMethod('  lab analysis  ')).toBe(true); // trimmed before check
    expect(isReviewMethod('')).toBe(false); // blank
    expect(isReviewMethod('   ')).toBe(false); // whitespace-only
    expect(isReviewMethod('eyeballing it')).toBe(false); // invented
    expect(isReviewMethod('independent recomputation' + 'x'.repeat(5000))).toBe(false); // oversized
    expect(isReviewMethod(null)).toBe(false);
    expect(isReviewMethod(undefined)).toBe(false);
    expect(isReviewMethod(42)).toBe(false);
  });

  it('isVerificationMethod accepts each enum member and rejects the rest', () => {
    for (const m of VERIFICATION_METHODS) expect(isVerificationMethod(m)).toBe(true);
    expect(isVerificationMethod('authoritative source cross-check')).toBe(true);
    expect(isVerificationMethod('')).toBe(false);
    expect(isVerificationMethod('trust me')).toBe(false);
    expect(isVerificationMethod('lab analysis' + 'y'.repeat(10000))).toBe(false);
    expect(isVerificationMethod(null)).toBe(false);
  });
});

describe('review/verification date window (v21.4)', () => {
  const TODAY = '2026-10-15';

  it('REVIEW_DATE_MIN_ISO documents the earliest permissible review date', () => {
    expect(REVIEW_DATE_MIN_ISO).toBe('2026-10-09');
  });

  it('isStrictIsoDate requires YYYY-MM-DD with a real calendar date', () => {
    expect(isStrictIsoDate('2026-10-14')).toBe(true);
    expect(isStrictIsoDate(' 2026-10-14 ')).toBe(true);
    expect(isStrictIsoDate('2026-10-14T00:00:00Z')).toBe(false); // not a plain date
    expect(isStrictIsoDate('Oct 14 2026')).toBe(false); // Date.parse accepts, we do not
    expect(isStrictIsoDate('10/14/2026')).toBe(false);
    expect(isStrictIsoDate('2026-02-30')).toBe(false); // impossible calendar date
    expect(isStrictIsoDate('2026-13-01')).toBe(false);
    expect(isStrictIsoDate('')).toBe(false);
    expect(isStrictIsoDate(null)).toBe(false);
  });

  it('reviewDateInWindow accepts in-window dates, rejects the rest', () => {
    expect(reviewDateInWindow('2026-10-09', TODAY)).toBe(true); // epoch boundary
    expect(reviewDateInWindow('2026-10-14', TODAY)).toBe(true);
    expect(reviewDateInWindow(TODAY, TODAY)).toBe(true); // today is allowed
    expect(reviewDateInWindow('2026-10-16', TODAY)).toBe(false); // future
    expect(reviewDateInWindow('2027-01-01', TODAY)).toBe(false); // future
    expect(reviewDateInWindow('2026-10-08', TODAY)).toBe(false); // before the app existed
    expect(reviewDateInWindow('2020-01-01', TODAY)).toBe(false); // long before
    expect(reviewDateInWindow('not a date', TODAY)).toBe(false);
    expect(reviewDateInWindow('', TODAY)).toBe(false);
    expect(reviewDateInWindow(null, TODAY)).toBe(false);
  });
});
