/**
 * GET /api/health/google/status — connection state for the Settings UI.
 *
 * Honest states: {connected:false} when no connection row exists (never
 * fake data), otherwise the provider, last sync time, last error, and
 * today's step count read back from the user's own Measurement rows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiOk } from '@/lib/server-api';
import { googleFitConfigured } from '@/lib/google-fit';

export const dynamic = 'force-dynamic';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const conn = await prisma.healthConnection.findUnique({
    where: { userId: s.user.id },
  });
  if (!conn) {
    return apiOk({
      connected: false,
      configured: googleFitConfigured(),
      stepsToday: null,
    });
  }
  const stepsRow = await prisma.measurement.findFirst({
    where: {
      userId: s.user.id,
      type: 'steps',
      recordedAt: { gte: startOfToday() },
    },
    orderBy: { recordedAt: 'desc' },
  });
  return apiOk({
    connected: true,
    configured: googleFitConfigured(),
    provider: conn.provider,
    lastSyncAt: conn.lastSyncAt,
    lastSyncError: conn.lastSyncError,
    stepsToday: stepsRow ? stepsRow.value : null,
  });
}
