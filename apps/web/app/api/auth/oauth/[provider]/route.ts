import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const SUPPORTED = ['google', 'apple'] as const;

/**
 * OAuth entry point. Honest stub: no OAuth provider is configured in this
 * build, so every provider reports {configured:false} instead of redirecting
 * anywhere. When a provider is wired up, this route should 302 to the
 * provider's authorization URL.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { provider: string } },
) {
  const provider = params.provider?.toLowerCase();
  if (!(SUPPORTED as readonly string[]).includes(provider)) {
    return apiError('invalid_provider', `Unsupported OAuth provider: ${params.provider}`, 400);
  }
  const configured = Boolean(
    provider === 'google'
      ? process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      : process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET,
  );
  if (!configured) {
    return apiOk({ configured: false, provider });
  }
  return apiError(
    'not_implemented',
    'OAuth login is not implemented in this build',
    501,
  );
}
