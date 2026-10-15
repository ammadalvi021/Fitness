import { NextRequest, NextResponse } from 'next/server';
import { prisma, type Prisma } from '@fitfusion/db';
import { rankFoodMatches } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const FOOD_INCLUDE = {
  category: { select: { id: true, name: true, nameUrdu: true } },
  portions: {
    select: { id: true, label: true, labelUrdu: true, grams: true, ml: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  aliases: { select: { alias: true } },
} satisfies Prisma.FoodInclude;

type FoodWithRelations = Prisma.FoodGetPayload<{ include: typeof FOOD_INCLUDE }>;

/**
 * Search the food database (seeded + user foods).
 *
 * Query params (all optional):
 *   q         — matches name + aliases (case-insensitive)
 *   category  — FoodCategory id
 *   country   — ISO country code, e.g. PK
 *   verified  — "true" | "false" (maps to verification field)
 *   page      — 1-based page (default 1)
 *   limit     — page size 1..100 (default 20)
 *
 * Ranking for `q`: exact name match > alias match > verified first > name asc.
 */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const category = (sp.get('category') ?? '').trim();
  const country = (sp.get('country') ?? '').trim().toUpperCase();
  const verifiedParam = sp.get('verified');
  const page = clampInt(sp.get('page'), 1, 1, 10000);
  const limit = clampInt(sp.get('limit'), 20, 1, 100);

  const where: Prisma.FoodWhereInput = {};
  if (category) where.categoryId = category;
  if (country) where.countryCodes = { has: country };
  if (verifiedParam === 'true') where.verification = 'verified';
  else if (verifiedParam === 'false') where.verification = 'estimate';

  let foods: FoodWithRelations[];
  if (q) {
    // Candidate fetch (name contains OR alias contains), ranked in memory —
    // the catalogue is small and ranking needs exact/alias precedence.
    const candidates = await prisma.food.findMany({
      where: {
        AND: [
          where,
          {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { aliases: { some: { alias: { contains: q, mode: 'insensitive' } } } },
            ],
          },
        ],
      },
      include: FOOD_INCLUDE,
      take: 500,
    });
    // rankFoodMatches works on plain {id,name,aliases,verification} shapes;
    // map the ranked ids back to the full rows to keep the DTO typed.
    const byId = new Map(candidates.map((f) => [f.id, f]));
    const rankedIds = rankFoodMatches(
      candidates.map((f) => ({
        id: f.id,
        name: f.name,
        aliases: f.aliases.map((a) => a.alias),
        verification: f.verification,
      })),
      q,
    ).map((r) => r.id);
    foods = rankedIds.flatMap((id) => {
      const f = byId.get(id);
      return f ? [f] : [];
    });
  } else {
    foods = await prisma.food.findMany({
      where,
      include: FOOD_INCLUDE,
      // 'verified' > 'estimate' alphabetically, so desc = verified first.
      orderBy: [{ verification: 'desc' }, { name: 'asc' }],
      take: 500,
    });
  }

  const total = foods.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const pageItems = foods.slice((safePage - 1) * limit, safePage * limit);

  return apiOk({
    foods: pageItems.map((f) => ({
      id: f.id,
      name: f.name,
      brand: f.brand,
      category: f.category
        ? { id: f.category.id, name: f.category.name, nameUrdu: f.category.nameUrdu }
        : null,
      servingSize: f.servingSize,
      servingUnit: f.servingUnit,
      // V21.2: canonical grams per serving (null = unknown). The client
      // derives the per-100-g factor from this via the shared core helper —
      // never 100 / servingSize.
      servingWeightG: f.servingWeightG ?? null,
      perServing: {
        kcal: f.kcal,
        proteinG: f.proteinG,
        carbsG: f.carbsG,
        fatG: f.fatG,
        fiberG: f.fiberG,
      },
      portions: f.portions.map((p) => ({
        id: p.id,
        label: p.label,
        labelUrdu: p.labelUrdu,
        grams: p.grams,
        ml: p.ml,
      })),
      countryCodes: f.countryCodes,
      verification: f.verification,
      basis: f.basis,
      source: f.source,
      // Legacy boolean kept for backward compatibility.
      verified: f.verified,
    })),
    page: safePage,
    totalPages,
    total,
  });
}
