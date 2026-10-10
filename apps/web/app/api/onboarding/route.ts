import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { OnboardingSchema } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Save onboarding answers onto the profile, record the initial weight as a
 * measurement, and mark onboarding complete.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = OnboardingSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid onboarding data', 400, zodMessage(parsed.error));
  }
  const { weightKg, ...profileFields } = parsed.data;

  const profile = await prisma.profile.upsert({
    where: { userId: s.user.id },
    update: { ...profileFields, onboardingCompletedAt: new Date() },
    create: { userId: s.user.id, ...profileFields, onboardingCompletedAt: new Date() },
  });

  let measurement = null;
  if (typeof weightKg === 'number') {
    measurement = await prisma.measurement.create({
      data: { userId: s.user.id, type: 'weight', value: weightKg, unit: 'kg' },
    });
  }

  return apiOk({ profile, measurement });
}
