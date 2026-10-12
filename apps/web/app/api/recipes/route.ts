import { NextRequest, NextResponse } from 'next/server';
import { prisma, type Prisma } from '@fitfusion/db';
import { CustomRecipeSchema } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, clampInt, readJson, zodMessage } from '@/lib/server-api';
import { recipeNutrition, resolveIngredientRows, toInstructionSteps } from './custom-recipe';

export const dynamic = 'force-dynamic';

/**
 * Recipe browsing.
 * - Public curated browsing with filters (unchanged): q, cuisine, diet, tag,
 *   maxKcal, page, limit. Private user recipes are excluded here.
 * - `mine=1` (authenticated): lists the caller's private custom recipes.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mine = sp.get('mine') === '1';

  if (mine) {
    const s = await requireUser(req);
    if (s instanceof NextResponse) return s;
    const recipes = await prisma.recipe.findMany({
      where: { userId: s.user.id, isPrivate: true },
      orderBy: { updatedAt: 'desc' },
    });
    return apiOk({ recipes });
  }

  const q = (sp.get('q') ?? '').trim();
  const cuisine = (sp.get('cuisine') ?? '').trim();
  const diet = (sp.get('diet') ?? '').trim().toLowerCase();
  const tag = (sp.get('tag') ?? '').trim().toLowerCase();
  const maxKcal = sp.get('maxKcal') ? Number(sp.get('maxKcal')) : undefined;
  const limit = clampInt(sp.get('limit'), 20, 1, 100);
  const page = clampInt(sp.get('page'), 1, 1, 1000);

  if (diet && diet !== 'vegetarian' && diet !== 'non_vegetarian') {
    return apiError('validation_error', 'diet must be vegetarian or non_vegetarian', 400);
  }

  const and: object[] = [];
  if (q) and.push({ title: { contains: q, mode: 'insensitive' } });
  if (diet) and.push({ dietCategory: diet });
  if (maxKcal !== undefined && Number.isFinite(maxKcal)) and.push({ kcalPerServing: { lte: maxKcal } });
  if (cuisine) and.push({ cuisine: { name: { equals: cuisine, mode: 'insensitive' } } });
  // Private user recipes never leak into public browsing.
  and.push({ isPrivate: false });

  const all = await prisma.recipe.findMany({
    where: and.length ? { AND: and } : undefined,
    include: { cuisine: { select: { id: true, name: true } } },
    orderBy: { title: 'asc' },
    take: 500,
  });
  const filtered = tag
    ? all.filter((r) => r.tags.some((t) => t.toLowerCase().includes(tag)))
    : all;
  const total = filtered.length;
  const recipes = filtered.slice((page - 1) * limit, page * limit);

  return apiOk({ recipes, page, limit, total });
}

/**
 * Create a private custom recipe.
 * Body: { name, ingredients: [{foodId?, name, grams, kcal?, proteinG?,
 *   carbsG?, fatG?, fiberG?}] (nutrients per 100 g), yieldGrams?, portions,
 *   instructions?, dietCategory?, prepMin?, cookMin?, difficulty? }
 *
 * The server computes totals from ingredient nutrients × grams and stores
 * per-portion values. Water rows contribute 0 kcal. Diary entries keep
 * snapshotting nutrients at log time, so later catalogue edits never
 * rewrite a user's recipe history.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = CustomRecipeSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid recipe', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;

  const { rows, missingFood } = await resolveIngredientRows(input.ingredients);
  if (missingFood) {
    return apiError('food_not_found', `Food not found for ingredient "${missingFood}"`, 404);
  }
  const { perPortion } = recipeNutrition(rows, input.portions);
  const slug =
    `u${s.user.id.replace(/[^a-z0-9]/gi, '').slice(-6)}-` +
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const recipe = await prisma.recipe.create({
    data: {
      slug,
      title: input.name.trim(),
      dietCategory: input.dietCategory ?? 'vegetarian',
      tags: [],
      servings: input.portions,
      prepMin: input.prepMin ?? 0,
      cookMin: input.cookMin ?? 0,
      difficulty: input.difficulty ?? 'easy',
      ingredients: rows as unknown as Prisma.InputJsonValue,
      instructions: toInstructionSteps(input.instructions),
      kcalPerServing: perPortion.kcal,
      proteinPerServing: perPortion.proteinG,
      carbsPerServing: perPortion.carbsG,
      fatPerServing: perPortion.fatG,
      fiberPerServing: perPortion.fiberG,
      source: 'user',
      verified: false,
      allergens: [],
      userId: s.user.id,
      isPrivate: true,
      yieldGrams: input.yieldGrams ?? null,
    },
  });
  return apiOk({ recipe }, 201);
}
