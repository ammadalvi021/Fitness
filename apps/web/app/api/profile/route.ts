import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { ProfileUpdateSchema } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
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
  const profile = await prisma.profile.upsert({
    where: { userId: s.user.id },
    update: parsed.data,
    create: { userId: s.user.id, ...parsed.data },
  });
  return apiOk({ profile });
}
