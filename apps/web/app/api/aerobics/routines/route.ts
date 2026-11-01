import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { routineDurationSeconds } from '@fitfusion/core';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Public aerobics routine catalog with step counts, durations and phases. */
export async function GET(_req: NextRequest) {
  const routines = await prisma.aerobicRoutine.findMany({
    orderBy: { title: 'asc' },
    include: {
      steps: { select: { durationSeconds: true, phase: true } },
    },
  });

  const summaries = routines.map(({ steps, ...routine }) => ({
    ...routine,
    stepCount: steps.length,
    totalDurationSeconds: routineDurationSeconds(steps),
    phases: {
      warmup: steps.filter((s) => s.phase === 'warmup').length,
      main: steps.filter((s) => s.phase === 'main').length,
      cooldown: steps.filter((s) => s.phase === 'cooldown').length,
    },
  }));

  return apiOk({ routines: summaries, total: summaries.length });
}
