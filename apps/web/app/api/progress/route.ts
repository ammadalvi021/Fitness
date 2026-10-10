import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { roundNutrients, sumNutrients } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiOk, clampInt, toDateOnly } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/progress?days=30 — weights, per-day nutrition, workout counts,
 * and per-day water for the last N days.
 */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const days = clampInt(req.nextUrl.searchParams.get('days'), 30, 1, 365);
  const start = new Date(Date.now() - days * 24 * 3600 * 1000);

  const [weights, entries, sessions, water] = await Promise.all([
    prisma.measurement.findMany({
      where: { userId: s.user.id, type: 'weight', recordedAt: { gte: start } },
      orderBy: { recordedAt: 'asc' },
    }),
    prisma.diaryEntry.findMany({
      where: { userId: s.user.id, date: { gte: start } },
      select: { date: true, kcal: true, proteinG: true, carbsG: true, fatG: true, fiberG: true },
    }),
    prisma.workoutSession.findMany({
      where: { userId: s.user.id, startedAt: { gte: start } },
      select: { startedAt: true, status: true },
    }),
    prisma.waterLog.findMany({
      where: { userId: s.user.id, date: { gte: start } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const nutritionByDay = new Map<string, { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number }>();
  for (const e of entries) {
    const key = toDateOnly(e.date);
    const cur = nutritionByDay.get(key) ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
    const summed = sumNutrients([cur, e]);
    nutritionByDay.set(key, summed);
  }

  const workoutsByDay = new Map<string, number>();
  for (const w of sessions) {
    const key = toDateOnly(w.startedAt);
    workoutsByDay.set(key, (workoutsByDay.get(key) ?? 0) + 1);
  }

  return apiOk({
    days,
    weights: weights.map((w) => ({
      date: toDateOnly(w.recordedAt),
      value: w.value,
      unit: w.unit,
      recordedAt: w.recordedAt,
    })),
    nutritionByDay: [...nutritionByDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, n]) => ({ date, ...roundNutrients(n) })),
    workouts: {
      total: sessions.length,
      completed: sessions.filter((w) => w.status === 'completed').length,
      byDay: [...workoutsByDay.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, count]) => ({ date, count })),
    },
    waterByDay: water.map((w) => ({ date: toDateOnly(w.date), ml: w.ml })),
  });
}
