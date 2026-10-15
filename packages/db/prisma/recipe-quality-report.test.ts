/**
 * Recipe data-quality reconciliation test (v21.3, Worker C).
 *
 * `recipe-quality-report.ts` is the single source of truth for the published
 * counts. This test runs the report against the ACTUAL seed modules and
 * asserts the numbers the docs claim, so the docs cannot drift from the
 * seed data again (the 92-vs-95 incident: a grep count of "needsReview: true"
 * picked up 3 header-comment prose mentions and reported 95 instead of 92).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXPECTED_COUNTS, buildQualityReport } from './recipe-quality-report.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

function readDoc(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

describe('recipe-quality-report', () => {
  it('reports the real counts from the seed modules', () => {
    const r = buildQualityReport();
    expect(r.totalRecipes).toBe(EXPECTED_COUNTS.totalRecipes);
    expect(r.batchRecipes).toBe(EXPECTED_COUNTS.batchRecipes);
    expect(r.originalRecipes).toBe(EXPECTED_COUNTS.originalRecipes);
    expect(r.needsReviewTotal).toBe(EXPECTED_COUNTS.needsReviewTotal);
    expect(r.reviewed).toBe(EXPECTED_COUNTS.reviewed);
    expect(r.verified).toBe(EXPECTED_COUNTS.verified);
    const byBatch = Object.fromEntries(r.batches.map((b) => [b.batch, b.needsReview]));
    expect(byBatch).toEqual(EXPECTED_COUNTS.needsReviewByBatch);
    expect(r.ingredients.total).toBe(EXPECTED_COUNTS.ingredientTotal);
    expect(r.ingredients.usdaStandardReference).toBe(EXPECTED_COUNTS.ingredientUsdaStandardReference);
    expect(r.ingredients.standardEstimate).toBe(EXPECTED_COUNTS.ingredientStandardEstimate);
    expect(r.ingredients.withSource).toBe(EXPECTED_COUNTS.ingredientTotal);
    expect(r.ingredients.withSourceRef).toBe(EXPECTED_COUNTS.ingredientWithSourceRef);
    expect(r.ingredients.withLastReviewedAt).toBe(EXPECTED_COUNTS.ingredientWithLastReviewedAt);
  });

  it('docs/recipe-data-quality.md claims the same numbers', () => {
    const doc = readDoc('docs/recipe-data-quality.md');
    // needsReview 92 with the exact per-batch breakdown.
    expect(doc).toMatch(/\*\*92 carry/);
    expect(doc).toMatch(/16 Pakistani/);
    expect(doc).toMatch(/4 Indian\/Middle-Eastern\/Turkish/);
    expect(doc).toMatch(/40 Asian/);
    expect(doc).toMatch(/32 Western/);
    // 270 recipes, 0 reviewed, 0 verified.
    expect(doc).toMatch(/\*\*270 recipes/);
    expect(doc).toMatch(/\*\*0 reviewed\*\*/);
    expect(doc).toMatch(/\*\*0 verified\*\*/);
    // Ingredient DB: 182 entries, 173 USDA / 9 estimate, 0 sourceRefs.
    expect(doc).toContain('182 entries');
    expect(doc).toContain('173');
    expect(doc).toMatch(/9\b.*standard-estimate/);
    expect(doc).toContain('**0 captured.**');
    // No stale "95 needsReview" claim may remain.
    expect(doc).not.toMatch(/95 needsReview/);
  });

  it('FEATURE_STATUS.md claims the same numbers', () => {
    const doc = readDoc('FEATURE_STATUS.md');
    expect(doc).toMatch(/0 reviewed \/ 0 verified \/ 92 needsReview/);
    expect(doc).not.toMatch(/95 needsReview/);
    expect(doc).toContain('173 USDA standard-reference basis');
  });

  it('docs/HANDOVER.md claims the same numbers', () => {
    const doc = readDoc('docs/HANDOVER.md');
    expect(doc).toMatch(/92 seed recipes/);
    expect(doc).not.toMatch(/95 seed recipes/);
  });
});

describe('recipe-quality-report internal consistency (Worker D)', () => {
  it('status counts are bounded by the total', () => {
    const r = buildQualityReport();
    expect(r.needsReviewTotal).toBeLessThanOrEqual(r.totalRecipes);
    expect(r.reviewed + r.verified).toBeLessThanOrEqual(r.totalRecipes);
  });

  it('batch breakdowns sum to the totals', () => {
    const r = buildQualityReport();
    const batchRecipes = r.batches.reduce((n, b) => n + b.recipes, 0);
    const batchNeedsReview = r.batches.reduce((n, b) => n + b.needsReview, 0);
    expect(batchRecipes).toBe(r.batchRecipes);
    expect(batchNeedsReview).toBe(r.needsReviewTotal);
    expect(r.batchRecipes + r.originalRecipes).toBe(r.totalRecipes);
  });

  it('ingredient basis counts partition the ingredient total', () => {
    const r = buildQualityReport();
    expect(r.ingredients.usdaStandardReference + r.ingredients.standardEstimate).toBe(
      r.ingredients.total,
    );
  });

  it('provenance counters are bounded by the ingredient total', () => {
    const r = buildQualityReport();
    expect(r.ingredients.withSource).toBeLessThanOrEqual(r.ingredients.total);
    expect(r.ingredients.withSourceRef).toBeLessThanOrEqual(r.ingredients.total);
    expect(r.ingredients.withLastReviewedAt).toBeLessThanOrEqual(r.ingredients.total);
  });

  it('to-taste entries are non-negative and counted per batch', () => {
    const r = buildQualityReport();
    expect(r.toTasteEntries).toBeGreaterThanOrEqual(0);
    const fromBatches = r.batches.reduce((n, b) => n + b.toTasteEntries, 0);
    expect(fromBatches).toBe(r.toTasteEntries);
  });
});
