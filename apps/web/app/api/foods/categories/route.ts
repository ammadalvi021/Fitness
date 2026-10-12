import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** List food categories (id, name, Urdu name) in display order. */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const categories = await prisma.foodCategory.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, nameUrdu: true },
  });
  return apiOk({ categories });
}
