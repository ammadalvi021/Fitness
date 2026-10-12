import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, clampInt, parseDateOnly, readJson, toDateOnly } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 50, 1, 100);
  const favorites = await prisma.favoriteMeal.findMany({
    where: { userId: s.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return apiOk({ favorites });
}

/**
 * V18 Phase E: save a day's logged meal as a favourite.
 * Body: { name: string, date: "YYYY-MM-DD" }.
 * Snapshots the day's diary entries (foodId/customName/servings/mealType)
 * into items and stores the day's totals as the favourite's nutrition.
 * Idempotent: same name returns the existing record.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const dateStr = typeof data.date === 'string' ? data.date : '';
  if (!name || name.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return apiError('validation_error', 'name (1-100 chars) and date (YYYY-MM-DD) are required', 400);
  }

  const existing = await prisma.favoriteMeal.findFirst({
    where: { userId: s.user.id, name },
  });
  if (existing) {
    return apiOk({ favorite: existing, favorited: true }, 200);
  }

  const date = parseDateOnly(dateStr) ?? parseDateOnly(toDateOnly(new Date()));
  const entries = await prisma.diaryEntry.findMany({
    where: { userId: s.user.id, date: date! },
    orderBy: { createdAt: 'asc' },
    include: { food: { select: { id: true, name: true } } },
  });
  if (entries.length === 0) {
    return apiError('validation_error', 'No diary entries on that date to save', 400);
  }

  const items = entries.map((e) => ({
    mealType: e.mealType,
    foodId: e.foodId,
    customName: e.customName ?? e.food?.name ?? null,
    servings: e.servings,
    // Snapshot for honest re-logging of manual entries (foodId entries
    // re-snapshot server-side at log time).
    kcal: e.kcal,
    proteinG: e.proteinG,
    carbsG: e.carbsG,
    fatG: e.fatG,
    fiberG: e.fiberG,
  }));
  const totals = items.reduce(
    (t, i) => ({
      kcal: t.kcal + i.kcal,
      proteinG: t.proteinG + i.proteinG,
      carbsG: t.carbsG + i.carbsG,
      fatG: t.fatG + i.fatG,
      fiberG: t.fiberG + i.fiberG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  );

  const favorite = await prisma.favoriteMeal.create({
    data: {
      userId: s.user.id,
      name,
      items,
      kcal: totals.kcal,
      proteinG: totals.proteinG,
      carbsG: totals.carbsG,
      fatG: totals.fatG,
      fiberG: totals.fiberG,
    },
  });
  return apiOk({ favorite, favorited: true }, 201);
}
