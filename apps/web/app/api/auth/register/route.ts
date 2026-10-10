import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { RegisterSchema } from '@fitfusion/core';
import { hashPassword } from '@/lib/auth';
import { apiError, apiOk, publicUser, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = RegisterSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid registration data', 400, zodMessage(parsed.error));
  }
  const { email, password, name } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return apiError('email_taken', 'An account with this email already exists', 409);
  }

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      name: name?.trim() || null,
      status: 'active',
      profile: { create: {} },
      subscription: { create: { planId: 'free', status: 'active' } },
    },
  });

  return apiOk({ user: publicUser(user) }, 201);
}
