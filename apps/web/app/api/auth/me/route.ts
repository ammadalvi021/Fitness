import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { apiOk, publicUser } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  return apiOk({
    user: publicUser(s.user),
    profile: s.profile,
    subscription: s.subscription,
  });
}
