import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Search the food database by name (seeded + user foods). Nutrition per serving. */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 20, 1, 100);
  const foods = await prisma.food.findMany({
    where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
    orderBy: [{ verified: 'desc' }, { name: 'asc' }],
    take: limit,
  });
  return apiOk({
    foods: foods.map((f) => ({
      id: f.id,
      name: f.name,
      brand: f.brand,
      servingSize: f.servingSize,
      servingUnit: f.servingUnit,
      perServing: {
        kcal: f.kcal,
        proteinG: f.proteinG,
        carbsG: f.carbsG,
        fatG: f.fatG,
        fiberG: f.fiberG,
      },
      source: f.source,
      verified: f.verified,
    })),
  });
}
