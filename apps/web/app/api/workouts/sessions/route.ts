import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const CreateSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  workoutPlanId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = CreateSessionSchema.safeParse(body.data ?? {});
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }

  if (parsed.data.workoutPlanId) {
    const plan = await prisma.workoutPlan.findFirst({
      where: { id: parsed.data.workoutPlanId, userId: s.user.id },
    });
    if (!plan) {
      return apiError('not_found', 'Workout plan not found', 404);
    }
  }

  const session = await prisma.workoutSession.create({
    data: {
      userId: s.user.id,
      workoutPlanId: parsed.data.workoutPlanId ?? null,
      name: parsed.data.name ?? 'Workout session',
      status: 'in_progress',
    },
  });
  return apiOk({ session }, 201);
}
