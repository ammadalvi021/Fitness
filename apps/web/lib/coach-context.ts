/**
 * Coach context builder: a short summary from the profile + recent diary +
 * recent workouts. Personal data is included only when the user has not
 * opted out (Consent type "coach_personalization", granted=false excludes).
 */
import { prisma } from '@fitfusion/db';
import type { Profile } from '@fitfusion/db';
import { roundNutrients, sumNutrients } from '@fitfusion/core';
import { toDateOnly } from './server-api';

export async function buildCoachContext(
  userId: string,
  profile: Profile | null,
): Promise<string> {
  const consent = await prisma.consent.findFirst({
    where: { userId, type: 'coach_personalization' },
    orderBy: { grantedAt: 'desc' },
  });
  if (consent && consent.granted === false) {
    return '';
  }

  const parts: string[] = [];
  if (profile) {
    const bits: string[] = [];
    if (profile.goal) bits.push(`goal: ${profile.goal}`);
    if (profile.dietPreference) bits.push(`diet: ${profile.dietPreference}`);
    if (profile.allergies.length) bits.push(`allergies: ${profile.allergies.join(', ')}`);
    if (profile.activityLevel) bits.push(`activity: ${profile.activityLevel}`);
    if (bits.length) parts.push(`Profile — ${bits.join('; ')}.`);
  }

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const entries = await prisma.diaryEntry.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { kcal: true, proteinG: true, carbsG: true, fatG: true, date: true },
  });
  if (entries.length > 0) {
    const totals = roundNutrients(
      sumNutrients(
        entries.map((e) => ({
          kcal: e.kcal, proteinG: e.proteinG, carbsG: e.carbsG, fatG: e.fatG, fiberG: 0,
        })),
      ),
    );
    const days = new Set(entries.map((e) => toDateOnly(e.date))).size;
    parts.push(
      `Last 7 days: ${entries.length} logged meals across ${days} day(s), ~${Math.round(totals.kcal)} kcal total (${Math.round(totals.proteinG)}g protein).`,
    );
  }

  const workoutCount = await prisma.workoutSession.count({
    where: { userId, startedAt: { gte: since } },
  });
  parts.push(`Workouts in the last 7 days: ${workoutCount}.`);

  const latestWeight = await prisma.measurement.findFirst({
    where: { userId, type: 'weight' },
    orderBy: { recordedAt: 'desc' },
  });
  if (latestWeight) {
    parts.push(`Latest weight: ${latestWeight.value} ${latestWeight.unit}.`);
  }

  return parts.join(' ');
}
