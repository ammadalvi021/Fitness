import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { estimateCaloriesKcal } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Convert a weight Measurement to kilograms (V22 guided-session calories).
 * "kg" is taken as-is; "lb"/"lbs" convert at 0.453592 kg per pound; any
 * other unit is treated as "no usable weight" — never guessed.
 */
function weightKgFromMeasurement(m: { value: number; unit: string }): number | null {
  const unit = (m.unit || '').trim().toLowerCase();
  if (unit === 'kg' || unit === 'kgs') return m.value;
  if (unit === 'lb' || unit === 'lbs') return m.value * 0.453592;
  return null;
}

/**
 * Server-side MET calorie estimate for a completed guided session.
 * Computed only from server-held data (sequence/routine MET value + the
 * user's latest weight measurement) — a client can never supply or
 * influence the figure beyond its active duration. Returns null when the
 * source or a usable weight is missing.
 */
async function guidedCalorieEstimate(
  session: { kind: string; sourceSlug: string | null; userId: string },
  durationSeconds: number,
): Promise<number | null> {
  if (!session.sourceSlug || !(durationSeconds > 0)) return null;
  let metValue: number | null = null;
  if (session.kind === 'yoga') {
    const sequence = await prisma.yogaSequence.findUnique({
      where: { slug: session.sourceSlug },
      select: { metValue: true },
    });
    metValue = sequence?.metValue ?? null;
  } else if (session.kind === 'aerobics') {
    const routine = await prisma.aerobicRoutine.findUnique({
      where: { slug: session.sourceSlug },
      select: { metValue: true },
    });
    metValue = routine?.metValue ?? null;
  }
  if (metValue === null) return null;

  const latestWeight = await prisma.measurement.findFirst({
    where: { userId: session.userId, type: 'weight' },
    orderBy: { recordedAt: 'desc' },
    select: { value: true, unit: true },
  });
  if (!latestWeight) return null;
  const weightKg = weightKgFromMeasurement(latestWeight);
  if (weightKg === null) return null;
  return estimateCaloriesKcal({ met: metValue, weightKg, durationSeconds });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const session = await prisma.workoutSession.findFirst({
    where: { id: params.id, userId: s.user.id },
    include: { logs: { include: { exercise: true } } },
  });
  if (!session) {
    return apiError('not_found', 'Workout session not found', 404);
  }
  return apiOk({ session });
}

const PatchSessionSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'cancelled']).optional(),
  endedAt: z.coerce.date().optional(),
  name: z.string().min(1).max(100).optional(),
  // V22 Phase B (guided sessions): active duration reported by the guided
  // player on completion. Applied ONLY to guided (yoga/aerobics) sessions
  // being marked completed; ignored entirely for strength sessions.
  // Deliberately NO client-supplied calorie field — estimates are computed
  // server-side in guidedCalorieEstimate().
  durationSeconds: z.number().int().min(1).max(21600).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const existing = await prisma.workoutSession.findFirst({
    where: { id: params.id, userId: s.user.id },
  });
  if (!existing) {
    return apiError('not_found', 'Workout session not found', 404);
  }
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = PatchSessionSchema.safeParse(body.data ?? {});
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.status !== undefined) {
    data.status = parsed.data.status;
    if (parsed.data.status === 'completed' && !parsed.data.endedAt && !existing.endedAt) {
      data.endedAt = new Date();
    }
  }
  if (parsed.data.endedAt !== undefined) data.endedAt = parsed.data.endedAt;

  // V22 Phase B: guided completion bookkeeping. Only for yoga/aerobics
  // sessions being marked completed — strength sessions never enter here,
  // so their durationSeconds/caloriesEstimateKcal stay exactly as before.
  const isGuided = existing.kind === 'yoga' || existing.kind === 'aerobics';
  if (isGuided && parsed.data.status === 'completed') {
    const endedAt =
      (data.endedAt as Date | undefined) ?? existing.endedAt ?? new Date();
    const durationSeconds =
      parsed.data.durationSeconds ??
      Math.max(0, Math.floor((endedAt.getTime() - existing.startedAt.getTime()) / 1000));
    data.durationSeconds = durationSeconds;
    data.caloriesEstimateKcal = await guidedCalorieEstimate(existing, durationSeconds);
  }

  const session = await prisma.workoutSession.update({
    where: { id: existing.id },
    data,
    include: { logs: true },
  });
  return apiOk({ session });
}
