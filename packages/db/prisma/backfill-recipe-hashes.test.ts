/**
 * Backfill exit-code and reporting logic tests (v21.7) — PURE (no database).
 *
 * - The counting/reporting functions (backfillUnprocessedCount,
 *   backfillExitCode, backfillFinalMessage) are exercised with fabricated
 *   reports — no Prisma, no PostgreSQL.
 * - hashRecipeRecord is exercised against real stored-row shapes; the hash
 *   must equal the app's canonicalization (buildContentSnapshot +
 *   computeRecipeContentHash from @fitfusion/core) — the single shared
 *   code path, never a fork.
 * - A source-text guard asserts the script imports its canonicalization
 *   from @fitfusion/core and carries no second SHA-256 implementation.
 *
 * The dry-run-against-no-DB case is covered by running the script as a
 * child process with no DATABASE_URL: it must fail cleanly at the DB
 * boundary with a non-zero exit and no writes (verified manually in the
 * v21.7 run notes, not in this file — Prisma connect behavior is
 * environment-dependent).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildContentSnapshot,
  computeRecipeContentHash,
} from '@fitfusion/core';
import {
  backfillExitCode,
  backfillFinalMessage,
  backfillUnprocessedCount,
  hashRecipeRecord,
  type BackfillReport,
} from './backfill-recipe-hashes.js';

function report(overrides: Partial<BackfillReport> = {}): BackfillReport {
  return {
    scanned: 0,
    written: 0,
    wouldWrite: 0,
    skipped: [],
    raced: [],
    failed: [],
    ...overrides,
  };
}

describe('backfillUnprocessedCount', () => {
  it('counts skipped + failed; raced rows are NOT unprocessed', () => {
    expect(
      backfillUnprocessedCount(
        report({
          skipped: [{ id: 'a', slug: 'a', reason: 'r' }],
          failed: [{ id: 'b', slug: 'b', error: 'e' }],
          raced: ['c'],
        }),
      ),
    ).toBe(2);
  });
});

describe('backfillExitCode', () => {
  it('clean run → exit 0', () => {
    expect(
      backfillExitCode(report({ scanned: 10, written: 10 }), {
        allowPartial: false,
      }),
    ).toBe(0);
  });

  it('skipped rows → non-zero WITHOUT --allow-partial', () => {
    const r = report({
      skipped: [{ id: 's1', slug: 'x', reason: 'ingredients is not an array' }],
    });
    expect(backfillExitCode(r, { allowPartial: false })).not.toBe(0);
  });

  it('skipped rows → exit 0 WITH --allow-partial', () => {
    const r = report({
      skipped: [{ id: 's1', slug: 'x', reason: 'ingredients is not an array' }],
    });
    expect(backfillExitCode(r, { allowPartial: true })).toBe(0);
  });

  it('failed rows → non-zero WITHOUT --allow-partial', () => {
    const r = report({
      failed: [{ id: 'f1', slug: 'x', error: 'boom' }],
    });
    expect(backfillExitCode(r, { allowPartial: false })).not.toBe(0);
  });

  it('failed rows → exit 0 WITH --allow-partial', () => {
    const r = report({
      failed: [{ id: 'f1', slug: 'x', error: 'boom' }],
    });
    expect(backfillExitCode(r, { allowPartial: true })).toBe(0);
  });

  it('raced-only report → exit 0 (a concurrent write already set the hash)', () => {
    const r = report({ scanned: 1, raced: ['r1'] });
    expect(backfillExitCode(r, { allowPartial: false })).toBe(0);
  });

  it('skipped AND failed together → non-zero without the flag', () => {
    const r = report({
      skipped: [{ id: 's1', slug: 'x', reason: 'r' }],
      failed: [{ id: 'f1', slug: 'x', error: 'e' }],
    });
    expect(backfillExitCode(r, { allowPartial: false })).not.toBe(0);
    expect(backfillExitCode(r, { allowPartial: true })).toBe(0);
  });
});

describe('backfillFinalMessage — truthful final status', () => {
  it('clean run says complete', () => {
    const msg = backfillFinalMessage(report({ scanned: 5, written: 5 }), {
      allowPartial: false,
    });
    expect(msg).toMatch(/complete/i);
    expect(msg).not.toMatch(/partial|failed|incomplete/i);
  });

  it('skipped rows with --allow-partial say PARTIAL', () => {
    const msg = backfillFinalMessage(
      report({
        skipped: [{ id: 's1', slug: 'x', reason: 'r' }],
      }),
      { allowPartial: true },
    );
    expect(msg).toMatch(/partial/i);
    expect(msg).toContain('1 row(s)');
  });

  it('failed rows without the flag say FAILED', () => {
    const msg = backfillFinalMessage(
      report({ failed: [{ id: 'f1', slug: 'x', error: 'e' }] }),
      { allowPartial: false },
    );
    expect(msg).toMatch(/failed/i);
    expect(msg).not.toMatch(/complete\b/i);
  });

  it('skipped rows without the flag say INCOMPLETE (never "complete")', () => {
    const msg = backfillFinalMessage(
      report({
        skipped: [{ id: 's1', slug: 'x', reason: 'r' }],
      }),
      { allowPartial: false },
    );
    expect(msg).toMatch(/incomplete/i);
    expect(msg).not.toMatch(/^backfill complete/i);
    expect(msg).toMatch(/--allow-partial/);
  });
});

describe('hashRecipeRecord — shared canonicalization, no DB', () => {
  const goodRow = {
    id: 'r1',
    slug: 'chicken-karahi',
    ingredients: [
      { name: 'Chicken thigh (raw)', quantity: '800 g', grams: 800 },
      { name: 'Salt', quantity: '1 tsp', grams: 6 },
    ],
    servings: 4,
    dietCategory: 'non_vegetarian',
    yieldGrams: 1200,
    tags: [],
    allergens: [],
  };

  it('hashes a well-formed row deterministically (64-hex)', () => {
    const h1 = hashRecipeRecord(goodRow);
    const h2 = hashRecipeRecord(goodRow);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).toBe(h1);
  });

  it('uses the EXACT canonicalization the app uses — buildContentSnapshot + computeRecipeContentHash from @fitfusion/core', () => {
    const expected = computeRecipeContentHash(
      buildContentSnapshot({
        ingredients: goodRow.ingredients,
        servings: goodRow.servings,
        dietCategory: goodRow.dietCategory,
        yieldGrams: goodRow.yieldGrams,
        tags: goodRow.tags,
        allergens: goodRow.allergens,
      }),
    );
    expect(hashRecipeRecord(goodRow)).toBe(expected);
  });

  it('returns null (reported as skipped) when ingredients is not an array', () => {
    expect(hashRecipeRecord({ ...goodRow, ingredients: null })).toBeNull();
    expect(hashRecipeRecord({ ...goodRow, ingredients: 'garbage' })).toBeNull();
    expect(hashRecipeRecord({ ...goodRow, ingredients: { not: 'array' } })).toBeNull();
  });

  it('never fabricates: garbage rows inside the array still hash honestly, never throw', () => {
    const h = hashRecipeRecord({
      ...goodRow,
      ingredients: [null, 42, 'x', { name: '', grams: 1 }],
    });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not touch any revision field', () => {
    const withRevision = { ...goodRow, revision: 99 };
    expect(hashRecipeRecord(withRevision)).toBe(hashRecipeRecord(goodRow));
  });
});

describe('shared-canonicalization import guard', () => {
  it('imports the canonicalization from @fitfusion/core — no forked copy', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, 'backfill-recipe-hashes.ts'),
      'utf8',
    );
    expect(src).toContain(`} from '@fitfusion/core';`);
    expect(src).toContain('buildContentSnapshot');
    expect(src).toContain('computeRecipeContentHash');
    // No second SHA-256 implementation smuggled in (the v21.6 one in
    // recipe-governance.ts is identified by its first round constant).
    expect(src).not.toContain('0x428a2f98');
  });
});

describe('backfill never touches the revision token (v21.7 §5b)', () => {
  it('the conditional write sets contentHash ONLY — never revision (source-text guard)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, 'backfill-recipe-hashes.ts'),
      'utf8',
    );
    // The revision token is a mutation counter owned by the guarded write
    // paths (PATCH, review/verify/clear) — a hash-only backfill is NOT a
    // recipe or review-state mutation, so it must never reset, bump, or
    // otherwise write `revision`. The only updateMany in the script must
    // write contentHash and nothing else.
    const updateManyBlocks = src.match(/prisma\.recipe\.updateMany\(\{[\s\S]*?\}\);/g) ?? [];
    expect(updateManyBlocks.length).toBeGreaterThan(0);
    for (const block of updateManyBlocks) {
      expect(block).toContain('contentHash');
      expect(block).not.toContain('revision');
    }
  });
});
