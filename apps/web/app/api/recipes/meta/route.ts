import { prisma } from '@fitfusion/db';
import { apiOk } from '@/lib/server-api';
import { normalizeRecipeTag } from '@/lib/recipe-tags';

export const dynamic = 'force-dynamic';

/**
 * V21.2 (P5): recipe-library filter vocabularies, derived from the FULL
 * non-private recipe table — never from a page subset.
 *
 * Response:
 * {
 *   cuisines: [{ name, count }],
 *   tags: [{ tag, count }],        // canonical tags; halal-friendly counts
 *                                  // are merged into halal
 *   mealTypes: string[],
 *   difficulties: string[],
 *   allergens: [{ allergen, count }]
 * }
 */
export async function GET() {
  const base = { isPrivate: false };

  const [cuisineGroups, tagRows, allergenRows, mealRows, difficultyRows, cuisines] =
    await Promise.all([
      prisma.recipe.groupBy({ by: ['cuisineId'], where: base, _count: true }),
      prisma.$queryRaw<Array<{ tag: string; count: number }>>`
        SELECT UNNEST("tags") AS tag, COUNT(*)::int AS count
        FROM "Recipe" WHERE "isPrivate" = false GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<Array<{ allergen: string; count: number }>>`
        SELECT UNNEST("allergens") AS allergen, COUNT(*)::int AS count
        FROM "Recipe" WHERE "isPrivate" = false GROUP BY 1 ORDER BY 1`,
      prisma.recipe.groupBy({
        by: ['mealType'],
        where: { ...base, mealType: { not: null } },
        _count: true,
      }),
      prisma.recipe.groupBy({ by: ['difficulty'], where: base, _count: true }),
      prisma.cuisine.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);

  const countByCuisine = new Map(
    cuisineGroups.map((g) => [g.cuisineId, g._count]),
  );
  const cuisineList = cuisines
    .map((c) => ({ name: c.name, count: countByCuisine.get(c.id) ?? 0 }))
    .filter((c) => c.count > 0);

  // Canonicalize tags: merge halal-friendly into halal (same filter).
  const tagCounts = new Map<string, number>();
  for (const row of tagRows) {
    const canonical = normalizeRecipeTag(row.tag);
    tagCounts.set(canonical, (tagCounts.get(canonical) ?? 0) + row.count);
  }
  const tagList = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  return apiOk({
    cuisines: cuisineList,
    tags: tagList,
    mealTypes: mealRows
      .map((g) => g.mealType)
      .filter((m): m is string => Boolean(m))
      .sort(),
    difficulties: difficultyRows.map((g) => g.difficulty).sort(),
    allergens: allergenRows.map((r) => ({ allergen: r.allergen, count: r.count })),
  });
}
