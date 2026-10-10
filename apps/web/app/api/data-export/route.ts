import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { saveUpload, UploadError } from '@/lib/storage';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Build a full JSON dump of every user-owned table (secrets stripped),
 * store it as a file under uploads, and record a DataExport row.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const userId = s.user.id;

  const [
    user, profile, subscription, consents, measurements, diaryEntries,
    waterLogs, mealPlans, favoriteMeals, workoutPlans, workoutSessions,
    personalRecords, foodScans, coachConversations, dataExports,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.profile.findUnique({ where: { userId } }),
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.consent.findMany({ where: { userId } }),
    prisma.measurement.findMany({ where: { userId } }),
    prisma.diaryEntry.findMany({ where: { userId } }),
    prisma.waterLog.findMany({ where: { userId } }),
    prisma.mealPlan.findMany({ where: { userId } }),
    prisma.favoriteMeal.findMany({ where: { userId } }),
    prisma.workoutPlan.findMany({ where: { userId } }),
    prisma.workoutSession.findMany({
      where: { userId },
      include: { logs: true },
    }),
    prisma.personalRecord.findMany({ where: { userId } }),
    prisma.foodScan.findMany({ where: { userId } }),
    prisma.coachConversation.findMany({
      where: { userId },
      include: { messages: true },
    }),
    prisma.dataExport.findMany({ where: { userId } }),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    app: 'FitFusion AI',
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerifiedAt: user.emailVerifiedAt,
          status: user.status,
          createdAt: user.createdAt,
        }
      : null,
    profile,
    subscription,
    consents,
    measurements,
    diaryEntries,
    waterLogs,
    mealPlans,
    favoriteMeals,
    workoutPlans,
    workoutSessions,
    personalRecords,
    foodScans,
    coachConversations,
    previousExports: dataExports.map((d) => ({
      id: d.id,
      status: d.status,
      requestedAt: d.requestedAt,
      completedAt: d.completedAt,
    })),
    note: 'Password hashes, session tokens, and verification tokens are intentionally excluded from exports.',
  };

  let upload;
  try {
    upload = await saveUpload(Buffer.from(JSON.stringify(dump, null, 2), 'utf8'), {
      mime: 'application/json',
      prefix: 'exports',
      allowedMimes: ['application/json'],
    });
  } catch (e) {
    if (e instanceof UploadError) {
      return apiError(e.code, e.message, e.status);
    }
    throw e;
  }

  const record = await prisma.dataExport.create({
    data: {
      userId,
      status: 'ready',
      fileUrl: upload.url,
      completedAt: new Date(),
    },
  });

  return apiOk({ export: record }, 201);
}
