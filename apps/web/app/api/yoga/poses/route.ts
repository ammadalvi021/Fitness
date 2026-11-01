import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Public yoga pose catalog with filters (mirrors the exercise library). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const difficulty = (sp.get('difficulty') ?? '').trim().toLowerCase();
  const limit = clampInt(sp.get('limit'), 50, 1, 100);

  const and: object[] = [];
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { sanskritName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (difficulty) and.push({ difficulty });

  const poses = await prisma.yogaPose.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: { name: 'asc' },
    take: 500,
  });

  return apiOk({ poses: poses.slice(0, limit), total: poses.length });
}
