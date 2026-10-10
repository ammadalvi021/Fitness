import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 10, 1, 50);
  const plans = await prisma.mealPlan.findMany({
    where: { userId: s.user.id },
    orderBy: { weekStart: 'desc' },
    take: limit,
  });
  return apiOk({ plans });
}
