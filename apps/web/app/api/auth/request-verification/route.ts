import { NextRequest, NextResponse } from 'next/server';
import { createVerificationToken, requireUser } from '@/lib/auth';
import { sendEmail, verificationEmailHtml, verificationLink } from '@/lib/email';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  if (s.user.emailVerifiedAt) {
    return apiOk({ sent: false, alreadyVerified: true });
  }
  const token = await createVerificationToken(s.user.id, 'email_verify');
  const result = await sendEmail({
    to: s.user.email,
    subject: 'Verify your FitFusion AI email',
    html: verificationEmailHtml(s.user.name, verificationLink(token)),
  });
  return apiOk({ sent: result.sent, driver: result.driver, reason: result.reason });
}
