import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, clampInt } from '@/lib/server-api';
import { CORRECTION_STATUSES } from '@/lib/menu-api-schema';

export const dynamic = 'force-dynamic';

/** Admin: global correction queue, newest first. */
export async function GET(req: NextRequest) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const status = req.nextUrl.searchParams.get('status') ?? 'open';
  if (!(CORRECTION_STATUSES as readonly string[]).includes(status)) {
    return apiError('validation_error', 'status must be open, accepted, or rejected', 400);
  }
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 50, 1, 200);

  const corrections = await prisma.menuCorrection.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true, email: true, name: true } },
      menuItem: {
        select: {
          id: true,
          name: true,
          kcal: true,
          nutritionStatus: true,
          restaurant: { select: { id: true, name: true } },
        },
      },
    },
  });
  return apiOk({ corrections });
}
