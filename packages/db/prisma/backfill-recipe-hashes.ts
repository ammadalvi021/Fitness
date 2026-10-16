// FitFusion AI — backfill script for Recipe.contentHash (v21.6).
//
// Fills `contentHash` for recipes that predate content-hash tracking
// (the v21.5 migration added the nullable column without a backfill).
// The hash is computed with the EXACT canonicalization the app uses —
// `buildContentSnapshot` + `computeRecipeContentHash` imported from
// @fitfusion/core, never a copy.
//
// IDEMPOTENT: only rows with `contentHash: null` are touched, and each
// write is conditional (`updateMany` on { id, contentHash: null }), so a
// concurrent PATCH that sets a fresh hash is never clobbered. Re-running
// after a complete backfill scans zero rows and writes zero rows.
//
// TRUTHFUL EXIT (v21.7): the script exits NON-ZERO whenever rows remain
// unprocessed (skipped + failed > 0) — a 0 exit with unprocessed rows would
// silently claim the backfill is done. The final message says complete /
// PARTIAL (with --allow-partial) / FAILED / INCOMPLETE. Skipped rows are
// reported, never hashed or fabricated to make the counts pass; a repeat
// run re-scans them.
//
// Run from packages/db:
//   DATABASE_URL=... npm run db:backfill-hashes -- --dry-run
//   DATABASE_URL=... npm run db:backfill-hashes -- --batch-size 200
// Run from the repo root (workspaces):
//   npm run db:backfill-hashes --workspace @fitfusion/db -- --dry-run
// Flags: --dry-run (compute + report, no writes), --batch-size N (default
// 100), --allow-partial (exit 0 even when rows remain unprocessed —
// without it the exit code is non-zero and the final message says so).
//
// DO NOT run against production without the owner's explicit go-ahead.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildContentSnapshot,
  computeRecipeContentHash,
} from '@fitfusion/core';
import { prisma } from '@fitfusion/db';

// --- tiny .env loader (no new dependencies; same convention as seed.ts) ---
// Loads ../../../.env (repo root) for keys not already in process.env.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '..', '..', '.env');
  if (existsSync(envPath)) {
    for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
}

interface HashableRecipeRow {
  id: string;
  slug: string;
  ingredients: unknown;
  servings: unknown;
  dietCategory: unknown;
  yieldGrams?: unknown;
  tags?: unknown;
  allergens?: unknown;
}

export interface BackfillSkip {
  id: string;
  slug: string;
  reason: string;
}

export interface BackfillFailure {
  id: string;
  slug: string;
  error: string;
}

/**
 * The exact per-record code path the backfill (and nothing else) uses:
 * build the canonical snapshot from the STORED record, hash it. Throws
 * nothing — unparseable rows are reported by the caller as skipped.
 *
 * Exported so the logic can be exercised against real seed modules without
 * a database (see the v21.6 verification notes).
 */
export function hashRecipeRecord(row: HashableRecipeRow): string | null {
  if (!Array.isArray(row.ingredients)) return null;
  return computeRecipeContentHash(
    buildContentSnapshot({
      ingredients: row.ingredients,
      servings: row.servings,
      dietCategory: row.dietCategory,
      yieldGrams: row.yieldGrams ?? null,
      tags: row.tags ?? [],
      allergens: row.allergens ?? [],
    }),
  );
}

interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  /** Exit 0 even when rows remain unprocessed (default: non-zero exit). */
  allowPartial: boolean;
}

function parseArgs(argv: string[]): BackfillOptions {
  let dryRun = false;
  let batchSize = 100;
  let allowPartial = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--allow-partial') allowPartial = true;
    else if (a === '--batch-size') {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        throw new Error('--batch-size must be an integer between 1 and 1000');
      }
      batchSize = n;
      i++;
    } else {
      throw new Error(
        `unknown argument: ${a} (supported: --dry-run, --batch-size N, --allow-partial)`,
      );
    }
  }
  return { dryRun, batchSize, allowPartial };
}

export interface BackfillReport {
  scanned: number;
  written: number;
  wouldWrite: number;
  skipped: BackfillSkip[];
  raced: string[];
  failed: BackfillFailure[];
}

/**
 * Rows the backfill left unprocessed: skipped + failed. `raced` rows are
 * NOT unprocessed — a concurrent write already set a fresh hash for them,
 * and a repeat run never scans them (they no longer match
 * contentHash = null).
 */
export function backfillUnprocessedCount(
  report: Pick<BackfillReport, 'skipped' | 'failed'>,
): number {
  return report.skipped.length + report.failed.length;
}

/**
 * Exit code for a finished backfill report. Non-zero whenever rows remain
 * unprocessed — a 0 exit with unprocessed rows would silently claim the
 * backfill is done — UNLESS the operator passed --allow-partial and
 * accepted the partial state explicitly. Skipped rows are NEVER hashed or
 * fabricated to make the exit code pass; they are re-scanned on the next
 * run.
 */
export function backfillExitCode(
  report: Pick<BackfillReport, 'skipped' | 'failed'>,
  opts: Pick<BackfillOptions, 'allowPartial'>,
): number {
  return backfillUnprocessedCount(report) > 0 && !opts.allowPartial ? 1 : 0;
}

/**
 * Truthful one-line final status. Always names the state: complete,
 * PARTIAL (only when --allow-partial was given), FAILED, or INCOMPLETE
 * (unprocessed rows without the flag).
 */
export function backfillFinalMessage(
  report: Pick<BackfillReport, 'skipped' | 'failed'>,
  opts: Pick<BackfillOptions, 'allowPartial'>,
): string {
  const unprocessed = backfillUnprocessedCount(report);
  if (unprocessed === 0) {
    return 'backfill complete — no rows remain unprocessed.';
  }
  const detail = `skipped: ${report.skipped.length}, failed: ${report.failed.length}`;
  if (opts.allowPartial) {
    return (
      `backfill PARTIAL (--allow-partial accepted): ${unprocessed} row(s) left unprocessed ` +
      `(${detail}). A repeat run will retry them; nothing was fabricated.`
    );
  }
  if (report.failed.length > 0) {
    return `backfill FAILED for ${report.failed.length} row(s) (${detail}).`;
  }
  return (
    `backfill INCOMPLETE: ${unprocessed} row(s) left unprocessed (${detail}). ` +
    'Re-run with --allow-partial to accept this state explicitly.'
  );
}

async function main(): Promise<void> {
  let opts: BackfillOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const report: BackfillReport = {
    scanned: 0,
    written: 0,
    wouldWrite: 0,
    skipped: [],
    raced: [],
    failed: [],
  };

  console.log(
    `backfill-recipe-hashes: ${opts.dryRun ? 'DRY RUN (no writes)' : 'LIVE'} — ` +
      `batch size ${opts.batchSize}, targeting recipes with contentHash = null`,
  );

  // Cursor pagination over { contentHash: null }. The cursor (not offset)
  // keeps dry runs finite: dry-run rows are never "consumed" by a write,
  // so offset pagination would loop forever.
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.recipe.findMany({
      where: { contentHash: null },
      select: {
        id: true,
        slug: true,
        ingredients: true,
        servings: true,
        dietCategory: true,
        yieldGrams: true,
        tags: true,
        allergens: true,
      },
      orderBy: { id: 'asc' },
      take: opts.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      report.scanned += 1;
      let hash: string | null;
      try {
        hash = hashRecipeRecord(row);
      } catch (err) {
        // Defensive: hashRecipeRecord is total, but a row must never kill
        // the whole backfill — record it and move on.
        report.failed.push({
          id: row.id,
          slug: row.slug,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (hash === null) {
        report.skipped.push({
          id: row.id,
          slug: row.slug,
          reason: 'ingredients is not an array — nothing trustworthy to hash',
        });
        continue;
      }
      if (opts.dryRun) {
        report.wouldWrite += 1;
        continue;
      }
      try {
        // Conditional write: lands only if the row STILL has
        // contentHash = null — a concurrent PATCH that set a fresh hash
        // wins the race and is never clobbered.
        // v21.7: the backfill writes contentHash ONLY. The revision token
        // (recipe-governance.ts §5b) is a mutation counter owned by the
        // guarded write paths (PATCH, review/verify/clear) — a hash-only
        // backfill is NOT a recipe or review-state mutation, so it must
        // never reset, bump, or otherwise touch `revision` here.
        const res = await prisma.recipe.updateMany({
          where: { id: row.id, contentHash: null },
          data: { contentHash: hash },
        });
        if (res.count === 1) report.written += 1;
        else report.raced.push(row.id);
      } catch (err) {
        report.failed.push({
          id: row.id,
          slug: row.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < opts.batchSize) break;
  }

  console.log('--- backfill report ---');
  console.log(JSON.stringify(
    {
      scanned: report.scanned,
      written: report.written,
      wouldWrite: report.wouldWrite,
      skipped: report.skipped,
      raced: report.raced,
      failed: report.failed,
    },
    null,
    2,
  ));

  await prisma.$disconnect();

  // Truthful exit (v21.7): non-zero whenever rows remain unprocessed,
  // unless --allow-partial was passed. The final message always names the
  // state honestly — never "complete" when rows were left behind.
  const exitCode = backfillExitCode(report, opts);
  const finalMessage = backfillFinalMessage(report, opts);
  if (exitCode === 0) {
    console.log(finalMessage);
  } else {
    console.error(finalMessage);
    process.exit(exitCode);
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
