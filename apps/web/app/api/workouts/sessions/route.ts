import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const CreateSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  workoutPlanId: z.string().min(1).optional(),
  // V22 Phase B/C (guided sessions): additive. Defaults to "strength", which
  // keeps the pre-V22 request/response behaviour byte-for-byte identical.
  // "yoga" (Phase B) and "aerobics" (Phase C) are the guided kinds; PATCH
  // completion already handles both guided kinds.
  kind: z.enum(['strength', 'yoga', 'aerobics']).default('strength'),
  sourceSlug: z.string().min(1).max(100).optional(),
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

  // Guided sessions must reference a real seeded source: yoga sessions a
  // yoga sequence, aerobics sessions (Phase C) an aerobics routine. The
  // session name defaults to the source's title.
  let guidedName: string | null = null;
  if (parsed.data.kind === 'yoga') {
    if (!parsed.data.sourceSlug) {
      return apiError(
        'validation_error',
        'Invalid request',
        400,
        'sourceSlug is required for guided sessions',
      );
    }
    const sequence = await prisma.yogaSequence.findUnique({
      where: { slug: parsed.data.sourceSlug },
      select: { title: true },
    });
    if (!sequence) {
      return apiError('not_found', 'Yoga sequence not found', 404);
    }
    guidedName = sequence.title;
  } else if (parsed.data.kind === 'aerobics') {
    if (!parsed.data.sourceSlug) {
      return apiError(
        'validation_error',
        'Invalid request',
        400,
        'sourceSlug is required for guided sessions',
      );
    }
    const routine = await prisma.aerobicRoutine.findUnique({
      where: { slug: parsed.data.sourceSlug },
      select: { title: true },
    });
    if (!routine) {
      return apiError('not_found', 'Aerobics routine not found', 404);
    }
    guidedName = routine.title;
  }

  const session = await prisma.workoutSession.create({
    data: {
      userId: s.user.id,
      workoutPlanId: parsed.data.workoutPlanId ?? null,
      name: parsed.data.name ?? guidedName ?? 'Workout session',
      status: 'in_progress',
      kind: parsed.data.kind,
      sourceSlug:
        parsed.data.kind === 'yoga' || parsed.data.kind === 'aerobics'
          ? parsed.data.sourceSlug
          : null,
    },
  });
  return apiOk({ session }, 201);
}
