/**
 * DELETE /api/health/google/disconnect — remove the Google Fit connection.
 *
 * Deletes the HealthConnection row (cascade on user delete is a backstop).
 * The encrypted tokens are destroyed with the row; the already-imported
 * Measurement rows stay — they are the user's own health data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  await prisma.healthConnection.deleteMany({ where: { userId: s.user.id } });
  return apiOk({ connected: false });
}
