import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { createVerificationToken } from '@/lib/auth';
import { passwordResetEmailHtml, passwordResetLink, sendEmail } from '@/lib/email';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const ForgotSchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = ForgotSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }
  const email = parsed.data.email.trim().toLowerCase();

  // Always 200 — never reveal whether the email is registered.
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.passwordHash && user.status === 'active') {
    const token = await createVerificationToken(user.id, 'password_reset');
    await sendEmail({
      to: user.email,
      subject: 'Reset your FitFusion AI password',
      html: passwordResetEmailHtml(user.name, passwordResetLink(token)),
    });
  }
  return apiOk({ ok: true });
}
