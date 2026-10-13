import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiOk, parseDateOnly, toDateOnly } from '@/lib/server-api';
import { computeStreak, type StreakResult } from '@/lib/streak';

export const dynamic = 'force-dynamic';

/**
 * V20 Feature 2: logging streak, computed on read from real diary entries.
 *
 * `today` is an optional YYYY-MM-DD override for the user's *local* date.
 * Diary entries are stamped with the client-local day, so the dashboard
 * passes its local date to keep the streak anchored to the user's timezone.
 * Defaults to the server UTC date.
 *
 * No new table: the streak is derived purely from DiaryEntry.date values.
 */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const todayParam = req.nextUrl.searchParams.get('today');
  const today = todayParam
    ? parseDateOnly(todayParam)
    : parseDateOnly(toDateOnly(new Date()));
  if (!today) {
    return NextResponse.json(
      { ok: false, error: 'validation_error', message: 'today must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  const rows = await prisma.diaryEntry.findMany({
    where: { userId: s.user.id },
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'asc' },
  });

  const loggedDates = rows.map((r) => toDateOnly(r.date));
  const result: StreakResult = computeStreak(loggedDates, toDateOnly(today));
  return apiOk(result);
}
