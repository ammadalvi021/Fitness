import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { comparePassword, consumeVerificationToken, hashPassword } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const ResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = ResetSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }
  const row = await consumeVerificationToken(parsed.data.token, 'password_reset');
  if (!row) {
    return apiError('invalid_token', 'This reset link is invalid or has expired', 400);
  }
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) {
    return apiError('invalid_token', 'This reset link is invalid or has expired', 400);
  }
  if (user.passwordHash && (await comparePassword(parsed.data.newPassword, user.passwordHash))) {
    return apiError('same_password', 'New password must be different from the current password', 400);
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.data.newPassword) },
    }),
    // Invalidate all sessions after a password change.
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  return apiOk({ ok: true });
}
