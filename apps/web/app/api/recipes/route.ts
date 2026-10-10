import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { apiError, apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Public curated recipe browsing with filters. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const cuisine = (sp.get('cuisine') ?? '').trim();
  const diet = (sp.get('diet') ?? '').trim().toLowerCase();
  const tag = (sp.get('tag') ?? '').trim().toLowerCase();
  const maxKcal = sp.get('maxKcal') ? Number(sp.get('maxKcal')) : undefined;
  const limit = clampInt(sp.get('limit'), 20, 1, 100);
  const page = clampInt(sp.get('page'), 1, 1, 1000);

  if (diet && diet !== 'vegetarian' && diet !== 'non_vegetarian') {
    return apiError('validation_error', 'diet must be vegetarian or non_vegetarian', 400);
  }

  const and: object[] = [];
  if (q) and.push({ title: { contains: q, mode: 'insensitive' } });
  if (diet) and.push({ dietCategory: diet });
  if (maxKcal !== undefined && Number.isFinite(maxKcal)) and.push({ kcalPerServing: { lte: maxKcal } });
  if (cuisine) and.push({ cuisine: { name: { equals: cuisine, mode: 'insensitive' } } });

  const all = await prisma.recipe.findMany({
    where: and.length ? { AND: and } : undefined,
    include: { cuisine: { select: { id: true, name: true } } },
    orderBy: { title: 'asc' },
    take: 500,
  });
  const filtered = tag
    ? all.filter((r) => r.tags.some((t) => t.toLowerCase().includes(tag)))
    : all;
  const total = filtered.length;
  const recipes = filtered.slice((page - 1) * limit, page * limit);

  return apiOk({ recipes, page, limit, total });
}
