import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, zodMessage } from '@/lib/server-api';
import { MenuConfirmSchema } from '@/lib/menu-api-schema';

export const dynamic = 'force-dynamic';

/**
 * Accept a user's reviewed menu items as PRIVATE submissions.
 *
 * P2 (v21.8): customer uploads/confirms are stored as pending submissions —
 * they do NOT publish to the shared restaurant menu. An administrator
 * reviews dish, portion, nutrition assumptions, and source via
 * PATCH /api/menu-submissions/[id]; only approved submissions publish.
 *
 * Honesty rule (binding): items matched to a Food record get
 * nutritionStatus 'menu_photo_estimate' with that food's numbers and a visible
 * assumption about the match; items WITHOUT a match get 'unavailable' with
 * kcal null — never a guessed number.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('invalid_json', 'Request body must be valid JSON', 400);
  }
  const parsed = MenuConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid confirm payload', 400, zodMessage(parsed.error));
  }
  const { restaurantId, items } = parsed.data;

  // Validate everything BEFORE starting the transaction (no partial menus).
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true },
  });
  if (!restaurant) {
    return apiError('restaurant_not_found', 'Restaurant not found', 404);
  }

  const foodIds = [...new Set(items.map((i) => i.matchedFoodId).filter((f): f is string => !!f))];
  const foods = new Map<string, { id: string; name: string; servingSize: number; servingUnit: string; kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number }>();
  for (const fid of foodIds) {
    const food = await prisma.food.findUnique({ where: { id: fid } });
    if (!food) {
      return apiError('food_not_found', `Matched food not found: ${fid}`, 404);
    }
    foods.set(fid, food);
  }

  // Build every row before touching the database, then insert the whole
  // batch inside one transaction — a failed batch leaves no partial menu.
  const rows = items.map((it) => {
    const food = it.matchedFoodId ? foods.get(it.matchedFoodId) : undefined;
    const base = {
      restaurantId,
      name: it.name,
      description: null,
      portion: it.portion ?? null,
      source: 'menu_photo',
      matchedFoodId: it.matchedFoodId ?? null,
      status: 'pending' as const,
      submittedBy: s.user.id,
    };
    if (food) {
      return {
        ...base,
        kcal: food.kcal,
        proteinG: food.proteinG,
        carbsG: food.carbsG,
        fatG: food.fatG,
        fiberG: food.fiberG,
        nutritionStatus: 'menu_photo_estimate',
        assumptions: [
          `Matched by the user to the food-database entry "${food.name}" (per ${food.servingSize} ${food.servingUnit}, ${Math.round(food.kcal)} kcal); the restaurant's actual portion and recipe may differ — treat as an estimate.`,
        ],
      };
    }
    return {
      ...base,
      kcal: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      fiberG: null,
      nutritionStatus: 'unavailable',
      assumptions: [
        'Extracted from a menu photo; nutrition could not be matched to a known food — no numbers were guessed.',
      ],
    };
  });

  const created = await prisma.$transaction(
    rows.map((data) => prisma.menuSubmission.create({ data })),
  );

  return apiOk({ items: created }, 201);
}
