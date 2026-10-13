import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { ProfileUpdateSchema } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { toPrismaFastingSession } from '@/lib/fasting-server';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const profile =
    s.profile ??
    (await prisma.profile.upsert({
      where: { userId: s.user.id },
      update: {},
      create: { userId: s.user.id },
    }));
  return apiOk({ profile });
}

export async function PUT(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = ProfileUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid profile data', 400, zodMessage(parsed.error));
  }
  const { fastingSession, ...rest } = parsed.data;
  const sessionPatch = toPrismaFastingSession(fastingSession);
  const profile = await prisma.profile.upsert({
    where: { userId: s.user.id },
    update: { ...rest, ...sessionPatch },
    create: { userId: s.user.id, ...rest, ...sessionPatch },
  });
  return apiOk({ profile });
}
