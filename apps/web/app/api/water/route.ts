import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { WaterLogSchema } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, parseDateOnly, readJson, toDateOnly, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const date = parseDateOnly(req.nextUrl.searchParams.get('date')) ?? parseDateOnly(toDateOnly(new Date()));
  if (!date) {
    return apiError('validation_error', 'date must be YYYY-MM-DD', 400);
  }
  const log = await prisma.waterLog.findUnique({
    where: { userId_date: { userId: s.user.id, date } },
  });
  return apiOk({ date: toDateOnly(date), ml: log?.ml ?? 0 });
}

/** Upsert the day's water total (idempotent set semantics). */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = WaterLogSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid water log', 400, zodMessage(parsed.error));
  }
  const date = parseDateOnly(parsed.data.date);
  if (!date) {
    return apiError('validation_error', 'date must be YYYY-MM-DD', 400);
  }
  const log = await prisma.waterLog.upsert({
    where: { userId_date: { userId: s.user.id, date } },
    update: { ml: parsed.data.ml },
    create: { userId: s.user.id, date, ml: parsed.data.ml },
  });
  return apiOk({ log });
}
