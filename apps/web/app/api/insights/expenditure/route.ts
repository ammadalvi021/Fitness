import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import {
  EXPENDITURE_WINDOW_DAYS,
  estimateExpenditure,
  kgFromLb,
  type ExpenditureDayInput,
} from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiOk, toDateOnly } from '@/lib/server-api';
import { computeTargets } from '@/lib/server-targets';

export const dynamic = 'force-dynamic';

/**
 * GET /api/insights/expenditure — adaptive TDEE back-solved from the last
 * 21 days of food logs + weigh-ins (MacroFactor-style).
 *
 * - `{ status: 'ok', tdeeKcal, confidence, daysUsed, windowDays,
 *     avgIntakeKcal, weightSlopeKgPerDay, currentTargetKcal, overrideActive }`
 * - `{ status: 'insufficient_data', daysAvailable, daysNeeded,
 *     windowDays, currentTargetKcal, overrideActive }`
 *
 * Days with no logged food (>0 kcal) are not counted as data — the estimate
 * only uses days with both intake and a weigh-in.
 */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (EXPENDITURE_WINDOW_DAYS - 1)));

  const [weights, entries, profile] = await Promise.all([
    prisma.measurement.findMany({
      where: {
        userId: s.user.id,
        type: 'weight',
        recordedAt: { gte: start },
      },
      orderBy: { recordedAt: 'asc' },
    }),
    prisma.diaryEntry.findMany({
      where: { userId: s.user.id, date: { gte: start } },
      select: { date: true, kcal: true },
    }),
    s.profile ??
      (await prisma.profile.upsert({
        where: { userId: s.user.id },
        update: {},
        create: { userId: s.user.id },
      })),
  ]);

  const intakeByDay = new Map<string, number>();
  for (const e of entries) {
    const key = toDateOnly(e.date);
    intakeByDay.set(key, (intakeByDay.get(key) ?? 0) + (Number.isFinite(e.kcal) ? e.kcal : 0));
  }

  const weightByDay = new Map<string, number[]>();
  for (const w of weights) {
    const unit = (w.unit ?? 'kg').toLowerCase();
    const kg = unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds' ? kgFromLb(w.value) : w.value;
    if (!Number.isFinite(kg) || kg <= 0) continue;
    const key = toDateOnly(w.recordedAt);
    const arr = weightByDay.get(key) ?? [];
    arr.push(kg);
    weightByDay.set(key, arr);
  }

  const days: ExpenditureDayInput[] = [];
  for (let i = 0; i < EXPENDITURE_WINDOW_DAYS; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = toDateOnly(d);
    const weighIns = weightByDay.get(key) ?? [];
    days.push({
      date: key,
      intakeKcal: Math.round((intakeByDay.get(key) ?? 0) * 10) / 10,
      weightKg: weighIns.length
        ? Math.round((weighIns.reduce((a, b) => a + b, 0) / weighIns.length) * 10) / 10
        : null,
    });
  }

  const result = estimateExpenditure(days, EXPENDITURE_WINDOW_DAYS);

  // The user's current daily target (respects the override if one is set),
  // so the card can compare "real burn" vs "current target".
  const targets = await computeTargets(s.user.id, profile);
  const currentTargetKcal = targets.calorieTarget;
  const overrideActive =
    typeof profile?.calorieTargetOverrideKcal === 'number' &&
    profile.calorieTargetOverrideKcal >= 1200 &&
    profile.calorieTargetOverrideKcal <= 6000;

  if (result.status === 'insufficient_data') {
    return apiOk({
      status: 'insufficient_data' as const,
      daysAvailable: result.daysAvailable,
      daysNeeded: result.daysNeeded,
      windowDays: result.windowDays,
      currentTargetKcal,
      overrideActive,
    });
  }

  return apiOk({
    status: 'ok' as const,
    tdeeKcal: result.tdeeKcal,
    avgIntakeKcal: result.avgIntakeKcal,
    weightSlopeKgPerDay: result.weightSlopeKgPerDay,
    confidence: result.confidence,
    daysUsed: result.daysUsed,
    windowDays: result.windowDays,
    currentTargetKcal,
    overrideActive,
  });
}
