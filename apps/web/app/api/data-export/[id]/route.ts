import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const record = await prisma.dataExport.findFirst({
    where: { id: params.id, userId: s.user.id },
  });
  if (!record) {
    return apiError('not_found', 'Export not found', 404);
  }
  return apiOk({ export: record });
}
