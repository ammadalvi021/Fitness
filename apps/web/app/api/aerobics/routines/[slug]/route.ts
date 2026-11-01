import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { routineDurationSeconds } from '@fitfusion/core';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const PHASE_ORDER: Record<string, number> = { warmup: 0, main: 1, cooldown: 2 };

/** Full aerobics routine detail: steps ordered by phase, then step order. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const routine = await prisma.aerobicRoutine.findUnique({
    where: { slug: params.slug },
    include: { steps: true },
  });
  if (!routine) {
    return apiError('not_found', 'Aerobics routine not found', 404);
  }

  const { steps, ...rest } = routine;
  const orderedSteps = [...steps].sort(
    (a, b) =>
      (PHASE_ORDER[a.phase] ?? 99) - (PHASE_ORDER[b.phase] ?? 99) ||
      a.order - b.order,
  );

  return apiOk({
    routine: {
      ...rest,
      steps: orderedSteps,
      stepCount: orderedSteps.length,
      totalDurationSeconds: routineDurationSeconds(orderedSteps),
    },
  });
}
