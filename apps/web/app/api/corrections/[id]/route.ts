import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, zodMessage } from '@/lib/server-api';
import {
  CorrectionResolveSchema,
  validateMenuItemHonesty,
} from '@/lib/menu-api-schema';

export const dynamic = 'force-dynamic';

/**
 * Admin: accept or reject a correction. Accepting may also apply `updates`
 * to the menu item (e.g. corrected kcal), which stamps lastVerifiedAt.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const correction = await prisma.menuCorrection.findUnique({
    where: { id: params.id },
    include: { menuItem: true },
  });
  if (!correction) {
    return apiError('correction_not_found', 'Correction not found', 404);
  }
  if (correction.status !== 'open') {
    return apiError('correction_closed', 'Correction has already been resolved', 409);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('invalid_json', 'Request body must be valid JSON', 400);
  }
  const parsed = CorrectionResolveSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid resolution', 400, zodMessage(parsed.error));
  }
  const { status, updates } = parsed.data;

  let item = correction.menuItem;
  if (status === 'accepted' && updates && Object.keys(updates).length > 0) {
    const nextKcal = updates.kcal !== undefined ? updates.kcal : item.kcal;
    const nextStatus =
      updates.nutritionStatus !== undefined ? updates.nutritionStatus : item.nutritionStatus;
    const honesty = validateMenuItemHonesty(nextKcal, nextStatus);
    if (honesty) {
      return apiError('validation_error', honesty, 400);
    }
    const data: Record<string, unknown> = { lastVerifiedAt: new Date() };
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) data[k] = v ?? null;
    }
    item = await prisma.restaurantMenuItem.update({
      where: { id: item.id },
      data,
    });
  }

  const resolved = await prisma.menuCorrection.update({
    where: { id: params.id },
    data: { status },
  });
  return apiOk({ correction: resolved, item });
}
