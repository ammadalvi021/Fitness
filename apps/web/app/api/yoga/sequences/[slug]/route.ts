import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { sequenceDurationSeconds } from '@fitfusion/core';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Full yoga sequence detail: ordered poses with full pose content. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const sequence = await prisma.yogaSequence.findUnique({
    where: { slug: params.slug },
    include: {
      poses: {
        orderBy: { order: 'asc' },
        include: { pose: true },
      },
    },
  });
  if (!sequence) {
    return apiError('not_found', 'Yoga sequence not found', 404);
  }

  const { poses, ...rest } = sequence;
  const orderedPoses = poses.map((sp) => ({
    order: sp.order,
    holdSeconds: sp.holdSeconds,
    side: sp.side,
    transitionSeconds: sp.transitionSeconds,
    cue: sp.cue,
    pose: sp.pose,
  }));

  return apiOk({
    sequence: {
      ...rest,
      poses: orderedPoses,
      poseCount: orderedPoses.length,
      totalDurationSeconds: sequenceDurationSeconds(poses),
    },
  });
}
