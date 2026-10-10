import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { DiaryEntrySchema, normalizeIdempotencyKey, scaleNutrients, sumNutrients, roundNutrients } from '@fitfusion/core';
import type { Nutrients } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, parseDateOnly, readJson, toDateOnly, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

function foodNutrients(food: {
  kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number;
}): Nutrients {
  return {
    kcal: food.kcal,
    proteinG: food.proteinG,
    carbsG: food.carbsG,
    fatG: food.fatG,
    fiberG: food.fiberG,
  };
}

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const dateParam = req.nextUrl.searchParams.get('date');
  const date = parseDateOnly(dateParam) ?? parseDateOnly(toDateOnly(new Date()));
  if (!date) {
    return apiError('validation_error', 'date must be YYYY-MM-DD', 400);
  }
  const entries = await prisma.diaryEntry.findMany({
    where: { userId: s.user.id, date },
    orderBy: { createdAt: 'asc' },
    include: { food: { select: { id: true, name: true, servingUnit: true } } },
  });
  const totals = roundNutrients(
    sumNutrients(
      entries.map((e) => ({
        kcal: e.kcal, proteinG: e.proteinG, carbsG: e.carbsG, fatG: e.fatG, fiberG: e.fiberG,
      })),
    ),
  );
  return apiOk({ date: toDateOnly(date), entries, totals });
}

export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  // Idempotency: a repeated POST with the same key returns the original row.
  const headerKey = req.headers.get('Idempotency-Key');
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = DiaryEntrySchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid diary entry', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;
  const idempotencyKey =
    normalizeIdempotencyKey(headerKey) ?? normalizeIdempotencyKey(input.idempotencyKey ?? null);

  if (idempotencyKey) {
    const existing = await prisma.diaryEntry.findUnique({
      where: { userId_idempotencyKey: { userId: s.user.id, idempotencyKey } },
    });
    if (existing) {
      return apiOk({ entry: existing, idempotentReplay: true }, 200);
    }
  }

  if (!input.foodId && !input.customName) {
    return apiError('validation_error', 'Either foodId or customName is required', 400);
  }

  // Never trust client totals: recompute from the Food when a foodId is given.
  let nutrients: Nutrients;
  let source = 'manual';
  if (input.foodId) {
    const food = await prisma.food.findUnique({ where: { id: input.foodId } });
    if (!food) {
      return apiError('food_not_found', 'Food not found', 404);
    }
    nutrients = roundNutrients(scaleNutrients(foodNutrients(food), 1, input.servings));
  } else {
    nutrients = {
      kcal: input.kcal,
      proteinG: input.proteinG ?? 0,
      carbsG: input.carbsG ?? 0,
      fatG: input.fatG ?? 0,
      fiberG: input.fiberG ?? 0,
    };
  }

  const date = parseDateOnly(input.date);
  if (!date) {
    return apiError('validation_error', 'date must be YYYY-MM-DD', 400);
  }

  const entry = await prisma.diaryEntry.create({
    data: {
      userId: s.user.id,
      date,
      mealType: input.mealType,
      foodId: input.foodId ?? null,
      customName: input.customName ?? null,
      servings: input.servings,
      kcal: nutrients.kcal,
      proteinG: nutrients.proteinG,
      carbsG: nutrients.carbsG,
      fatG: nutrients.fatG,
      fiberG: nutrients.fiberG,
      source,
      idempotencyKey,
    },
  });
  return apiOk({ entry }, 201);
}
