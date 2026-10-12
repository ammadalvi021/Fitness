import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, clampInt, zodMessage } from '@/lib/server-api';
import { CorrectionCreateSchema } from '@/lib/menu-api-schema';

export const dynamic = 'force-dynamic';

/** Any signed-in user can flag a menu item as incorrect. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const item = await prisma.restaurantMenuItem.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!item) {
    return apiError('menu_item_not_found', 'Menu item not found', 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('invalid_json', 'Request body must be valid JSON', 400);
  }
  const parsed = CorrectionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid correction', 400, zodMessage(parsed.error));
  }

  const correction = await prisma.menuCorrection.create({
    data: {
      menuItemId: params.id,
      userId: s.user.id,
      note: parsed.data.note,
      status: 'open',
    },
  });
  return apiOk({ correction }, 201);
}

/** Admin: list corrections for one menu item. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const item = await prisma.restaurantMenuItem.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!item) {
    return apiError('menu_item_not_found', 'Menu item not found', 404);
  }

  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 50, 1, 200);
  const corrections = await prisma.menuCorrection.findMany({
    where: { menuItemId: params.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return apiOk({ corrections });
}
