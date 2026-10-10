import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { LoginSchema } from '@fitfusion/core';
import { comparePassword, createSession, setSessionCookie } from '@/lib/auth';
import { apiError, apiOk, clientIp, publicUser, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = LoginSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid login data', 400, zodMessage(parsed.error));
  }
  const { email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // Same response whether the email or password is wrong (no enumeration).
  if (!user || !user.passwordHash || !(await comparePassword(password, user.passwordHash))) {
    return apiError('invalid_credentials', 'Invalid email or password', 401);
  }
  if (user.status !== 'active') {
    return apiError('account_disabled', 'This account has been disabled', 403);
  }

  const { token } = await createSession(user.id, {
    userAgent: req.headers.get('user-agent') ?? undefined,
    ip: clientIp(req),
  });
  const res: NextResponse = apiOk({ user: publicUser(user) });
  setSessionCookie(res, token);
  return res;
}
