import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { consumeVerificationToken } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const VerifySchema = z.object({ token: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = VerifySchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }
  const row = await consumeVerificationToken(parsed.data.token, 'email_verify');
  if (!row) {
    return apiError('invalid_token', 'This verification link is invalid or has expired', 400);
  }
  await prisma.user.update({
    where: { id: row.userId },
    data: { emailVerifiedAt: new Date() },
  });
  return apiOk({ verified: true });
}
