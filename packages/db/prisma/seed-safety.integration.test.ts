/**
 * FitFusion AI — seed-safety DATABASE integration tests (v21.8 PRIORITY 1).
 *
 * DB-GATED: skipped when DATABASE_URL is unset (e.g. this VM has no
 * PostgreSQL). Exercises the REAL `applyRecipeSeed` / `applyExerciseSeed`
 * write paths from `../src/seed-safety.js` (the same functions
 * `prisma/seed.ts` calls) against a live PostgreSQL database.
 *
 * PENDING real-PostgreSQL proof: these tests have NOT been executed in an
 * environment with a database yet. The pure decision logic is covered by
 * seed-safety.test.ts (24 tests, executed).
 *
 * Run:  DATABASE_URL=postgresql://... npm run test --workspace @fitfusion/db
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  SeedStats,
  applyExerciseSeed,
  applyRecipeSeed,
  type ExerciseSeedInput,
  type NormalizedRecipeSeed,
} from '../src/seed-safety.js';

const prisma = new PrismaClient();
const enabled = Boolean(process.env.DATABASE_URL);

const CUISINE_NAME = 'v218 Seed Safety Test Cuisine';
const RECIPE_SLUG = 'v218-seed-safety-daal';
const EXERCISE_SLUG = 'v218-seed-safety-push-up';

function recipeSeed(cuisineId: string, kcal = 210): NormalizedRecipeSeed {
  return {
    slug: RECIPE_SLUG,
    title: 'V218 Seed Safety Daal',
    cuisineId,
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
    kcalPerServing: kcal,
    proteinPerServing: 12,
    carbsPerServing: 32,
    fatPerServing: 3,
    fiberPerServing: 8,
    declaredAllergens: [],
  };
}

function exerciseSeed(): ExerciseSeedInput {
  return {
    slug: EXERCISE_SLUG,
    name: 'V218 Seed Safety Push-Up',
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
    // NOTE: no media — the seed default. The pre-existing imported media
    // below must survive.
  };
}

describe.skipIf(!enabled)('seed safety (DB)', () => {
  let cuisineId = '';

  beforeAll(async () => {
    const cuisine = await prisma.cuisine.upsert({
      where: { name: CUISINE_NAME },
      update: {},
      create: { name: CUISINE_NAME, region: 'Test' },
    });
    cuisineId = cuisine.id;
    // Exercise with media imported from an authorized source (NOT the seed).
    await prisma.exercise.upsert({
      where: { slug: EXERCISE_SLUG },
      update: {},
      create: {
        slug: EXERCISE_SLUG,
        name: 'V218 Seed Safety Push-Up',
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
        mediaType: 'video',
        mediaUrl: 'https://authorized.example/media/v218-test.mp4',
      },
    });
  });

  afterAll(async () => {
    await prisma.recipe.deleteMany({ where: { slug: RECIPE_SLUG } });
    await prisma.exercise.deleteMany({ where: { slug: EXERCISE_SLUG } });
    await prisma.cuisine.deleteMany({ where: { name: CUISINE_NAME } });
    await prisma.$disconnect();
  });

  it('creates the recipe on first seeding', async () => {
    const stats = new SeedStats();
    const result = await applyRecipeSeed(prisma, recipeSeed(cuisineId), stats);
    expect(result.status).toBe('created');
    const row = await prisma.recipe.findUnique({ where: { slug: RECIPE_SLUG } });
    expect(row?.verified).toBe(false);
    expect(row?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.revision).toBe(0);
  });

  it('preserves verified status + evidence when re-seeding unchanged content', async () => {
    const evidence = { reviewer: 'admin@example.com', reviewedAt: '2026-10-16T00:00:00.000Z' };
    await prisma.recipe.update({
      where: { slug: RECIPE_SLUG },
      data: {
        verified: true,
        verificationEvidence: evidence,
        reviewEvidence: evidence,
      },
    });
    const stats = new SeedStats();
    const result = await applyRecipeSeed(prisma, recipeSeed(cuisineId), stats);
    expect(result.status).toBe('unchanged');
    const row = await prisma.recipe.findUnique({ where: { slug: RECIPE_SLUG } });
    // No silent downgrade: verified + evidence survive the re-run.
    expect(row?.verified).toBe(true);
    expect(row?.verificationEvidence).toEqual(evidence);
    expect(row?.reviewEvidence).toEqual(evidence);
    expect(row?.revision).toBe(0);
  });

  it('invalidates evidence + bumps revision on a material content change', async () => {
    const before = await prisma.recipe.findUnique({ where: { slug: RECIPE_SLUG } });
    const stats = new SeedStats();
    // Material change: nutrition numbers corrected in the seed data.
    const result = await applyRecipeSeed(prisma, recipeSeed(cuisineId, 250), stats);
    expect(result.status).toBe('updated');
    const row = await prisma.recipe.findUnique({ where: { slug: RECIPE_SLUG } });
    expect(row?.verified).toBe(false);
    expect(row?.verificationEvidence).toBeNull();
    expect(row?.reviewEvidence).toBeNull();
    expect(row?.revision).toBe((before?.revision ?? 0) + 1);
    expect(row?.kcalPerServing).toBe(250);
    expect(row?.allergenScreened).toBe(true);
  });

  it('is idempotent: a further re-run changes nothing', async () => {
    const stats = new SeedStats();
    const result = await applyRecipeSeed(prisma, recipeSeed(cuisineId, 250), stats);
    expect(result.status).toBe('unchanged');
    expect(stats.count('recipe', 'unchanged')).toBe(1);
  });

  it('never touches a private user recipe', async () => {
    const privateSlug = 'v218-seed-safety-private';
    await prisma.recipe.create({
      data: {
        slug: privateSlug,
        title: 'User Private Recipe',
        dietCategory: 'vegetarian',
        servings: 2,
        prepMin: 5,
        cookMin: 10,
        difficulty: 'easy',
        ingredients: [],
        instructions: [],
        kcalPerServing: 100,
        proteinPerServing: 5,
        carbsPerServing: 10,
        fatPerServing: 2,
        fiberPerServing: 1,
        source: 'user',
        verified: false,
        allergens: [],
        isPrivate: true,
      },
    });
    try {
      const stats = new SeedStats();
      const colliding = { ...recipeSeed(cuisineId), slug: privateSlug };
      const result = await applyRecipeSeed(prisma, colliding, stats);
      expect(result.status).toBe('skipped');
      const row = await prisma.recipe.findUnique({ where: { slug: privateSlug } });
      expect(row?.title).toBe('User Private Recipe');
    } finally {
      await prisma.recipe.deleteMany({ where: { slug: privateSlug } });
    }
  });

  it('preserves imported exercise media across seed runs', async () => {
    const stats = new SeedStats();
    const result = await applyExerciseSeed(prisma, exerciseSeed(), stats);
    // All non-media fields already match the seeded row.
    expect(result.status).toBe('unchanged');
    const row = await prisma.exercise.findUnique({ where: { slug: EXERCISE_SLUG } });
    expect(row?.mediaType).toBe('video');
    expect(row?.mediaUrl).toBe('https://authorized.example/media/v218-test.mp4');
  });

  it('updates exercise text fields without downgrading media', async () => {
    const stats = new SeedStats();
    const result = await applyExerciseSeed(
      prisma,
      { ...exerciseSeed(), description: 'An updated description.' },
      stats,
    );
    expect(result.status).toBe('updated');
    const row = await prisma.exercise.findUnique({ where: { slug: EXERCISE_SLUG } });
    expect(row?.description).toBe('An updated description.');
    expect(row?.mediaType).toBe('video');
    expect(row?.mediaUrl).toBe('https://authorized.example/media/v218-test.mp4');
  });
});
