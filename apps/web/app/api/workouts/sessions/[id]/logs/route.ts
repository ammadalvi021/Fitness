import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const LogSchema = z.object({
  exerciseId: z.string().min(1),
  sets: z.array(z.record(z.any())).min(1).max(50),
  notes: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const session = await prisma.workoutSession.findFirst({
    where: { id: params.id, userId: s.user.id },
  });
  if (!session) {
    return apiError('not_found', 'Workout session not found', 404);
  }
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = LogSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid workout log', 400, zodMessage(parsed.error));
  }
  const exercise = await prisma.exercise.findUnique({
    where: { id: parsed.data.exerciseId },
  });
  if (!exercise) {
    return apiError('exercise_not_found', 'Exercise not found', 404);
  }
  const log = await prisma.workoutLog.create({
    data: {
      sessionId: session.id,
      exerciseId: exercise.id,
      sets: parsed.data.sets,
      notes: parsed.data.notes ?? null,
    },
  });
  return apiOk({ log }, 201);
}
