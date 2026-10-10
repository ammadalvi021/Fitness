import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Save a curated recipe as a favorite meal (nutrition stored per serving).
 * Idempotent: favoriting twice returns the existing record.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const s = await requireUser(_req);
  if (s instanceof NextResponse) return s;

  const recipe =
    (await prisma.recipe.findUnique({ where: { id: params.slug } })) ??
    (await prisma.recipe.findUnique({ where: { slug: params.slug } }));
  if (!recipe) {
    return apiError('not_found', 'Recipe not found', 404);
  }

  const existing = await prisma.favoriteMeal.findFirst({
    where: { userId: s.user.id, name: recipe.title },
  });
  if (existing) {
    return apiOk({ favorite: existing, favorited: true });
  }

  const favorite = await prisma.favoriteMeal.create({
    data: {
      userId: s.user.id,
      name: recipe.title,
      items: {
        recipeId: recipe.id,
        slug: recipe.slug,
        servings: recipe.servings,
        perServing: true,
      },
      kcal: recipe.kcalPerServing,
      proteinG: recipe.proteinPerServing,
      carbsG: recipe.carbsPerServing,
      fatG: recipe.fatPerServing,
      fiberG: recipe.fiberPerServing,
    },
  });
  return apiOk({ favorite, favorited: true }, 201);
}
