import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, clampInt, zodMessage } from '@/lib/server-api';
import { MENU_SUBMISSION_STATUSES } from '@/lib/menu-api-schema';

export const dynamic = 'force-dynamic';

/**
 * Admin: menu-submission review queue (v21.8 P2).
 *
 * Customer menu-photo confirmations are stored as private MenuSubmission
 * rows with status 'pending'. This queue is the only path to publication:
 * pending submissions never appear in GET /api/restaurants/[id]/menu.
 */
export async function GET(req: NextRequest) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  if (!(MENU_SUBMISSION_STATUSES as readonly string[]).includes(status)) {
    return apiError('validation_error', 'status must be pending, approved, or rejected', 400);
  }
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 50, 1, 200);

  const submissions = await prisma.menuSubmission.findMany({
    where: { status },
    orderBy: { submittedAt: 'asc' },
    take: limit,
    include: {
      submitter: { select: { id: true, email: true, name: true } },
      restaurant: { select: { id: true, name: true } },
    },
  });
  return apiOk({ submissions });
}
