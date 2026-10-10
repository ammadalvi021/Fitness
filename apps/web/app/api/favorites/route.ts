import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 50, 1, 100);
  const favorites = await prisma.favoriteMeal.findMany({
    where: { userId: s.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return apiOk({ favorites });
}
