/**
 * Recipe claims policy tests (v21.2 P8) — PURE (no database).
 *
 * These tests verify the ACTUAL governance policy, not the old inference
 * rules:
 *  - 'halal-friendly' requires a recorded human review; pork-absence alone
 *    never grants it (the old inference is asserted dead).
 *  - allergen data is name-derived unless a human review is recorded, and the
 *    caveat must be shown wherever it is name-derived.
 *  - 'verified' requires the evidence in VERIFIED_STANDARD_EVIDENCE; a bare
 *    flag with no evidence is not a stronger claim.
 *  - seed.ts is read as TEXT (it executes on import) to assert the 31
 *    original recipes no longer claim verified: true.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLERGEN_CAVEAT,
  VERIFIED_STANDARD_EVIDENCE,
  allergenCaveat,
  halalPolicyViolations,
  mayClaimHalalFriendly,
  meetsVerifiedStandard,
  qualityTier,
} from './recipe-claims-policy.js';
import { PAKISTANI_RECIPES } from './seed-recipes-pakistani.js';
import { INDIAN_MET_RECIPES } from './seed-recipes-indian-met.js';
import { ASIAN_RECIPES } from './seed-recipes-asian.js';
import { WESTERN_RECIPES } from './seed-recipes-western.js';

const ALL_BATCHES = [
  ...PAKISTANI_RECIPES,
  ...INDIAN_MET_RECIPES,
  ...ASIAN_RECIPES,
  ...WESTERN_RECIPES,
];

describe('halal claim policy', () => {
  it('pork-free but unreviewed does NOT get halal-friendly', () => {
    const porkFreeUnreviewed = {
      tags: ['gluten-free', 'dairy-free', 'high-protein'],
      // no halalReview recorded
    };
    expect(mayClaimHalalFriendly(porkFreeUnreviewed)).toBe(false);
  });

  it('explicit human review grants halal-friendly', () => {
    expect(
      mayClaimHalalFriendly({
        tags: ['halal-friendly', 'high-protein'],
        halalReview: { reviewer: 'A. Reviewer', reviewedAt: '2026-10-13' },
      }),
    ).toBe(true);
  });

  it('tag without a review record does not count as a claim', () => {
    expect(mayClaimHalalFriendly({ tags: ['halal-friendly'] })).toBe(false);
  });

  it('review record without the tag does not conjure the tag', () => {
    expect(
      mayClaimHalalFriendly({
        tags: ['high-protein'],
        halalReview: { reviewer: 'A. Reviewer', reviewedAt: '2026-10-13' },
      }),
    ).toBe(false);
  });

  it('blank reviewer identity does not count as a review', () => {
    expect(
      mayClaimHalalFriendly({
        tags: ['halal-friendly'],
        halalReview: { reviewer: '   ', reviewedAt: '2026-10-13' },
      }),
    ).toBe(false);
  });

  it('THE OLD INFERENCE IS DEAD: pork-absence must not imply the tag', () => {
    // The old rule, spelled out so this test fails if it ever returns:
    const oldInference = (ingredientNames: string[]): boolean => {
      const PORK = ['pork', 'bacon', 'ham', 'pepperoni', 'lard'];
      return !ingredientNames.some((n) =>
        PORK.some((p) => n.toLowerCase().includes(p)),
      );
    };
    // A genuinely pork-free recipe under the OLD rule would get the tag…
    const names = ['Chicken breast', 'Tomatoes', 'Onion', 'Olive oil'];
    expect(oldInference(names)).toBe(true);
    // …but under the new policy it must NOT, without a recorded review.
    expect(mayClaimHalalFriendly({ tags: [], halalReview: undefined })).toBe(
      false,
    );
    // And no seed recipe may carry the tag without a review record.
    expect(halalPolicyViolations(ALL_BATCHES)).toEqual([]);
  });

  it('no batch recipe carries halal-friendly / halal without a recorded review', () => {
    for (const r of ALL_BATCHES) {
      expect(r.tags.includes('halal-friendly'), `${r.slug} halal-friendly`).toBe(
        false,
      );
      expect(r.tags.includes('halal'), `${r.slug} halal`).toBe(false);
      expect(r.halalReview ?? null, `${r.slug} halalReview`).toBeNull();
    }
  });
});

describe('allergen provenance policy', () => {
  it('name-derived data requires the caveat; reviewed data does not', () => {
    expect(allergenCaveat(undefined)).toBe(ALLERGEN_CAVEAT);
    expect(allergenCaveat('declared-from-ingredient-names')).toBe(
      ALLERGEN_CAVEAT,
    );
    expect(allergenCaveat('human-reviewed')).toBeNull();
  });

  it('the caveat makes no safety promise', () => {
    expect(ALLERGEN_CAVEAT).toMatch(/not a certified allergen analysis/i);
    expect(ALLERGEN_CAVEAT).toMatch(/cross-contamination/i);
    expect(ALLERGEN_CAVEAT).not.toMatch(/safe/i);
  });

  it('every seed recipe is name-derived, so every one needs the caveat', () => {
    for (const r of ALL_BATCHES) {
      const basis = r.allergenBasis ?? 'declared-from-ingredient-names';
      expect(basis).toBe('declared-from-ingredient-names');
      expect(allergenCaveat(r.allergenBasis)).toBe(ALLERGEN_CAVEAT);
    }
  });
});

describe('verification standard', () => {
  it('documents what evidence the verified label requires', () => {
    expect(VERIFIED_STANDARD_EVIDENCE.length).toBeGreaterThanOrEqual(4);
    const joined = VERIFIED_STANDARD_EVIDENCE.join(' ').toLowerCase();
    expect(joined).toMatch(/independent/);
    expect(joined).toMatch(/reviewer/);
    expect(joined).toMatch(/date/);
    expect(joined).toMatch(/allergen/);
  });

  it('incomplete evidence does not meet the standard', () => {
    expect(meetsVerifiedStandard(undefined)).toBe(false);
    expect(meetsVerifiedStandard(null)).toBe(false);
    expect(
      meetsVerifiedStandard({
        checkedBy: '',
        checkedAt: '2026-10-13',
        method: 'recomputed',
        allergenAndDietRechecked: true,
      }),
    ).toBe(false);
    expect(
      meetsVerifiedStandard({
        checkedBy: 'A. Reviewer',
        checkedAt: '2026-10-13',
        method: 'recomputed',
        allergenAndDietRechecked: false,
      }),
    ).toBe(false);
  });

  it('complete evidence meets the standard', () => {
    expect(
      meetsVerifiedStandard({
        checkedBy: 'A. Reviewer',
        checkedAt: '2026-10-13',
        method: 'independent recomputation against USDA SR values',
        allergenAndDietRechecked: true,
      }),
    ).toBe(true);
  });
});

describe('data-quality tiers', () => {
  it('verified requires flag AND evidence — a bare flag is not enough', () => {
    expect(
      qualityTier({ verified: true, verificationEvidence: undefined }),
    ).toBe('calculated-estimate');
    expect(
      qualityTier({
        verified: true,
        verificationEvidence: {
          checkedBy: 'A. Reviewer',
          checkedAt: '2026-10-13',
          method: 'independent recomputation',
          allergenAndDietRechecked: true,
        },
      }),
    ).toBe('verified');
  });

  it('human review without verification evidence tiers as reviewed (v21.3 ReviewRecord)', () => {
    expect(
      qualityTier({
        verified: false,
        reviewEvidence: {
          reviewer: 'A. Reviewer',
          reviewedAt: '2026-10-14',
          method: 'independent recomputation',
          reference: 'USDA SR Legacy #170923',
          dietaryRechecked: true,
          allergenRechecked: true,
        },
      }),
    ).toBe('reviewed');
  });

  it('defaults to calculated-estimate', () => {
    expect(qualityTier({ verified: false })).toBe('calculated-estimate');
  });

  it('every seed batch recipe is calculated-estimate (none reviewed, none verified)', () => {
    for (const r of ALL_BATCHES) {
      // Seed data carries no verification evidence and no human review
      // records, so the tier is always the honest default.
      expect(qualityTier({ verified: false }), r.slug).toBe(
        'calculated-estimate',
      );
    }
    expect(ALL_BATCHES.length).toBe(239);
  });

  it('no seed batch recipe carries review/verification evidence keys (v21.3 seed safety)', () => {
    for (const r of ALL_BATCHES) {
      const rec = r as unknown as Record<string, unknown>;
      expect(rec.reviewEvidence ?? null, r.slug).toBeNull();
      expect(rec.verificationEvidence ?? null, r.slug).toBeNull();
    }
  });
});

describe('31 original recipes: verified demotion (seed.ts as text)', () => {
  const seedSrc = readFileSync(resolve(process.cwd(), 'prisma/seed.ts'), 'utf8');

  function recipesLoopSrc(): string {
    const start = seedSrc.indexOf('for (const r of RECIPES)');
    expect(start).toBeGreaterThanOrEqual(0);
    // The RECIPES loop ends where the next top-level seed loop begins.
    const end = seedSrc.indexOf('for (const e of EXERCISES)', start);
    expect(end).toBeGreaterThan(start);
    return seedSrc.slice(start, end);
  }

  it('the RECIPES upsert no longer claims verified: true', () => {
    // P8 verdict: the 31 originals have hand-written nutrition with no
    // recorded verification evidence, so the flag was demoted to false.
    // (Starter FOODS elsewhere in seed.ts are out of scope for this test.)
    expect(recipesLoopSrc()).not.toMatch(/verified:\s*true/);
    expect(recipesLoopSrc()).toMatch(/verified:\s*false/);
  });

  it('no original recipe carries an unevidenced halal tag', () => {
    const recBlock = seedSrc.slice(
      seedSrc.indexOf('const RECIPES'),
      seedSrc.indexOf('for (const r of RECIPES)'),
    );
    expect(recBlock).not.toMatch(/'halal-friendly'/);
    expect(recBlock).not.toMatch(/'halal'/);
  });

  it('the RECIPES upsert never writes review/verification evidence (v21.3 seed safety)', () => {
    // The 31 originals stay demoted (verified:false) AND unevidenced: no
    // seed row may gain reviewed/verified status via the seed.
    expect(recipesLoopSrc()).not.toMatch(/reviewEvidence/);
    expect(recipesLoopSrc()).not.toMatch(/verificationEvidence/);
  });
});
