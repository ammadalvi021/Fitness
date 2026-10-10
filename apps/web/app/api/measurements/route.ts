import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { MeasurementSchema } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, clampInt, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const type = req.nextUrl.searchParams.get('type');
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 100, 1, 500);
  const measurements = await prisma.measurement.findMany({
    where: { userId: s.user.id, ...(type ? { type } : {}) },
    orderBy: { recordedAt: 'desc' },
    take: limit,
  });
  return apiOk({ measurements });
}

export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = MeasurementSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid measurement', 400, zodMessage(parsed.error));
  }
  const measurement = await prisma.measurement.create({
    data: {
      userId: s.user.id,
      type: parsed.data.type,
      value: parsed.data.value,
      unit: parsed.data.unit,
      recordedAt: parsed.data.recordedAt ?? new Date(),
      note: parsed.data.note ?? null,
    },
  });
  return apiOk({ measurement }, 201);
}
