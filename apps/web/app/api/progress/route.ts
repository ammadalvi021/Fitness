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
      select: {
        startedAt: true,
        status: true,
        kind: true,
        durationSeconds: true,
        caloriesEstimateKcal: true,
      },
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
  const activeSecondsByDay = new Map<string, number>();
  for (const w of sessions) {
    const key = toDateOnly(w.startedAt);
    workoutsByDay.set(key, (workoutsByDay.get(key) ?? 0) + 1);
    if (w.status === 'completed' && w.durationSeconds != null) {
      activeSecondsByDay.set(
        key,
        (activeSecondsByDay.get(key) ?? 0) + w.durationSeconds,
      );
    }
  }

  // Phase D (additive): active minutes / estimated calories from COMPLETED
  // sessions only. durationSeconds null contributes nothing; a null
  // caloriesEstimateKcal counts as 0 and is never estimated retroactively.
  // WorkoutSession.kind defaults to "strength" in the schema; any
  // unexpected kind value is normalised into the strength bucket.
  const roundMinutes = (seconds: number): number =>
    Math.round((seconds / 60) * 10) / 10;
  type KindKey = 'strength' | 'yoga' | 'aerobics';
  const kindKey = (kind: string): KindKey =>
    kind === 'yoga' || kind === 'aerobics' ? kind : 'strength';
  const byKindAcc: Record<
    KindKey,
    { sessions: number; completed: number; seconds: number; kcal: number }
  > = {
    strength: { sessions: 0, completed: 0, seconds: 0, kcal: 0 },
    yoga: { sessions: 0, completed: 0, seconds: 0, kcal: 0 },
    aerobics: { sessions: 0, completed: 0, seconds: 0, kcal: 0 },
  };
  let totalCompletedSeconds = 0;
  let totalCompletedKcal = 0;
  for (const w of sessions) {
    const bucket = byKindAcc[kindKey(w.kind)];
    bucket.sessions += 1;
    if (w.status === 'completed') {
      bucket.completed += 1;
      const secs = w.durationSeconds ?? 0;
      const kcal = w.caloriesEstimateKcal ?? 0;
      bucket.seconds += secs;
      bucket.kcal += kcal;
      totalCompletedSeconds += secs;
      totalCompletedKcal += kcal;
    }
  }
  const byKind = {
    strength: {
      sessions: byKindAcc.strength.sessions,
      completed: byKindAcc.strength.completed,
      activeMinutes: roundMinutes(byKindAcc.strength.seconds),
      estimatedCaloriesKcal: Math.round(byKindAcc.strength.kcal),
    },
    yoga: {
      sessions: byKindAcc.yoga.sessions,
      completed: byKindAcc.yoga.completed,
      activeMinutes: roundMinutes(byKindAcc.yoga.seconds),
      estimatedCaloriesKcal: Math.round(byKindAcc.yoga.kcal),
    },
    aerobics: {
      sessions: byKindAcc.aerobics.sessions,
      completed: byKindAcc.aerobics.completed,
      activeMinutes: roundMinutes(byKindAcc.aerobics.seconds),
      estimatedCaloriesKcal: Math.round(byKindAcc.aerobics.kcal),
    },
  };

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
      activeMinutes: roundMinutes(totalCompletedSeconds),
      estimatedCaloriesKcal: Math.round(totalCompletedKcal),
      byKind,
      byDay: [...workoutsByDay.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, count]) => ({
          date,
          count,
          activeMinutes: roundMinutes(activeSecondsByDay.get(date) ?? 0),
        })),
    },
    waterByDay: water.map((w) => ({ date: toDateOnly(w.date), ml: w.ml })),
  });
}
