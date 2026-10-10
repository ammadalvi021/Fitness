import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

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

  const session = await prisma.workoutSession.update({
    where: { id: existing.id },
    data,
    include: { logs: true },
  });
  return apiOk({ session });
}
