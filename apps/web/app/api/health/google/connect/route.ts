/**
 * GET /api/health/google/connect — start Google Fit OAuth.
 *
 * Server-side authorization-code flow: generates an opaque state token,
 * stores it in a short-lived httpOnly cookie, and 302-redirects to Google's
 * consent screen with the minimal Fitness scopes (activity + body read)
 * plus access_type=offline + prompt=consent so a refresh token is issued.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { apiError } from '@/lib/server-api';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  buildAuthorizationUrl,
  googleFitConfigured,
  newOAuthState,
} from '@/lib/google-fit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  if (!googleFitConfigured()) {
    return apiError(
      'not_configured',
      'Google Fit sync is not configured on this server.',
      503,
    );
  }
  const state = newOAuthState();
  const res = NextResponse.redirect(buildAuthorizationUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return res;
}
