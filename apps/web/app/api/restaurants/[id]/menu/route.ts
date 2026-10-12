import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, zodMessage } from '@/lib/server-api';
import {
  MenuItemBodySchema,
  validateMenuItemHonesty,
} from '@/lib/menu-api-schema';

export const dynamic = 'force-dynamic';

function serializeItem(item: {
  id: string;
  name: string;
  description: string | null;
  portion: string | null;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  nutritionStatus: string;
  assumptions: unknown;
  source: string | null;
  lastVerifiedAt: Date | null;
}) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    portion: item.portion,
    kcal: item.kcal,
    proteinG: item.proteinG,
    carbsG: item.carbsG,
    fatG: item.fatG,
    fiberG: item.fiberG,
    nutritionStatus: item.nutritionStatus,
    assumptions: Array.isArray(item.assumptions) ? item.assumptions : [],
    source: item.source,
    lastVerifiedAt: item.lastVerifiedAt,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.id },
    include: { menuItems: { orderBy: { name: 'asc' } } },
  });
  if (!restaurant) {
    return apiError('restaurant_not_found', 'Restaurant not found', 404);
  }
  return apiOk({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      address: restaurant.address,
      city: restaurant.city,
      country: restaurant.country,
      rating: restaurant.rating,
      priceLevel: restaurant.priceLevel,
      website: restaurant.website,
      menuUrl: restaurant.menuUrl,
    },
    items: restaurant.menuItems.map(serializeItem),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!restaurant) {
    return apiError('restaurant_not_found', 'Restaurant not found', 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('invalid_json', 'Request body must be valid JSON', 400);
  }
  const parsed = MenuItemBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid menu item', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;
  const honesty = validateMenuItemHonesty(input.kcal, input.nutritionStatus);
  if (honesty) {
    return apiError('validation_error', honesty, 400);
  }

  const item = await prisma.restaurantMenuItem.create({
    data: {
      restaurantId: params.id,
      name: input.name,
      description: input.description ?? null,
      portion: input.portion ?? null,
      kcal: input.kcal ?? null,
      proteinG: input.proteinG ?? null,
      carbsG: input.carbsG ?? null,
      fatG: input.fatG ?? null,
      fiberG: input.fiberG ?? null,
      nutritionStatus: input.nutritionStatus,
      assumptions: input.assumptions ?? [],
      source: input.source ?? null,
    },
  });
  return apiOk({ item: serializeItem(item) }, 201);
}
