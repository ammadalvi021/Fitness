import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { ScanConfirmSchema } from '@fitfusion/core';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, parseDateOnly, readJson, toDateOnly, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Confirm the items of a reviewed scan -> creates DiaryEntry rows
 * (source 'scan'). Nutrients come from the user's confirmed items
 * (AI estimates reviewed by the user).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const scan = await prisma.foodScan.findFirst({
    where: { id: params.id, userId: s.user.id },
  });
  if (!scan) {
    return apiError('not_found', 'Food scan not found', 404);
  }
  if (scan.status !== 'review') {
    return apiError('invalid_state', `Scan is in "${scan.status}" state and cannot be confirmed`, 400);
  }

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = ScanConfirmSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid items', 400, zodMessage(parsed.error));
  }

  const date = parseDateOnly(toDateOnly(new Date()));
  const entries = await prisma.$transaction(
    parsed.data.items.map((item) =>
      prisma.diaryEntry.create({
        data: {
          userId: s.user.id,
          date: date!,
          mealType: 'extra',
          customName: item.name,
          servings: item.servings,
          kcal: Math.round(item.kcal * item.servings * 10) / 10,
          proteinG: Math.round(item.proteinG * item.servings * 10) / 10,
          carbsG: Math.round(item.carbsG * item.servings * 10) / 10,
          fatG: Math.round(item.fatG * item.servings * 10) / 10,
          fiberG: Math.round(item.fiberG * item.servings * 10) / 10,
          source: 'scan',
          scanId: scan.id,
        },
      }),
    ),
  );

  const updated = await prisma.foodScan.update({
    where: { id: scan.id },
    data: { status: 'confirmed', items: parsed.data.items },
  });

  return apiOk({ scan: updated, entries }, 201);
}
