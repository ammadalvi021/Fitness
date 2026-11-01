import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { sequenceDurationSeconds } from '@fitfusion/core';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Public yoga sequence catalog with pose counts and computed durations. */
export async function GET(_req: NextRequest) {
  const sequences = await prisma.yogaSequence.findMany({
    orderBy: { title: 'asc' },
    include: {
      poses: {
        select: { holdSeconds: true, side: true, transitionSeconds: true },
      },
    },
  });

  const summaries = sequences.map(({ poses, ...sequence }) => ({
    ...sequence,
    poseCount: poses.length,
    totalDurationSeconds: sequenceDurationSeconds(poses),
  }));

  return apiOk({ sequences: summaries, total: summaries.length });
}
