import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { clearSessionCookie, comparePassword, requireUser } from '@/lib/auth';
import { deleteUpload } from '@/lib/storage';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const DeleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required to delete your account'),
});

/**
 * Permanently delete the account and ALL user data. Password must be
 * verified first. Child rows are deleted before the user row in one
 * transaction; sessions are destroyed and the cookie cleared.
 */
export async function DELETE(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = DeleteAccountSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }
  if (!s.user.passwordHash || !(await comparePassword(parsed.data.password, s.user.passwordHash))) {
    return apiError('invalid_password', 'Password is incorrect', 401);
  }

  const userId = s.user.id;

  // Best-effort cleanup of the user's uploaded files. v21.8: the Upload
  // ownership registry covers everything (including transient menu extracts
  // that have no FoodScan/DataExport row); the legacy URL-derived keys
  // cover pre-v21.8 files whose registry row was never written.
  const [registered, scans, exports] = await Promise.all([
    prisma.upload.findMany({ where: { userId }, select: { key: true } }),
    prisma.foodScan.findMany({ where: { userId }, select: { imageUrl: true } }),
    prisma.dataExport.findMany({ where: { userId }, select: { fileUrl: true } }),
  ]);
  const keys = new Set([
    ...registered.map((r) => r.key),
    ...[...scans, ...exports]
      .map((r) => ('imageUrl' in r ? r.imageUrl : (r as { fileUrl: string | null }).fileUrl))
      .filter((u): u is string => Boolean(u))
      .map((u) => u.replace(/^\/api\/uploads\//, '')),
  ]);
  // deleteUpload throws on GENUINE storage failures (v21.8 P3), so each
  // delete stays best-effort here: one bad file must not abort account deletion.
  await Promise.all([...keys].map((k) => deleteUpload(k).catch(() => {})));

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { userId } }),
    prisma.session.deleteMany({ where: { userId } }),
    prisma.consent.deleteMany({ where: { userId } }),
    prisma.profile.deleteMany({ where: { userId } }),
    prisma.subscription.deleteMany({ where: { userId } }),
    prisma.measurement.deleteMany({ where: { userId } }),
    prisma.diaryEntry.deleteMany({ where: { userId } }),
    prisma.waterLog.deleteMany({ where: { userId } }),
    prisma.mealPlan.deleteMany({ where: { userId } }),
    prisma.favoriteMeal.deleteMany({ where: { userId } }),
    prisma.workoutLog.deleteMany({ where: { session: { userId } } }),
    prisma.workoutSession.deleteMany({ where: { userId } }),
    prisma.personalRecord.deleteMany({ where: { userId } }),
    prisma.foodScan.deleteMany({ where: { userId } }),
    prisma.coachMessage.deleteMany({ where: { conversation: { userId } } }),
    prisma.coachConversation.deleteMany({ where: { userId } }),
    prisma.dataExport.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  const res = apiOk({ ok: true, deleted: true });
  clearSessionCookie(res);
  return res;
}
