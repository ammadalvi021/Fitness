/**
 * FitFusion AI — seed safety for reference records (v21.8 PRIORITY 1).
 *
 * PURE PLANNING + thin write application for the recipe / exercise seed
 * paths. The seed runner (prisma/seed.ts) calls `applyRecipeSeed` /
 * `applyExerciseSeed`; every *decision* lives here so it is unit-testable
 * without PostgreSQL.
 *
 * Recipe policy (the fix for the v21.8 seed-safety defects):
 *
 *  1. Create vs update are distinguished. A blind `upsert` that rewrote
 *     material fields on every run is gone.
 *  2. Private user-created recipes (`userId != null` or `isPrivate`) are
 *     NEVER touched — the seed only owns `source='curated'` reference rows.
 *     They are reported as `skipped`, not silently overwritten.
 *  3. `verified` / `verificationEvidence` / `reviewEvidence` are preserved
 *     whenever the seeded content has not changed. Change is detected by
 *     comparing the canonical content hash
 *     (`computeRecipeContentHash(buildContentSnapshot(...))` — the single
 *     source of truth from @fitfusion/core, the same canonicalization the
 *     PATCH route and the backfill script use) plus the derived nutrition
 *     numbers (which the hash snapshot intentionally does not cover).
 *  4. A material change (ingredients / servings / dietCategory / tags /
 *     allergens / nutrition numbers) is applied as ONE conditional write:
 *       - `contentHash` recomputed over the post-write content,
 *       - `revision` incremented atomically via
 *         `updateMany({ where: { id, revision: readRevision }, ... })`
 *         (a lost race reports `failed` instead of silently overwriting),
 *       - review + verification evidence invalidated (`verified: false`,
 *         both evidence columns cleared — the recorded evidence was
 *         checked against the previous content),
 *       - allergens recomputed and `allergenScreened` reconciled (see below).
 *  5. Metadata-only changes (title, times, difficulty, instructions,
 *     mealType, cuisine, needsReview) never touch evidence or `verified`;
 *     they still bump `revision` (v21.7: every recipe mutation bumps it).
 *  6. Legacy rows with `contentHash = NULL` are compared by canonical
 *     content instead of by hash; when the content is unchanged the seed
 *     only *fills in* the hash (backfill-style) and never invalidates.
 *  7. Re-running the seed against an unchanged DB performs zero writes
 *     (every record reports `unchanged`) — the seed is idempotent.
 *
 * Allergen policy on a material change (empirically grounded):
 * the seed's declared allergen lists are human-curated and frequently MORE
 * accurate than the naive name screener (verified 2026-10-16: 101 of 270
 * seed recipes differ — e.g. `margherita-pizza` declares ['milk','wheat']
 * from mozzarella + pizza dough, which `screenIngredientAllergens` misses
 * entirely, while "Yogurt (plant or dairy)" correctly declares [] where
 * the screener false-positives ['milk']). Blindly replacing the curated
 * list with screener output would introduce false *negatives* — the
 * dangerous direction for allergy sufferers. So on a material change the
 * seed writes `union(declared, screenIngredientAllergens(names))`:
 *   - the existing screening helper ALWAYS runs (as required),
 *   - `allergenScreened = true` is truthful (screening was performed),
 *   - no curated detection is ever dropped,
 *   - the result is deterministic → re-runs are stable.
 * The read path already normalizes legacy labels ('dairy'→'milk',
 * 'gluten'→'wheat', …) via `resolveAllergenExclusionTerms`, so the union
 * needs no label normalization here.
 *
 * Exercise policy: the seed NEVER writes `mediaType`/`mediaUrl` on update
 * unless the seed entry explicitly carries media — imported exercise media
 * (e.g. from an authorized media source) survives repeated seed runs.
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  buildContentSnapshot,
  computeRecipeContentHash,
  screenIngredientAllergens,
} from '@fitfusion/core';

// ---------------------------------------------------------------------------
// Seed input / stored row shapes
// ---------------------------------------------------------------------------

export interface SeedIngredientInput {
  name: string;
  quantity: string;
  grams: number | null;
}

export interface SeedInstructionInput {
  step: number;
  text: string;
}

/** One recipe as the seed wants it to look (both seed shapes normalized). */
export interface NormalizedRecipeSeed {
  slug: string;
  title: string;
  cuisineId: string;
  dietCategory: string;
  tags: string[];
  servings: number;
  prepMin: number;
  cookMin: number;
  difficulty: string;
  mealType: string | null;
  needsReview: boolean;
  ingredients: SeedIngredientInput[];
  instructions: SeedInstructionInput[];
  kcalPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  fiberPerServing: number;
  /** The curated allergen list carried by the seed modules. */
  declaredAllergens: string[];
}

/**
 * Minimal stored-recipe shape the planner needs. `prisma.recipe.findUnique`
 * rows are assignable to this (extra columns are ignored).
 */
export interface StoredRecipeRow {
  id: string;
  userId: string | null;
  isPrivate: boolean;
  title: string;
  cuisineId: string | null;
  dietCategory: string;
  tags: string[];
  servings: number;
  prepMin: number;
  cookMin: number;
  difficulty: string;
  mealType: string | null;
  needsReview: boolean;
  ingredients: unknown;
  instructions: unknown;
  yieldGrams: number | null;
  kcalPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  fiberPerServing: number;
  allergens: string[];
  allergenScreened: boolean;
  contentHash: string | null;
  revision: number;
}

export interface ExerciseSeedInput {
  slug: string;
  name: string;
  description: string;
  muscleGroups: string[];
  equipment: string[];
  difficulty: string;
  exerciseType: string;
  trainingStyles: string[];
  homeSuitable: boolean;
  gymSuitable: boolean;
  steps: string[];
  breathing: string | null;
  commonMistakes: string[];
  easierVariation: string | null;
  harderVariation: string | null;
  safetyNotes: string | null;
  /** When absent/null/'none' the seed carries no media (the common case). */
  mediaType?: string;
  mediaUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Round to 1 decimal — same convention as @fitfusion/core roundNutrients. */
function r1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Canonical claim-list comparison form: trimmed, lowercased, deduped, sorted. */
function canonicalList(list: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const v of list ?? []) {
    const s = String(v ?? '').trim().toLowerCase();
    if (s) seen.add(s);
  }
  return [...seen].sort();
}

/** Deterministic union for the allergen write (sorted, exact-dedupe). */
function unionSorted(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

function instructionsKey(v: unknown): string {
  if (!Array.isArray(v)) return '';
  return v
    .map((s) => {
      const o = s as { step?: unknown; text?: unknown } | null;
      return `${String(o?.step ?? '')}:${String(o?.text ?? '')}`;
    })
    .join('\n');
}

function seedIngredientNames(seed: NormalizedRecipeSeed): string[] {
  return seed.ingredients.map((i) => i.name).filter((n) => !!n);
}

/**
 * The allergen list the seed would write for this content on a MATERIAL
 * change: union of the curated declared list and the name-screener output.
 * Deterministic — the same seed content always yields the same list, so
 * re-runs converge.
 */
export function seedMaterialAllergens(seed: NormalizedRecipeSeed): string[] {
  return unionSorted(
    seed.declaredAllergens,
    screenIngredientAllergens(seedIngredientNames(seed)),
  );
}

/**
 * The allergen list the seed's write rule would store for this row:
 * rows that already went through a material-change rescreen keep the union
 * basis (stable across runs); never-rescreened rows keep the declared list
 * (exactly what `create` wrote — no churn on plain re-runs).
 */
function wouldBeAllergens(
  seed: NormalizedRecipeSeed,
  existing: StoredRecipeRow | null,
): string[] {
  if (existing?.allergenScreened) return seedMaterialAllergens(seed);
  return [...seed.declaredAllergens];
}

/** Post-write content hash for the seed content (yieldGrams is not seed-owned). */
function seedContentHash(
  seed: NormalizedRecipeSeed,
  existing: StoredRecipeRow | null,
): string {
  return computeRecipeContentHash(
    buildContentSnapshot({
      ingredients: seed.ingredients,
      servings: seed.servings,
      dietCategory: seed.dietCategory,
      yieldGrams: existing?.yieldGrams ?? null,
      tags: seed.tags,
      allergens: wouldBeAllergens(seed, existing),
    }),
  );
}

function storedContentHash(existing: StoredRecipeRow): string {
  return computeRecipeContentHash(
    buildContentSnapshot({
      ingredients: existing.ingredients,
      servings: existing.servings,
      dietCategory: existing.dietCategory,
      yieldGrams: existing.yieldGrams ?? null,
      tags: existing.tags,
      allergens: existing.allergens,
    }),
  );
}

function nutritionChanged(seed: NormalizedRecipeSeed, existing: StoredRecipeRow): boolean {
  return (
    r1(existing.kcalPerServing) !== r1(seed.kcalPerServing) ||
    r1(existing.proteinPerServing) !== r1(seed.proteinPerServing) ||
    r1(existing.carbsPerServing) !== r1(seed.carbsPerServing) ||
    r1(existing.fatPerServing) !== r1(seed.fatPerServing) ||
    r1(existing.fiberPerServing) !== r1(seed.fiberPerServing)
  );
}

/** Seed-owned metadata fields (never invalidate evidence). */
function metadataDiffs(seed: NormalizedRecipeSeed, existing: StoredRecipeRow): string[] {
  const diffs: string[] = [];
  if (existing.title !== seed.title) diffs.push('title');
  if ((existing.cuisineId ?? null) !== seed.cuisineId) diffs.push('cuisineId');
  if (existing.prepMin !== seed.prepMin) diffs.push('prepMin');
  if (existing.cookMin !== seed.cookMin) diffs.push('cookMin');
  if (existing.difficulty !== seed.difficulty) diffs.push('difficulty');
  if ((existing.mealType ?? null) !== seed.mealType) diffs.push('mealType');
  if (existing.needsReview !== seed.needsReview) diffs.push('needsReview');
  if (instructionsKey(existing.instructions) !== instructionsKey(seed.instructions)) {
    diffs.push('instructions');
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Recipe planning
// ---------------------------------------------------------------------------

export type RecipeSeedPlan =
  | { kind: 'create'; create: Prisma.RecipeCreateInput }
  | { kind: 'skip'; reason: 'private-user-recipe' }
  | { kind: 'unchanged' }
  | { kind: 'metadata'; update: Prisma.RecipeUncheckedUpdateManyInput; changedFields: string[] }
  | { kind: 'material'; update: Prisma.RecipeUncheckedUpdateManyInput };

function buildSeedCreate(seed: NormalizedRecipeSeed): Prisma.RecipeCreateInput {
  return {
    slug: seed.slug,
    title: seed.title,
    // The checked create input exposes the relation, not the FK scalar
    // (the runtime accepts the scalar too, but the nested connect is what
    // the generated types allow).
    cuisine: { connect: { id: seed.cuisineId } },
    dietCategory: seed.dietCategory,
    tags: seed.tags,
    servings: seed.servings,
    prepMin: seed.prepMin,
    cookMin: seed.cookMin,
    difficulty: seed.difficulty,
    mealType: seed.mealType,
    needsReview: seed.needsReview,
    ingredients: seed.ingredients as unknown as Prisma.InputJsonValue,
    instructions: seed.instructions as unknown as Prisma.InputJsonValue,
    kcalPerServing: seed.kcalPerServing,
    proteinPerServing: seed.proteinPerServing,
    carbsPerServing: seed.carbsPerServing,
    fatPerServing: seed.fatPerServing,
    fiberPerServing: seed.fiberPerServing,
    source: 'curated',
    // V21.2 P8: the originals carry hand-written nutrition with NO recorded
    // verification evidence (see VERIFIED_STANDARD_EVIDENCE in
    // recipe-claims-policy.ts and docs/recipe-data-quality.md), so the
    // honest flag is false — curated hand-authored estimates, tier
    // 'calculated-estimate'. Engine-computed batch recipes are likewise
    // unverified until human-reviewed.
    verified: false,
    // Create keeps the curated declared list, unscreened — exactly the
    // pre-v21.8 seed behavior. Screening happens only on material change.
    allergens: [...seed.declaredAllergens],
    allergenScreened: false,
    contentHash: seedContentHash(seed, null),
  };
}

/**
 * Decide what the seed should do with one recipe. Pure — no DB I/O.
 * Never throws on odd stored shapes (buildContentSnapshot is total).
 */
export function planRecipeSeed(
  seed: NormalizedRecipeSeed,
  existing: StoredRecipeRow | null,
): RecipeSeedPlan {
  if (!existing) return { kind: 'create', create: buildSeedCreate(seed) };

  // The seed never overwrites private user-created recipes.
  if (existing.userId != null || existing.isPrivate) {
    return { kind: 'skip', reason: 'private-user-recipe' };
  }

  const newHash = seedContentHash(seed, existing);
  // Legacy rows predate hash tracking: compare canonical content directly.
  const contentEqual =
    existing.contentHash != null
      ? existing.contentHash === newHash
      : storedContentHash(existing) === newHash;
  const material = !contentEqual || nutritionChanged(seed, existing);

  if (!material) {
    const changedFields = metadataDiffs(seed, existing);
    // Fill in a missing hash backfill-style (no evidence touched).
    const hashFill = existing.contentHash == null ? newHash : null;
    if (changedFields.length === 0 && hashFill == null) {
      return { kind: 'unchanged' };
    }
    const update: Prisma.RecipeUncheckedUpdateManyInput = { revision: { increment: 1 } };
    for (const f of changedFields) {
      if (f === 'instructions') {
        update.instructions = seed.instructions as unknown as Prisma.InputJsonValue;
      } else if (f === 'cuisineId') {
        // Scalar FK (not relation connect): updateMany rejects nested writes.
        update.cuisineId = seed.cuisineId;
      } else {
        (update as Record<string, unknown>)[f] =
          (seed as unknown as Record<string, unknown>)[f];
      }
    }
    if (hashFill != null) update.contentHash = hashFill;
    return { kind: 'metadata', update, changedFields };
  }

  // Material change, intentionally applied: recompute the hash, bump the
  // revision (atomically — the runner's updateMany is conditional on the
  // revision read here), invalidate review + verification evidence, and
  // re-screen allergens (union of curated + screener output, screened=true).
  const allergens = seedMaterialAllergens(seed);
  const update: Prisma.RecipeUncheckedUpdateManyInput = {
    title: seed.title,
    // Scalar FK: the runner uses updateMany (conditional on revision),
    // which rejects nested relation writes.
    cuisineId: seed.cuisineId,
    dietCategory: seed.dietCategory,
    tags: seed.tags,
    servings: seed.servings,
    prepMin: seed.prepMin,
    cookMin: seed.cookMin,
    difficulty: seed.difficulty,
    mealType: seed.mealType,
    needsReview: seed.needsReview,
    ingredients: seed.ingredients as unknown as Prisma.InputJsonValue,
    instructions: seed.instructions as unknown as Prisma.InputJsonValue,
    kcalPerServing: seed.kcalPerServing,
    proteinPerServing: seed.proteinPerServing,
    carbsPerServing: seed.carbsPerServing,
    fatPerServing: seed.fatPerServing,
    fiberPerServing: seed.fiberPerServing,
    source: 'curated',
    verified: false,
    verificationEvidence: Prisma.JsonNull,
    reviewEvidence: Prisma.JsonNull,
    allergens,
    allergenScreened: true,
    // Recomputed over the post-write content (the union allergen list) so
    // hash and content can never diverge.
    contentHash: computeRecipeContentHash(
      buildContentSnapshot({
        ingredients: seed.ingredients,
        servings: seed.servings,
        dietCategory: seed.dietCategory,
        yieldGrams: existing.yieldGrams ?? null,
        tags: seed.tags,
        allergens,
      }),
    ),
    revision: { increment: 1 },
  };
  return { kind: 'material', update };
}

// ---------------------------------------------------------------------------
// Exercise planning
// ---------------------------------------------------------------------------

/**
 * 'preserve' = the update must NOT include mediaType/mediaUrl (imported
 * exercise media survives); 'apply' = the seed explicitly carries media and
 * the update may set it (an intentional upgrade, never a downgrade — the
 * seed's only non-explicit media value is 'none'/null, which never applies).
 */
export function exerciseSeedMediaIntent(seed: ExerciseSeedInput): 'preserve' | 'apply' {
  if (seed.mediaType !== undefined && seed.mediaType !== 'none') return 'apply';
  if (seed.mediaUrl !== undefined && seed.mediaUrl !== null) return 'apply';
  return 'preserve';
}

interface ExerciseContentFields {
  name: string;
  description: string;
  muscleGroups: string[];
  equipment: string[];
  difficulty: string;
  exerciseType: string;
  trainingStyles: string[];
  homeSuitable: boolean;
  gymSuitable: boolean;
  steps: string[];
  breathing: string | null;
  commonMistakes: string[];
  easierVariation: string | null;
  harderVariation: string | null;
  safetyNotes: string | null;
}

function exerciseContentFields(seed: ExerciseSeedInput): ExerciseContentFields {
  return {
    name: seed.name,
    description: seed.description,
    muscleGroups: seed.muscleGroups,
    equipment: seed.equipment,
    difficulty: seed.difficulty,
    exerciseType: seed.exerciseType,
    trainingStyles: seed.trainingStyles,
    homeSuitable: seed.homeSuitable,
    gymSuitable: seed.gymSuitable,
    steps: seed.steps,
    breathing: seed.breathing,
    commonMistakes: seed.commonMistakes,
    easierVariation: seed.easierVariation,
    harderVariation: seed.harderVariation,
    safetyNotes: seed.safetyNotes,
  };
}

// ---------------------------------------------------------------------------
// Write application (thin; the decisions above do the work)
// ---------------------------------------------------------------------------

export type SeedOutcome = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed';

export class SeedStats {
  private counts = new Map<string, Record<SeedOutcome, number>>();

  note(type: string, outcome: SeedOutcome): void {
    let row = this.counts.get(type);
    if (!row) {
      row = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
      this.counts.set(type, row);
    }
    row[outcome] += 1;
  }

  count(type: string, outcome: SeedOutcome): number {
    return this.counts.get(type)?.[outcome] ?? 0;
  }

  failedTotal(): number {
    let n = 0;
    for (const row of this.counts.values()) n += row.failed;
    return n;
  }

  summary(): string {
    const lines = ['seed report (per record type):'];
    lines.push('type        created  updated  unchanged  skipped   failed');
    for (const type of [...this.counts.keys()].sort()) {
      const r = this.counts.get(type)!;
      lines.push(
        type.padEnd(12) +
          String(r.created).padStart(7) +
          String(r.updated).padStart(8) +
          String(r.unchanged).padStart(10) +
          String(r.skipped).padStart(8) +
          String(r.failed).padStart(7),
      );
    }
    return lines.join('\n');
  }
}

export interface AppliedSeedResult {
  status: SeedOutcome;
  /** The recipe/exercise id when the record exists (null when the write failed). */
  id: string | null;
}

/**
 * Apply one recipe seed: plan (pure) then the minimal Prisma write.
 * Updates are conditional on the revision read — a concurrent mutation
 * between the read and the write reports `failed` instead of overwriting.
 */
export async function applyRecipeSeed(
  prisma: Pick<PrismaClient, 'recipe'>,
  seed: NormalizedRecipeSeed,
  stats: SeedStats,
): Promise<AppliedSeedResult> {
  const existing = await prisma.recipe.findUnique({ where: { slug: seed.slug } });
  const plan = planRecipeSeed(seed, existing);
  switch (plan.kind) {
    case 'create': {
      const row = await prisma.recipe.create({ data: plan.create });
      stats.note('recipe', 'created');
      return { status: 'created', id: row.id };
    }
    case 'skip': {
      stats.note('recipe', 'skipped');
      console.log(`[seed] skip recipe ${seed.slug}: private user recipe — left untouched`);
      return { status: 'skipped', id: existing!.id };
    }
    case 'unchanged': {
      stats.note('recipe', 'unchanged');
      return { status: 'unchanged', id: existing!.id };
    }
    case 'metadata':
    case 'material': {
      const res = await prisma.recipe.updateMany({
        where: { id: existing!.id, revision: existing!.revision },
        data: plan.update,
      });
      if (res.count === 0) {
        stats.note('recipe', 'failed');
        console.error(
          `[seed] CONFLICT recipe ${seed.slug}: revision moved during the seed run — left untouched`,
        );
        return { status: 'failed', id: null };
      }
      stats.note('recipe', 'updated');
      if (plan.kind === 'material') {
        console.log(
          `[seed] material update recipe ${seed.slug}: contentHash recomputed, revision+1, ` +
            `review/verification evidence invalidated, allergens re-screened`,
        );
      }
      return { status: 'updated', id: existing!.id };
    }
  }
}

/**
 * Apply one exercise seed. The update NEVER includes mediaType/mediaUrl
 * unless the seed explicitly carries media — media imported from an
 * authorized source survives repeated runs.
 */
export async function applyExerciseSeed(
  prisma: Pick<PrismaClient, 'exercise'>,
  seed: ExerciseSeedInput,
  stats: SeedStats,
): Promise<AppliedSeedResult> {
  const existing = await prisma.exercise.findUnique({ where: { slug: seed.slug } });
  const fields = exerciseContentFields(seed);
  if (!existing) {
    const row = await prisma.exercise.create({
      data: {
        slug: seed.slug,
        ...fields,
        mediaType: seed.mediaType ?? 'none',
        mediaUrl: seed.mediaUrl ?? null,
      },
    });
    stats.note('exercise', 'created');
    return { status: 'created', id: row.id };
  }
  const data: Prisma.ExerciseUpdateInput = {};
  const existingRec = existing as unknown as Record<string, unknown>;
  for (const k of Object.keys(fields) as (keyof ExerciseContentFields)[]) {
    if (JSON.stringify(existingRec[k]) !== JSON.stringify(fields[k])) {
      (data as Record<string, unknown>)[k] = fields[k];
    }
  }
  if (exerciseSeedMediaIntent(seed) === 'apply') {
    const mediaType = seed.mediaType ?? 'none';
    const mediaUrl = seed.mediaUrl ?? null;
    if (existing.mediaType !== mediaType) data.mediaType = mediaType;
    if ((existing.mediaUrl ?? null) !== mediaUrl) data.mediaUrl = mediaUrl;
  }
  // 'preserve': mediaType/mediaUrl are never part of the update.
  if (Object.keys(data).length === 0) {
    stats.note('exercise', 'unchanged');
    return { status: 'unchanged', id: existing.id };
  }
  await prisma.exercise.update({ where: { id: existing.id }, data });
  stats.note('exercise', 'updated');
  return { status: 'updated', id: existing.id };
}
