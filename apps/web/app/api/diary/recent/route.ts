import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * V18 Phase E: the user's most recently logged distinct foods (newest first).
 * Used by /log/repeat "Recent foods". Dedupes by foodId, falling back to
 * the lowercased custom name for manual entries. Pure read — no DB writes.
 */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 20, 1, 50);

  const entries = await prisma.diaryEntry.findMany({
    where: { userId: s.user.id },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { food: { select: { id: true, name: true, servingUnit: true } } },
  });

  const seen = new Set<string>();
  const foods: Array<{
    foodId: string | null;
    name: string;
    servingUnit: string | null;
  }> = [];
  for (const e of entries) {
    const key = e.foodId ? `food:${e.foodId}` : `name:${(e.customName ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    foods.push({
      foodId: e.foodId,
      name: e.food?.name ?? e.customName ?? 'Logged item',
      servingUnit: e.food?.servingUnit ?? null,
    });
    if (foods.length >= limit) break;
  }
  return apiOk({ foods });
}
