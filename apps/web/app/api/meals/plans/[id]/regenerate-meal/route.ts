import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { DEFAULT_TEMPLATE_MEALS, regenerateMeal } from '@fitfusion/core';
import type { DayPlan, MealType } from '@fitfusion/core';
import { requirePlan } from '@/lib/auth';
import { computeTargets } from '@/lib/server-targets';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const RegenerateSchema = z.object({
  dayIndex: z.number().int().min(0).max(6),
  mealType: z.enum(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra']),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requirePlan(req, 'diet');
  if (s instanceof NextResponse) return s;

  const plan = await prisma.mealPlan.findFirst({
    where: { id: params.id, userId: s.user.id },
  });
  if (!plan) {
    return apiError('not_found', 'Meal plan not found', 404);
  }
  if (plan.generatedBy !== 'template') {
    return apiError(
      'unsupported',
      'Only template-generated plans support meal regeneration',
      400,
    );
  }

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = RegenerateSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }

  const targets = await computeTargets(s.user.id, s.profile);
  // NOTE: @fitfusion/core's regenerateMeal takes a single DayPlan (the day
  // to regenerate), not the whole week — adapt by splicing the result back.
  const days = plan.days as unknown as DayPlan[];
  const dayIndex = parsed.data.dayIndex;
  if (dayIndex >= days.length || !days[dayIndex]) {
    return apiError('validation_error', `dayIndex out of range for this plan`, 400);
  }
  const regenerated = regenerateMeal(
    days[dayIndex],
    dayIndex,
    parsed.data.mealType as MealType,
    DEFAULT_TEMPLATE_MEALS,
    targets.calorieTarget,
  );
  const nextDays = days.map((d, i) => (i === dayIndex ? regenerated : d));

  const updated = await prisma.mealPlan.update({
    where: { id: plan.id },
    data: { days: nextDays as object },
  });
  return apiOk({ plan: updated });
}
