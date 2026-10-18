/**
 * FitFusion AI — seed-safety decision logic tests (v21.8 PRIORITY 1).
 *
 * PURE + mocked-delegate tests: no PostgreSQL required, they run here.
 * They cover the exact regression scenarios from the brief:
 *
 *  - seeding an existing verified recipe and re-running: evidence preserved
 *    when content is unchanged;
 *  - evidence correctly invalidated after a material content change (hash
 *    updated, revision bumped, evidence cleared, allergens re-screened);
 *  - imported exercise media survives repeated seed runs;
 *  - private user recipes are never overwritten;
 *  - the seed is idempotent (second run = zero writes).
 *
 * DB-backed proof (real Prisma writes against PostgreSQL) lives in
 * seed-safety.integration.test.ts — skip-guarded, pending a live database.
 */
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  SeedStats,
  applyExerciseSeed,
  applyRecipeSeed,
  exerciseSeedMediaIntent,
  planRecipeSeed,
  seedMaterialAllergens,
  type ExerciseSeedInput,
  type NormalizedRecipeSeed,
  type StoredRecipeRow,
} from '../src/seed-safety.js';
import { PAKISTANI_RECIPES } from './seed-recipes-pakistani.js';
import { INDIAN_MET_RECIPES } from './seed-recipes-indian-met.js';
import { ASIAN_RECIPES } from './seed-recipes-asian.js';
import { WESTERN_RECIPES } from './seed-recipes-western.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeSeed(overrides: Partial<NormalizedRecipeSeed> = {}): NormalizedRecipeSeed {
  return {
    slug: 'test-daal-fry',
    title: 'Test Daal Fry',
    cuisineId: 'cuisine-1',
    dietCategory: 'vegetarian',
    tags: ['vegan'],
    servings: 4,
    prepMin: 10,
    cookMin: 20,
    difficulty: 'easy',
    mealType: null,
    needsReview: false,
    ingredients: [
      { name: 'Red lentils', quantity: '1 cup', grams: 190 },
      { name: 'Water', quantity: '4 cups', grams: 950 },
    ],
    instructions: [
      { step: 1, text: 'Boil.' },
      { step: 2, text: 'Serve.' },
    ],
    kcalPerServing: 210,
    proteinPerServing: 12,
    carbsPerServing: 32,
    fatPerServing: 3,
    fiberPerServing: 8,
    declaredAllergens: [],
    ...overrides,
  };
}

/** A stored row that looks exactly like the seed's own create wrote it. */
function storedFromSeed(
  seed: NormalizedRecipeSeed,
  overrides: Partial<StoredRecipeRow> = {},
): StoredRecipeRow {
  const plan = planRecipeSeed(seed, null);
  if (plan.kind !== 'create') throw new Error('expected a create plan');
  return {
    id: 'rec-1',
    userId: null,
    isPrivate: false,
    title: seed.title,
    cuisineId: seed.cuisineId,
    dietCategory: seed.dietCategory,
    tags: [...seed.tags],
    servings: seed.servings,
    prepMin: seed.prepMin,
    cookMin: seed.cookMin,
    difficulty: seed.difficulty,
    mealType: seed.mealType,
    needsReview: seed.needsReview,
    ingredients: seed.ingredients.map((i) => ({ ...i })),
    instructions: seed.instructions.map((s) => ({ ...s })),
    yieldGrams: null,
    kcalPerServing: seed.kcalPerServing,
    proteinPerServing: seed.proteinPerServing,
    carbsPerServing: seed.carbsPerServing,
    fatPerServing: seed.fatPerServing,
    fiberPerServing: seed.fiberPerServing,
    allergens: [...seed.declaredAllergens],
    allergenScreened: false,
    contentHash: plan.create.contentHash as string,
    revision: 0,
    ...overrides,
  };
}

function makeExerciseSeed(overrides: Partial<ExerciseSeedInput> = {}): ExerciseSeedInput {
  return {
    slug: 'test-push-up',
    name: 'Push-Up',
    description: 'A test exercise.',
    muscleGroups: ['chest'],
    equipment: ['bodyweight'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness'],
    homeSuitable: true,
    gymSuitable: true,
    steps: ['Do it.'],
    breathing: 'Breathe.',
    commonMistakes: ['None'],
    easierVariation: 'Easier',
    harderVariation: 'Harder',
    safetyNotes: 'Be safe.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// planRecipeSeed — decisions
// ---------------------------------------------------------------------------

describe('planRecipeSeed', () => {
  it('plans create for a missing record, with hash + safe defaults', () => {
    const plan = planRecipeSeed(makeSeed(), null);
    expect(plan.kind).toBe('create');
    if (plan.kind !== 'create') return;
    expect(plan.create.slug).toBe('test-daal-fry');
    expect(plan.create.verified).toBe(false);
    expect(plan.create.allergenScreened).toBe(false);
    expect(plan.create.allergens).toEqual([]);
    expect(plan.create.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // revision defaults to 0 via the schema default (never set by the seed).
    expect('revision' in plan.create).toBe(false);
  });

  it('skips private user-created recipes (userId or isPrivate)', () => {
    const seed = makeSeed();
    expect(planRecipeSeed(seed, storedFromSeed(seed, { userId: 'user-9' })).kind).toBe('skip');
    expect(planRecipeSeed(seed, storedFromSeed(seed, { isPrivate: true })).kind).toBe('skip');
  });

  it('reports unchanged when the stored row matches the seed content', () => {
    const seed = makeSeed();
    const stored = storedFromSeed(seed);
    expect(planRecipeSeed(seed, stored).kind).toBe('unchanged');
  });

  it('is deterministic across repeated planning', () => {
    const seed = makeSeed();
    const stored = storedFromSeed(seed);
    expect(planRecipeSeed(seed, stored)).toEqual(planRecipeSeed(seed, stored));
  });

  it('plans metadata-only for non-material changes without touching evidence', () => {
    const seed = makeSeed({ title: 'Test Daal Fry (retitled)' });
    const stored = storedFromSeed(makeSeed());
    const plan = planRecipeSeed(seed, stored);
    expect(plan.kind).toBe('metadata');
    if (plan.kind !== 'metadata') return;
    expect(plan.changedFields).toContain('title');
    expect(plan.update.title).toBe('Test Daal Fry (retitled)');
    expect(plan.update.revision).toEqual({ increment: 1 });
    // Evidence / verified / allergens are never part of a metadata write.
    expect('verified' in plan.update).toBe(false);
    expect('verificationEvidence' in plan.update).toBe(false);
    expect('reviewEvidence' in plan.update).toBe(false);
    expect('allergens' in plan.update).toBe(false);
    expect('allergenScreened' in plan.update).toBe(false);
    expect('contentHash' in plan.update).toBe(false);
  });

  it('fills in a missing contentHash on legacy rows without invalidating', () => {
    const seed = makeSeed();
    const stored = storedFromSeed(seed, { contentHash: null });
    const plan = planRecipeSeed(seed, stored);
    expect(plan.kind).toBe('metadata');
    if (plan.kind !== 'metadata') return;
    expect(plan.changedFields).toEqual([]);
    expect(plan.update.contentHash).toBe(storedFromSeed(seed).contentHash);
    expect('verified' in plan.update).toBe(false);
    expect('reviewEvidence' in plan.update).toBe(false);
  });

  it('plans material change on ingredient edits: hash, revision, evidence, allergens', () => {
    const seed = makeSeed({
      ingredients: [
        { name: 'Red lentils', quantity: '1 cup', grams: 200 }, // grams changed
        { name: 'Water', quantity: '4 cups', grams: 950 },
      ],
    });
    const stored = storedFromSeed(makeSeed());
    const plan = planRecipeSeed(seed, stored);
    expect(plan.kind).toBe('material');
    if (plan.kind !== 'material') return;
    expect(plan.update.verified).toBe(false);
    expect(plan.update.verificationEvidence).toBe(Prisma.JsonNull);
    expect(plan.update.reviewEvidence).toBe(Prisma.JsonNull);
    expect(plan.update.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.update.contentHash).not.toBe(stored.contentHash);
    expect(plan.update.revision).toEqual({ increment: 1 });
    expect(plan.update.allergenScreened).toBe(true);
    expect(plan.update.allergens).toEqual(seedMaterialAllergens(seed));
  });

  it('plans material change on nutrition-only edits (not covered by the hash)', () => {
    const seed = makeSeed({ kcalPerServing: 250 });
    const stored = storedFromSeed(makeSeed());
    expect(planRecipeSeed(seed, stored).kind).toBe('material');
  });

  it('plans material change when the seed corrects the declared allergen list', () => {
    const seed = makeSeed({ declaredAllergens: ['milk'] });
    const stored = storedFromSeed(makeSeed());
    const plan = planRecipeSeed(seed, stored);
    expect(plan.kind).toBe('material');
  });

  it('converges: applying a material plan once makes the next plan unchanged', () => {
    const seed = makeSeed({
      ingredients: [
        { name: 'Paneer, cubed', quantity: '250 g', grams: 250 },
        { name: 'Water', quantity: '4 cups', grams: 950 },
      ],
      declaredAllergens: [],
    });
    const stored = storedFromSeed(makeSeed());
    const plan = planRecipeSeed(seed, stored);
    expect(plan.kind).toBe('material');
    if (plan.kind !== 'material') return;
    // Simulate the write landing.
    const after: StoredRecipeRow = {
      ...stored,
      ingredients: seed.ingredients.map((i) => ({ ...i })),
      allergens: [...(plan.update.allergens as string[])],
      allergenScreened: true,
      contentHash: plan.update.contentHash as string,
      revision: stored.revision + 1,
    };
    const again = planRecipeSeed(seed, { ...after });
    expect(again.kind).toBe('unchanged');
  });
});

// ---------------------------------------------------------------------------
// seedMaterialAllergens — union policy
// ---------------------------------------------------------------------------

describe('seedMaterialAllergens', () => {
  it('never drops a curated detection the screener misses (no false negatives)', () => {
    // margherita-pizza shape: mozzarella + pizza dough carry milk/wheat in
    // the curated list, but the name screener sees neither.
    const seed = makeSeed({
      ingredients: [
        { name: 'Mozzarella, sliced', quantity: '125 g', grams: 125 },
        { name: 'Pizza dough', quantity: '1 ball', grams: 280 },
      ],
      declaredAllergens: ['milk', 'wheat'],
    });
    expect(seedMaterialAllergens(seed)).toEqual(['milk', 'wheat']);
  });

  it('adds screener detections the curation missed (safe direction)', () => {
    const seed = makeSeed({
      ingredients: [{ name: 'Paneer, cubed', quantity: '250 g', grams: 250 }],
      declaredAllergens: [],
    });
    expect(seedMaterialAllergens(seed)).toEqual(['milk']);
  });
});

// ---------------------------------------------------------------------------
// applyRecipeSeed — write application with mocked delegates
// ---------------------------------------------------------------------------

function mockRecipePrisma(existing: StoredRecipeRow | null) {
  const recipe = {
    findUnique: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockImplementation(async ({ data }: { data: { slug: string } }) => ({
      id: 'rec-new',
      slug: data.slug,
    })),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = { recipe } as unknown as Pick<PrismaClient, 'recipe'>;
  return { prisma, recipe };
}

describe('applyRecipeSeed', () => {
  it('performs zero writes for an unchanged verified recipe', async () => {
    const seed = makeSeed();
    const { prisma, recipe } = mockRecipePrisma(storedFromSeed(seed));
    const stats = new SeedStats();
    const result = await applyRecipeSeed(prisma, seed, stats);
    expect(result).toEqual({ status: 'unchanged', id: 'rec-1' });
    expect(recipe.create).not.toHaveBeenCalled();
    expect(recipe.updateMany).not.toHaveBeenCalled();
    expect(stats.count('recipe', 'unchanged')).toBe(1);
  });

  it('writes a conditional revision-guarded update on material change', async () => {
    const seed = makeSeed({ kcalPerServing: 250 });
    const original = storedFromSeed(makeSeed());
    const { prisma, recipe } = mockRecipePrisma(original);
    const stats = new SeedStats();
    const result = await applyRecipeSeed(prisma, seed, stats);
    expect(result.status).toBe('updated');
    expect(recipe.updateMany).toHaveBeenCalledTimes(1);
    const [args] = recipe.updateMany.mock.calls[0] as [
      { where: { id: string; revision: number }; data: Record<string, unknown> },
    ];
    // Conditional on the exact revision read — a concurrent mutation fails
    // the write instead of overwriting.
    expect(args.where).toEqual({ id: 'rec-1', revision: 0 });
    expect(args.data.verified).toBe(false);
    expect(args.data.verificationEvidence).toBe(Prisma.JsonNull);
    expect(args.data.reviewEvidence).toBe(Prisma.JsonNull);
    expect(args.data.revision).toEqual({ increment: 1 });
    expect(typeof args.data.contentHash).toBe('string');
    // Nutrition numbers are deliberately NOT part of the content identity
    // (buildContentSnapshot is the single source of truth — the seed must
    // not fork the hash): the hash is unchanged, but the revision still
    // bumps so the optimistic-concurrency guard catches the write, and the
    // stale nutrition evidence is invalidated.
    expect(args.data.contentHash).toBe(original.contentHash);
    expect(stats.count('recipe', 'updated')).toBe(1);
  });

  it('reports failed when the revision moved under the seed (lost race)', async () => {
    const seed = makeSeed({ kcalPerServing: 250 });
    const { prisma, recipe } = mockRecipePrisma(storedFromSeed(makeSeed()));
    recipe.updateMany.mockResolvedValue({ count: 0 });
    const stats = new SeedStats();
    const result = await applyRecipeSeed(prisma, seed, stats);
    expect(result).toEqual({ status: 'failed', id: null });
    expect(stats.count('recipe', 'failed')).toBe(1);
  });

  it('never writes for a skipped private recipe', async () => {
    const seed = makeSeed();
    const { prisma, recipe } = mockRecipePrisma(storedFromSeed(seed, { userId: 'user-9' }));
    const stats = new SeedStats();
    const result = await applyRecipeSeed(prisma, seed, stats);
    expect(result.status).toBe('skipped');
    expect(recipe.create).not.toHaveBeenCalled();
    expect(recipe.updateMany).not.toHaveBeenCalled();
    expect(stats.count('recipe', 'skipped')).toBe(1);
  });

  it('creates a missing record', async () => {
    const seed = makeSeed();
    const { prisma, recipe } = mockRecipePrisma(null);
    const stats = new SeedStats();
    const result = await applyRecipeSeed(prisma, seed, stats);
    expect(result).toEqual({ status: 'created', id: 'rec-new' });
    expect(recipe.create).toHaveBeenCalledTimes(1);
    expect(stats.count('recipe', 'created')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Exercise media preservation
// ---------------------------------------------------------------------------

describe('exerciseSeedMediaIntent', () => {
  it('preserves when the seed carries no media', () => {
    expect(exerciseSeedMediaIntent(makeExerciseSeed())).toBe('preserve');
    expect(exerciseSeedMediaIntent(makeExerciseSeed({ mediaType: 'none', mediaUrl: null }))).toBe(
      'preserve',
    );
  });

  it('applies when the seed explicitly carries media', () => {
    expect(
      exerciseSeedMediaIntent(
        makeExerciseSeed({ mediaType: 'video', mediaUrl: 'https://cdn.example/v.mp4' }),
      ),
    ).toBe('apply');
  });
});

function mockExercisePrisma(existing: Record<string, unknown> | null) {
  const exercise = {
    findUnique: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockImplementation(async ({ data }: { data: { slug: string } }) => ({
      id: 'ex-new',
      slug: data.slug,
    })),
    update: vi.fn().mockResolvedValue({}),
  };
  const prisma = { exercise } as unknown as Pick<PrismaClient, 'exercise'>;
  return { prisma, exercise };
}

function storedExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ex-1',
    slug: 'test-push-up',
    name: 'Push-Up',
    description: 'A test exercise.',
    muscleGroups: ['chest'],
    equipment: ['bodyweight'],
    difficulty: 'beginner',
    exerciseType: 'strength',
    trainingStyles: ['general-fitness'],
    homeSuitable: true,
    gymSuitable: true,
    steps: ['Do it.'],
    breathing: 'Breathe.',
    commonMistakes: ['None'],
    easierVariation: 'Easier',
    harderVariation: 'Harder',
    safetyNotes: 'Be safe.',
    // Media imported from an authorized source (NOT the seed default).
    mediaType: 'video',
    mediaUrl: 'https://authorized.example/media/push-up.mp4',
    ...overrides,
  };
}

describe('applyExerciseSeed', () => {
  it('leaves imported media untouched on re-runs (no write at all when unchanged)', async () => {
    const { prisma, exercise } = mockExercisePrisma(storedExercise());
    const stats = new SeedStats();
    const result = await applyExerciseSeed(prisma, makeExerciseSeed(), stats);
    expect(result).toEqual({ status: 'unchanged', id: 'ex-1' });
    expect(exercise.update).not.toHaveBeenCalled();
    expect(stats.count('exercise', 'unchanged')).toBe(1);
  });

  it('never downgrades imported media when other fields change', async () => {
    const { prisma, exercise } = mockExercisePrisma(storedExercise());
    const stats = new SeedStats();
    const result = await applyExerciseSeed(
      prisma,
      makeExerciseSeed({ description: 'An updated test exercise.' }),
      stats,
    );
    expect(result.status).toBe('updated');
    expect(exercise.update).toHaveBeenCalledTimes(1);
    const [args] = exercise.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.description).toBe('An updated test exercise.');
    expect('mediaType' in args.data).toBe(false);
    expect('mediaUrl' in args.data).toBe(false);
  });

  it('applies media when the seed explicitly carries it', async () => {
    const { prisma, exercise } = mockExercisePrisma(storedExercise({ mediaType: 'none', mediaUrl: null }));
    const stats = new SeedStats();
    const result = await applyExerciseSeed(
      prisma,
      makeExerciseSeed({ mediaType: 'video', mediaUrl: 'https://seed.example/new.mp4' }),
      stats,
    );
    expect(result.status).toBe('updated');
    const [args] = exercise.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.mediaType).toBe('video');
    expect(args.data.mediaUrl).toBe('https://seed.example/new.mp4');
  });

  it('creates with the seed default media when the record is missing', async () => {
    const { prisma, exercise } = mockExercisePrisma(null);
    const stats = new SeedStats();
    const result = await applyExerciseSeed(prisma, makeExerciseSeed(), stats);
    expect(result).toEqual({ status: 'created', id: 'ex-new' });
    const [args] = exercise.create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.mediaType).toBe('none');
    expect(args.data.mediaUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real batch seed data: idempotency over all 239 v21 recipes
// ---------------------------------------------------------------------------

/** Same normalization the seed runner applies to v21 batch entries. */
function normalizeBatchEntry(r: any): NormalizedRecipeSeed {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    slug: r.slug,
    title: r.title,
    cuisineId: 'cuisine-test',
    dietCategory: r.dietCategory,
    tags: r.tags,
    servings: r.servings,
    prepMin: r.prepMin,
    cookMin: r.cookMin,
    difficulty: r.difficulty,
    mealType: r.mealType ?? null,
    needsReview: r.needsReview,
    ingredients: r.ingredients.map((i: any) => ({
      name: i.name,
      quantity: i.quantity,
      grams: i.grams ?? null,
    })),
    instructions: r.instructions.map((text: string, idx: number) => ({ step: idx + 1, text })),
    kcalPerServing: r1(r.computed.perServing.kcal),
    proteinPerServing: r1(r.computed.perServing.proteinG),
    carbsPerServing: r1(r.computed.perServing.carbsG),
    fatPerServing: r1(r.computed.perServing.fatG),
    fiberPerServing: r1(r.computed.perServing.fiberG),
    declaredAllergens: r.allergens,
  };
}

describe('real v21 batch seed data', () => {
  const batches: any[][] = [
    PAKISTANI_RECIPES as any[],
    INDIAN_MET_RECIPES as any[],
    ASIAN_RECIPES as any[],
    WESTERN_RECIPES as any[],
  ];

  it('create → unchanged for every batch recipe (idempotent re-runs)', () => {
    const problems: string[] = [];
    let total = 0;
    for (const batch of batches) {
      for (const r of batch) {
        total++;
        const seed = normalizeBatchEntry(r);
        const p1 = planRecipeSeed(seed, null);
        if (p1.kind !== 'create') {
          problems.push(`${r.slug}: first plan = ${p1.kind}, expected create`);
          continue;
        }
        const stored = storedFromSeed(seed);
        const p2 = planRecipeSeed(seed, stored);
        if (p2.kind !== 'unchanged') {
          problems.push(`${r.slug}: second plan = ${p2.kind}, expected unchanged`);
        }
      }
    }
    expect(total).toBeGreaterThan(200);
    expect(problems).toEqual([]);
  });

  it('a material change on a dairy-declared recipe converges after one union write', () => {
    // peshawari-chicken-karahi declares ['dairy'] while the name screener
    // yields ['milk'] — the material-change write stores the union once,
    // then re-runs are stable (no flip-flop, no repeated invalidation).
    const raw = (PAKISTANI_RECIPES as any[]).find((r) => r.slug === 'peshawari-chicken-karahi');
    expect(raw).toBeDefined();
    const seed = normalizeBatchEntry({
      ...raw,
      ingredients: [...raw.ingredients, { name: 'ExtraTest', quantity: '1 tsp', grams: 5 }],
    });
    const stored = storedFromSeed(normalizeBatchEntry(raw));
    const plan = planRecipeSeed(seed, stored);
    expect(plan.kind).toBe('material');
    if (plan.kind !== 'material') return;
    expect(plan.update.allergens).toEqual(['dairy', 'milk']);
    expect(plan.update.allergenScreened).toBe(true);
    // Simulate the write landing, then re-plan: must be unchanged.
    const after: StoredRecipeRow = {
      ...stored,
      ingredients: seed.ingredients.map((i) => ({ ...i })),
      kcalPerServing: seed.kcalPerServing,
      proteinPerServing: seed.proteinPerServing,
      carbsPerServing: seed.carbsPerServing,
      fatPerServing: seed.fatPerServing,
      fiberPerServing: seed.fiberPerServing,
      allergens: [...(plan.update.allergens as string[])],
      allergenScreened: true,
      contentHash: plan.update.contentHash as string,
      revision: stored.revision + 1,
    };
    expect(planRecipeSeed(seed, after).kind).toBe('unchanged');
    // And once more for good measure: still unchanged (no oscillation).
    expect(planRecipeSeed(seed, after).kind).toBe('unchanged');
  });
});

describe('SeedStats', () => {
  it('aggregates per-type outcomes and renders a report', () => {
    const stats = new SeedStats();
    stats.note('recipe', 'created');
    stats.note('recipe', 'unchanged');
    stats.note('recipe', 'unchanged');
    stats.note('recipe', 'skipped');
    stats.note('exercise', 'updated');
    stats.note('exercise', 'failed');
    expect(stats.count('recipe', 'created')).toBe(1);
    expect(stats.count('recipe', 'unchanged')).toBe(2);
    expect(stats.count('recipe', 'skipped')).toBe(1);
    expect(stats.count('exercise', 'failed')).toBe(1);
    expect(stats.failedTotal()).toBe(1);
    const summary = stats.summary();
    expect(summary).toContain('recipe');
    expect(summary).toContain('exercise');
    expect(summary).toContain('created');
  });
});
