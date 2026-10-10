import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { SESSION_COOKIE, clearSessionCookie, sha256 } from '@/lib/auth';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .delete({ where: { tokenHash: sha256(token) } })
      .catch(() => {});
  }
  const res = apiOk({ ok: true });
  clearSessionCookie(res);
  return res;
}
