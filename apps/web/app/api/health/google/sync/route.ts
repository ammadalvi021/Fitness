/**
 * POST /api/health/google/sync — manual "Sync now".
 *
 * Refreshes the access token when expired, then pulls the last 7 days of
 * daily step counts and the latest body weight from Google Fitness and
 * upserts them into the user's existing Measurement rows:
 *   - steps  → type "steps", unit "steps", one row per day (no duplicates)
 *   - weight → type "weight", unit "kg", note "Imported from Google Fit"
 *
 * Empty responses are honest: no rows are created and the response says
 * so. Automatic daily sync requires an external cron hitting this endpoint
 * with a session — see docs/health-sync.md (not built in-app).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk } from '@/lib/server-api';
import {
  FitApiError,
  fetchDailySteps,
  fetchLatestWeight,
  googleFitConfigured,
  openAccessToken,
  openRefreshToken,
  refreshAccessToken,
  sealTokens,
} from '@/lib/google-fit';

export const dynamic = 'force-dynamic';

const STEP_IMPORT_DAYS = 7;
const REFRESH_SKEW_MS = 60_000;

async function recordSyncError(userId: string, message: string) {
  await prisma.healthConnection
    .update({ where: { userId }, data: { lastSyncError: message } })
    .catch(() => {});
}

export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  if (!googleFitConfigured()) {
    return apiError('not_configured', 'Google Fit sync is not configured on this server.', 503);
  }
  const conn = await prisma.healthConnection.findUnique({
    where: { userId: s.user.id },
  });
  if (!conn) {
    return apiError('not_connected', 'Google Fit is not connected.', 404);
  }

  // --- resolve a valid access token (refresh when expired) ----------------
  let accessToken: string;
  try {
    if (conn.accessTokenExpiresAt.getTime() - Date.now() < REFRESH_SKEW_MS) {
      const refreshToken = openRefreshToken(conn.refreshTokenEnc);
      if (!refreshToken) {
        await recordSyncError(s.user.id, 'Refresh token missing — please reconnect.');
        return apiError(
          'needs_reconnect',
          'The Google Fit connection lost its refresh token. Please disconnect and reconnect.',
          409,
        );
      }
      const refreshed = await refreshAccessToken(refreshToken);
      const sealed = sealTokens(refreshed);
      accessToken = refreshed.accessToken;
      await prisma.healthConnection.update({
        where: { userId: s.user.id },
        data: {
          accessTokenEnc: sealed.accessTokenEnc,
          ...(sealed.refreshTokenEnc ? { refreshTokenEnc: sealed.refreshTokenEnc } : {}),
          accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
          lastSyncError: null,
        },
      });
    } else {
      accessToken = openAccessToken(conn.accessTokenEnc);
    }
  } catch (err) {
    console.error('[health/google/sync] token refresh failed', err);
    await recordSyncError(s.user.id, 'Token refresh failed — please reconnect.');
    return apiError('sync_failed', 'Could not refresh the Google Fit connection. Try disconnecting and reconnecting.', 502);
  }

  // --- pull from Google Fitness ------------------------------------------
  let days: Array<{ dayStartMs: number; steps: number }>;
  let weight: { dayStartMs: number; kg: number } | null;
  try {
    [days, weight] = await Promise.all([
      fetchDailySteps(accessToken, STEP_IMPORT_DAYS),
      fetchLatestWeight(accessToken),
    ]);
  } catch (err) {
    const message = err instanceof FitApiError ? err.message : 'Google Fitness request failed';
    console.error('[health/google/sync] fitness fetch failed', err);
    await recordSyncError(s.user.id, message);
    return apiError('sync_failed', 'Google Fitness did not return data. Please try again later.', 502);
  }

  // --- upsert steps: one row per day, update on re-sync -------------------
  const dayMs = 24 * 60 * 60 * 1000;
  let stepsUpserted = 0;
  for (const d of days) {
    const start = new Date(d.dayStartMs);
    const end = new Date(d.dayStartMs + dayMs);
    const existing = await prisma.measurement.findFirst({
      where: { userId: s.user.id, type: 'steps', recordedAt: { gte: start, lt: end } },
    });
    if (existing) {
      if (existing.value !== d.steps) {
        await prisma.measurement.update({ where: { id: existing.id }, data: { value: d.steps } });
        stepsUpserted += 1;
      }
    } else {
      await prisma.measurement.create({
        data: {
          userId: s.user.id,
          type: 'steps',
          value: d.steps,
          unit: 'steps',
          recordedAt: start,
          note: 'Imported from Google Fit',
        },
      });
      stepsUpserted += 1;
    }
  }

  // --- weight: import the latest reading once (skip if already imported) --
  let weightImported = false;
  if (weight) {
    const readingAt = new Date(weight.dayStartMs);
    const existing = await prisma.measurement.findFirst({
      where: {
        userId: s.user.id,
        type: 'weight',
        note: 'Imported from Google Fit',
        recordedAt: { gte: readingAt },
      },
    });
    if (!existing) {
      await prisma.measurement.create({
        data: {
          userId: s.user.id,
          type: 'weight',
          value: weight.kg,
          unit: 'kg',
          recordedAt: readingAt,
          note: 'Imported from Google Fit',
        },
      });
      weightImported = true;
    }
  }

  await prisma.healthConnection.update({
    where: { userId: s.user.id },
    data: { lastSyncAt: new Date(), lastSyncError: null },
  });

  return apiOk({
    imported: {
      stepDays: days.length,
      stepsUpserted,
      weightKg: weight ? weight.kg : null,
      weightImported,
    },
    empty: days.length === 0 && !weight,
  });
}
