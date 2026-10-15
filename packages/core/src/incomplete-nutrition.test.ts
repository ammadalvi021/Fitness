/**
 * incomplete-nutrition.test.ts — v21.3 incomplete-nutrition protection.
 * Pure, no DB.
 */
import { describe, expect, it } from 'vitest';
import {
  blocksMealPlanAddition,
  isUnresolvedRow,
  partialTotalsSummary,
  requiresAcknowledgement,
  unresolvedIngredientNames,
} from './incomplete-nutrition.js';

describe('requiresAcknowledgement', () => {
  it('is required when needsReview is true', () => {
    expect(requiresAcknowledgement(true)).toBe(true);
  });
  it('is not required when needsReview is false', () => {
    expect(requiresAcknowledgement(false)).toBe(false);
  });
  it('is not required when the flag is absent or null (complete recipes unaffected)', () => {
    expect(requiresAcknowledgement(undefined)).toBe(false);
    expect(requiresAcknowledgement(null)).toBe(false);
  });
});

describe('blocksMealPlanAddition', () => {
  it('blocks when nutrition is partial (needsReview true)', () => {
    expect(blocksMealPlanAddition(true)).toBe(true);
  });
  it('does not block complete recipes', () => {
    expect(blocksMealPlanAddition(false)).toBe(false);
    expect(blocksMealPlanAddition(undefined)).toBe(false);
    expect(blocksMealPlanAddition(null)).toBe(false);
  });
});

describe('isUnresolvedRow', () => {
  it('flags unknown and incomplete rows as unresolved', () => {
    expect(isUnresolvedRow({ name: 'Fenugreek leaves', nutritionStatus: 'unknown' })).toBe(true);
    expect(isUnresolvedRow({ name: 'Milk', nutritionStatus: 'incomplete' })).toBe(true);
  });
  it('does not flag ok rows', () => {
    expect(isUnresolvedRow({ name: 'Rice', nutritionStatus: 'ok' })).toBe(false);
  });
  it('does not flag rows with no tracked status (older seed rows)', () => {
    expect(isUnresolvedRow({ name: 'Rice' })).toBe(false);
    expect(isUnresolvedRow({ name: 'Rice', nutritionStatus: null })).toBe(false);
  });
});

describe('unresolvedIngredientNames', () => {
  it('returns unresolved names in order', () => {
    const names = unresolvedIngredientNames([
      { name: 'Rice', nutritionStatus: 'ok' },
      { name: 'Fenugreek leaves', nutritionStatus: 'unknown' },
      { name: 'Milk', nutritionStatus: 'incomplete' },
      { name: 'Salt', nutritionStatus: 'ok' },
    ]);
    expect(names).toEqual(['Fenugreek leaves', 'Milk']);
  });
  it('ignores rows without a tracked status', () => {
    const names = unresolvedIngredientNames([
      { name: 'Rice' },
      { name: 'Oil', nutritionStatus: null },
    ]);
    expect(names).toEqual([]);
  });
  it('skips blank names', () => {
    const names = unresolvedIngredientNames([
      { name: '   ', nutritionStatus: 'unknown' },
      { name: 'Jaggery', nutritionStatus: 'unknown' },
    ]);
    expect(names).toEqual(['Jaggery']);
  });
  it('returns [] for no rows', () => {
    expect(unresolvedIngredientNames([])).toEqual([]);
  });
});

describe('partialTotalsSummary', () => {
  it('uses the generic fallback when no names are known', () => {
    expect(partialTotalsSummary([])).toBe(
      'partial — excludes: ingredients with unknown nutrition',
    );
  });
  it('names a single unresolved ingredient', () => {
    expect(partialTotalsSummary(['Fenugreek leaves'])).toBe(
      'partial — excludes: Fenugreek leaves',
    );
  });
  it('lists several unresolved ingredients', () => {
    expect(partialTotalsSummary(['A', 'B', 'C'])).toBe('partial — excludes: A, B, C');
  });
  it('truncates long lists with "and N more"', () => {
    expect(partialTotalsSummary(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe(
      'partial — excludes: A, B, C, D, E and 2 more',
    );
  });
  it('never describes partial totals as complete or an estimate', () => {
    for (const s of [
      partialTotalsSummary([]),
      partialTotalsSummary(['Fenugreek leaves']),
      partialTotalsSummary(['A', 'B', 'C', 'D', 'E', 'F']),
    ]) {
      expect(s.startsWith('partial — excludes:')).toBe(true);
      expect(s.toLowerCase()).not.toContain('complete');
      expect(s.toLowerCase()).not.toContain('estimate');
    }
  });
});

/**
 * Worker D regression: pin the EXACT banned phrases with word boundaries.
 * "as a standalone claim" matters — an ingredient *name* containing one of
 * these words (e.g. a product called "complete protein mix") is data and is
 * shown verbatim; the *summary wording itself* must never make the claim.
 */
describe('partialTotalsSummary — exact banned phrases', () => {
  const BANNED: { phrase: string; re: RegExp }[] = [
    'complete',
    'complete nutrition',
    'nutrition is complete',
    'an estimate',
    'estimated',
    'full nutrition',
    'fully calculated',
  ].map((phrase) => ({
    phrase,
    re: new RegExp(`\\b${phrase}\\b`, 'i'),
  }));

  const ORDINARY_OUTPUTS = [
    partialTotalsSummary([]),
    partialTotalsSummary(['Fenugreek leaves']),
    partialTotalsSummary(['A', 'B', 'C']),
    partialTotalsSummary(['A', 'B', 'C', 'D', 'E', 'F', 'G']),
  ];

  it.each(BANNED.map((b) => b.phrase))(
    'the phrase "%s" never appears as a standalone claim',
    (phrase) => {
      const re = new RegExp(`\\b${phrase}\\b`, 'i');
      for (const s of ORDINARY_OUTPUTS) {
        expect(s, `"${s}"`).not.toMatch(re);
      }
    },
  );

  it('ingredient names are shown verbatim even when they contain a banned word', () => {
    // The name is data, not our claim — sanitizing it would hide which
    // ingredient was excluded.
    expect(partialTotalsSummary(['complete protein mix'])).toBe(
      'partial — excludes: complete protein mix',
    );
  });
});
