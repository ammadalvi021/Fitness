import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, zodMessage } from '@/lib/server-api';
import {
  MenuItemBodySchema,
  validateMenuItemHonesty,
} from '@/lib/menu-api-schema';

export const dynamic = 'force-dynamic';

import { z } from 'zod';

/** Partial menu-item fields plus an optional `verify` flag that stamps lastVerifiedAt. */
const MenuItemPatchSchema = MenuItemBodySchema.partial().extend({
  verify: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const existing = await prisma.restaurantMenuItem.findUnique({
    where: { id: params.id },
  });
  if (!existing) {
    return apiError('menu_item_not_found', 'Menu item not found', 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('invalid_json', 'Request body must be valid JSON', 400);
  }
  const parsed = MenuItemPatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid menu item update', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;

  // Honesty check on the merged result, not just the patch fragment.
  const nextKcal = input.kcal !== undefined ? input.kcal : existing.kcal;
  const nextStatus =
    input.nutritionStatus !== undefined ? input.nutritionStatus : existing.nutritionStatus;
  const honesty = validateMenuItemHonesty(nextKcal, nextStatus);
  if (honesty) {
    return apiError('validation_error', honesty, 400);
  }

  const { verify, ...fields } = input;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) data[k] = v ?? null;
  }
  if (verify) data.lastVerifiedAt = new Date();
  if (Object.keys(data).length === 0) {
    return apiError('validation_error', 'Nothing to update', 400);
  }

  const item = await prisma.restaurantMenuItem.update({
    where: { id: params.id },
    data,
  });
  return apiOk({ item });
}
