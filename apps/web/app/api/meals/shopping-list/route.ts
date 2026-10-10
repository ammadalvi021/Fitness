import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { consolidateShoppingList } from '@fitfusion/core';
import type { DayPlan, PlannedMeal, ShoppingItem } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Rough category guess for shopping-list grouping (deterministic). */
function categorizeIngredient(name: string): string {
  const n = name.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/(chicken|beef|turkey|pork|fish|salmon|tuna|egg|tofu|paneer|lentil|bean|chickpea)/, 'Protein'],
    [/(milk|cheese|yogurt|yoghurt|butter|cream)/, 'Dairy'],
    [/(apple|banana|orange|berry|berries|spinach|broccoli|carrot|tomato|onion|garlic|pepper|lettuce|kale|avocado|mango|fruit|vegetable|greens|herb|cilantro|parsley)/, 'Produce'],
    [/(rice|oat|bread|pasta|quinoa|flour|tortilla|cereal|granola)/, 'Grains'],
    [/(oil|salt|sugar|honey|spice|pepper|vinegar|sauce|stock|broth|nut|almond|walnut)/, 'Pantry'],
  ];
  for (const [re, category] of rules) {
    if (re.test(n)) return category;
  }
  return 'Other';
}

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const planId = req.nextUrl.searchParams.get('planId');
  if (!planId) {
    return apiError('validation_error', 'planId query parameter is required', 400);
  }
  const plan = await prisma.mealPlan.findFirst({
    where: { id: planId, userId: s.user.id },
  });
  if (!plan) {
    return apiError('not_found', 'Meal plan not found', 404);
  }

  const items: ShoppingItem[] = [];
  const days = plan.days as unknown as DayPlan[];
  for (const day of days) {
    for (const meal of (day.meals ?? []) as PlannedMeal[]) {
      for (const ing of meal.ingredients ?? []) {
        items.push({
          name: ing.name,
          quantity: `${ing.quantity} × ${meal.servings} serving(s) (${meal.name})`,
          category: categorizeIngredient(ing.name),
        });
      }
    }
  }

  return apiOk({
    planId: plan.id,
    weekStart: plan.weekStart,
    shoppingList: consolidateShoppingList(items),
  });
}
