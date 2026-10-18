/**
 * FitFusion AI — Recipe data-quality count reconciliation (v21.3, Worker C).
 *
 * PURE, NO DB: imports only seed data modules. `seed.ts` is read as TEXT
 * (never imported — it executes `main()` on import) to count the 31 original
 * recipes and confirm their seeded flags.
 *
 * This script is the SINGLE SOURCE OF TRUTH for the published data-quality
 * counts. `recipe-quality-report.test.ts` runs it and asserts the docs'
 * claimed numbers match, so the docs cannot drift from the seed data again.
 *
 * 92-vs-95 resolution (2026-10-14): an import-based recount gives exactly
 * 16 + 4 + 40 + 32 = 92. The "95" figure was a text-grep artifact:
 * `grep -c "needsReview: true"` across the batch files also matches the
 * header-contract prose in three of the four files (one mention each in
 * seed-recipes-pakistani.ts, seed-recipes-indian-met.ts,
 * seed-recipes-asian.ts), giving 17 + 5 + 41 + 32 = 95. Only the 92 are
 * real recipe flags.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAKISTANI_RECIPES } from './seed-recipes-pakistani.js';
import { INDIAN_MET_RECIPES } from './seed-recipes-indian-met.js';
import { ASIAN_RECIPES } from './seed-recipes-asian.js';
import { WESTERN_RECIPES } from './seed-recipes-western.js';
import { INGREDIENTS } from './seed-ingredients.js';

const here = dirname(fileURLToPath(import.meta.url));

export interface BatchReport {
  /** Short batch key, e.g. 'pakistani'. */
  batch: string;
  /** Number of recipes in the batch. */
  recipes: number;
  /** Recipes carrying needsReview: true. */
  needsReview: number;
  /** Ingredient entries with a 'to taste' quantity (estimated grams). */
  toTasteEntries: number;
}

export interface QualityReport {
  generatedAt: string;
  /** 239 v21 batch + 31 hand-authored originals. */
  totalRecipes: number;
  batchRecipes: number;
  originalRecipes: number;
  batches: BatchReport[];
  needsReviewTotal: number;
  /** Recipes with a recorded human review. None exist in seed data. */
  reviewed: number;
  /** Recipes meeting the verification evidence standard. None exist. */
  verified: number;
  ingredients: {
    total: number;
    usdaStandardReference: number;
    standardEstimate: number;
    /** Entries with `source` populated. */
    withSource: number;
    /** Entries with a captured `sourceRef`. Never invented. */
    withSourceRef: number;
    /** Entries with a recorded `lastReviewedAt`. Never backfilled. */
    withLastReviewedAt: number;
  };
  /** Total 'to taste' ingredient entries across all batch recipes. */
  toTasteEntries: number;
}

interface BatchLike {
  ingredients: { quantity: string }[];
  needsReview: boolean;
}

const BATCHES: { batch: string; recipes: BatchLike[] }[] = [
  { batch: 'pakistani', recipes: PAKISTANI_RECIPES },
  { batch: 'indian-met', recipes: INDIAN_MET_RECIPES },
  { batch: 'asian', recipes: ASIAN_RECIPES },
  { batch: 'western', recipes: WESTERN_RECIPES },
];

const TO_TASTE = /to taste/i;

/**
 * Count the original hand-authored recipes without importing seed.ts.
 * seed.ts executes main() on import; reading it as text keeps this pure.
 */
export function countOriginalRecipesFromSeedText(): { total: number; verifiedTrue: number; needsReviewSet: boolean } {
  const text = readFileSync(join(here, 'seed.ts'), 'utf8');
  // The RECIPES array is the hand-authored originals block: from
  // `const RECIPES` to its closing `];` (an EXERCISES array follows).
  const start = text.indexOf('const RECIPES');
  if (start < 0) throw new Error('seed.ts RECIPES block not found');
  const closeIdx = text.indexOf('\n];', start);
  if (closeIdx < 0) throw new Error('seed.ts RECIPES block end not found');
  const block = text.slice(start, closeIdx);
  const slugs = block.match(/slug:\s*'[^']+'/g) ?? [];
  // Check the upsert `data` object used for the 31 originals (the block
  // between the RECIPES upsert loop and the v21 batch section).
  const upsertStart = text.indexOf('for (const r of RECIPES)');
  const upsertEnd = text.indexOf('// V21: batch recipe modules', upsertStart);
  if (upsertStart < 0 || upsertEnd < 0) throw new Error('seed.ts RECIPES upsert block not found');
  const upsertBlock = text.slice(upsertStart, upsertEnd);
  const verifiedTrue = (upsertBlock.match(/verified:\s*true/g) ?? []).length;
  // V21.8: the originals' seed payload normalizes through
  // src/seed-safety.ts and may spell out `needsReview: false` explicitly —
  // that is identical to the schema default the report assumes. What must
  // never happen is seeding an original as needsReview: true.
  const needsReviewSet = /needsReview\s*:\s*true/.test(upsertBlock);
  return { total: slugs.length, verifiedTrue, needsReviewSet };
}

export function buildQualityReport(): QualityReport {
  const batches: BatchReport[] = BATCHES.map(({ batch, recipes }) => {
    let toTasteEntries = 0;
    for (const r of recipes) {
      for (const ing of r.ingredients) {
        if (TO_TASTE.test(ing.quantity)) toTasteEntries++;
      }
    }
    return {
      batch,
      recipes: recipes.length,
      needsReview: recipes.filter((r) => r.needsReview).length,
      toTasteEntries,
    };
  });

  const batchRecipes = batches.reduce((n, b) => n + b.recipes, 0);
  const { total: originalRecipes, verifiedTrue, needsReviewSet } = countOriginalRecipesFromSeedText();

  // The 31 originals are seeded with needsReview false (explicitly or via
  // the schema default) and verified: false (v21.2 P8 demotion). Any
  // deviation is a loud failure, not a silent one.
  if (verifiedTrue !== 0) throw new Error(`seed.ts sets verified: true on ${verifiedTrue} original recipes`);
  if (needsReviewSet) throw new Error('seed.ts sets needsReview on original recipes — report assumptions broken');

  const ings = INGREDIENTS;
  return {
    generatedAt: new Date().toISOString(),
    totalRecipes: batchRecipes + originalRecipes,
    batchRecipes,
    originalRecipes,
    batches,
    needsReviewTotal: batches.reduce((n, b) => n + b.needsReview, 0),
    reviewed: 0,
    verified: 0,
    ingredients: {
      total: ings.length,
      usdaStandardReference: ings.filter((i) => i.basis === 'USDA FoodData Central standard reference').length,
      standardEstimate: ings.filter((i) => i.basis === 'Standard reference estimate').length,
      withSource: ings.filter((i) => !!i.source).length,
      withSourceRef: ings.filter((i) => !!i.sourceRef).length,
      withLastReviewedAt: ings.filter((i) => !!i.lastReviewedAt).length,
    },
    toTasteEntries: batches.reduce((n, b) => n + b.toTasteEntries, 0),
  };
}

/** The published numbers the docs must agree with. The test enforces this. */
export const EXPECTED_COUNTS = {
  totalRecipes: 270,
  batchRecipes: 239,
  originalRecipes: 31,
  needsReviewTotal: 92,
  needsReviewByBatch: { pakistani: 16, 'indian-met': 4, asian: 40, western: 32 },
  reviewed: 0,
  verified: 0,
  ingredientTotal: 182,
  ingredientUsdaStandardReference: 173,
  ingredientStandardEstimate: 9,
  ingredientWithSourceRef: 0,
  ingredientWithLastReviewedAt: 0,
} as const;

function printReport(r: QualityReport): void {
  console.log('=== FitFusion AI — recipe data-quality counts ===');
  console.log(`generated: ${r.generatedAt}`);
  console.log(`recipes: ${r.totalRecipes} total (${r.batchRecipes} v21 batch + ${r.originalRecipes} hand-authored originals)`);
  for (const b of r.batches) {
    console.log(`  ${b.batch}: ${b.recipes} recipes, needsReview=${b.needsReview}, 'to taste' entries=${b.toTasteEntries}`);
  }
  console.log(`needsReview total: ${r.needsReviewTotal}`);
  console.log(`reviewed: ${r.reviewed} | verified: ${r.verified}`);
  const g = r.ingredients;
  console.log(
    `ingredients: ${g.total} (USDA standard-reference=${g.usdaStandardReference}, ` +
      `standard-estimate=${g.standardEstimate}; sourceRef=${g.withSourceRef}, lastReviewedAt=${g.withLastReviewedAt})`,
  );
  console.log(`'to taste' ingredient entries across batches: ${r.toTasteEntries}`);
}

// Run when executed directly (tsx / node), not when imported by the test.
const invokedAsScript =
  process.argv[1] && /recipe-quality-report(\.ts)?$/.test(process.argv[1].replace(/\\/g, '/'));
if (invokedAsScript) {
  printReport(buildQualityReport());
}
