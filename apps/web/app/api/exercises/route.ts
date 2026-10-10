import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Public exercise library with filters. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const muscle = (sp.get('muscle') ?? '').trim().toLowerCase();
  const equipment = (sp.get('equipment') ?? '').trim().toLowerCase();
  const difficulty = (sp.get('difficulty') ?? '').trim().toLowerCase();
  const limit = clampInt(sp.get('limit'), 50, 1, 100);

  const and: object[] = [];
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (difficulty) and.push({ difficulty });
  // Array-field filters are applied in JS (portable across providers).
  const all = await prisma.exercise.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: { name: 'asc' },
    take: 500,
  });
  const filtered = all.filter((e) => {
    if (muscle && !e.muscleGroups.some((m) => m.toLowerCase().includes(muscle))) return false;
    if (
      equipment &&
      !e.equipment.some((x) => x.toLowerCase().includes(equipment))
    )
      return false;
    return true;
  });

  return apiOk({ exercises: filtered.slice(0, limit), total: filtered.length });
}
