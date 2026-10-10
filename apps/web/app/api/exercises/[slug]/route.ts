import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const exercise = await prisma.exercise.findUnique({
    where: { slug: params.slug },
  });
  if (!exercise) {
    return apiError('not_found', 'Exercise not found', 404);
  }
  return apiOk({ exercise });
}
