import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, zodMessage } from '@/lib/server-api';
import {
  MenuItemBodySchema,
  menuPatchHasMaterialChange,
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

  // P5 (v21.8): a material change invalidates any prior verification, unless
  // the same request explicitly performs a new verification afterwards
  // (verify:true establishes a fresh review of the changed item).
  const materialChanged = menuPatchHasMaterialChange(existing, fields);
  if (verify) {
    // A verification stamp is meaningless — and a laundering vector — on an
    // item with no nutrition data, so refuse it outright.
    if (nextStatus === 'unavailable') {
      return apiError(
        'validation_error',
        'Cannot verify an item with unavailable nutrition — there is nothing to verify.',
        400,
      );
    }
    data.lastVerifiedAt = new Date();
  } else if (materialChanged) {
    data.lastVerifiedAt = null;
  }
  if (Object.keys(data).length === 0) {
    return apiError('validation_error', 'Nothing to update', 400);
  }

  const item = await prisma.restaurantMenuItem.update({
    where: { id: params.id },
    data,
  });
  return apiOk({ item });
}
