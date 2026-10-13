/**
 * GET /api/health/google/callback — Google OAuth redirect target.
 *
 * Validates the state token against the httpOnly cookie (tampered/missing
 * state is rejected), exchanges the code for tokens, encrypts them with
 * AES-256-GCM (HEALTH_SYNC_SECRET), and upserts the HealthConnection row.
 * Tokens are never logged and never appear in responses. The user lands
 * back on /settings with a ?fit= query flag the UI reads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import {
  OAUTH_STATE_COOKIE,
  exchangeCodeForTokens,
  googleFitConfigured,
  sealTokens,
  validateOAuthState,
} from '@/lib/google-fit';

export const dynamic = 'force-dynamic';

function settingsRedirect(flag: string, reason?: string): NextResponse {
  const base = process.env.APP_URL || 'http://localhost:3000';
  const url = new URL('/settings', base.replace(/\/+$/, ''));
  url.searchParams.set('fit', flag);
  if (reason) url.searchParams.set('reason', reason);
  const res = NextResponse.redirect(url.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  if (!googleFitConfigured()) {
    return settingsRedirect('error', 'not_configured');
  }
  const params = req.nextUrl.searchParams;
  if (params.get('error')) {
    return settingsRedirect('error', 'denied');
  }
  const code = params.get('code');
  const state = params.get('state');
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !validateOAuthState(cookieState, state)) {
    return settingsRedirect('error', 'invalid_state');
  }
  try {
    const tokens = await exchangeCodeForTokens(code);
    const sealed = sealTokens(tokens);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
    await prisma.healthConnection.upsert({
      where: { userId: s.user.id },
      create: {
        userId: s.user.id,
        provider: 'google',
        accessTokenEnc: sealed.accessTokenEnc,
        refreshTokenEnc: sealed.refreshTokenEnc,
        accessTokenExpiresAt: expiresAt,
        lastSyncError: null,
      },
      update: {
        provider: 'google',
        accessTokenEnc: sealed.accessTokenEnc,
        // Google may omit refresh_token on re-consent — keep the old one.
        ...(sealed.refreshTokenEnc ? { refreshTokenEnc: sealed.refreshTokenEnc } : {}),
        accessTokenExpiresAt: expiresAt,
        lastSyncError: null,
      },
    });
    return settingsRedirect('connected');
  } catch (err) {
    console.error('[health/google/callback] token exchange failed', err);
    return settingsRedirect('error', 'exchange_failed');
  }
}
