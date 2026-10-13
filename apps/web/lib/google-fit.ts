/**
 * Google Fit sync helpers (V20 Feature 6) — server-only.
 *
 * OAuth 2.0 (server-side authorization-code flow) + Google Fitness REST
 * `users/me/dataset:aggregate` for daily steps and body weight.
 *
 * Design notes:
 * - Weight imports INTO the existing `Measurement` table (type "weight"),
 *   never into a parallel store. Steps likewise land in `Measurement`
 *   (type "steps", unit "steps") — one row per day, upserted so repeated
 *   syncs never create duplicates.
 * - No data is ever fabricated: an empty aggregate response produces zero
 *   rows and an honest `{ imported: { steps: 0, weight: false } }`.
 * - `fetchImpl` is injectable so tests can stub Google without network.
 *   Production callers omit it and use the global fetch.
 */
import crypto from 'node:crypto';
import { encryptToken, decryptToken, healthCryptoConfigured } from './health-crypto';

export const FIT_SCOPE_ACTIVITY = 'https://www.googleapis.com/auth/fitness.activity.read';
export const FIT_SCOPE_BODY = 'https://www.googleapis.com/auth/fitness.body.read';
export const FIT_SCOPES = [FIT_SCOPE_ACTIVITY, FIT_SCOPE_BODY];

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FITNESS_AGGREGATE_URL = 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate';

export const STEPS_DATA_TYPE = 'com.google.step_count.delta';
export const WEIGHT_DATA_TYPE = 'com.google.weight.summary';

export const OAUTH_STATE_COOKIE = 'ff_fit_oauth_state';
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export type FetchImpl = typeof fetch;

export class FitApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------- config -------------------------------- */

export function appBaseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function fitRedirectUri(): string {
  return `${appBaseUrl()}/api/health/google/callback`;
}

/** Google Fit sync needs an OAuth client AND the token-encryption secret. */
export function googleFitConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      healthCryptoConfigured(),
  );
}

/* ------------------------------- OAuth --------------------------------- */

/** Opaque state token (single value; stored in an httpOnly cookie, echoed back). */
export function newOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Timing-safe comparison of the returned state against the cookie value. */
export function validateOAuthState(cookieValue: string | undefined, queryValue: string | null): boolean {
  if (!cookieValue || !queryValue) return false;
  const a = Buffer.from(cookieValue, 'utf8');
  const b = Buffer.from(queryValue, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: fitRedirectUri(),
    response_type: 'code',
    scope: FIT_SCOPES.join(' '),
    access_type: 'offline', // refresh token
    prompt: 'consent', // re-consent so Google reliably returns a refresh token
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number; // seconds
}

async function postForm(url: string, params: Record<string, string>, fetchImpl: FetchImpl): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'error_description' in body
        ? String((body as { error_description: string }).error_description)
        : `HTTP ${res.status}`;
    throw new FitApiError(res.status, `Google token request failed: ${detail}`);
  }
  return body;
}

function parseTokenSet(body: unknown): TokenSet {
  if (!body || typeof body !== 'object') throw new FitApiError(502, 'Invalid token response from Google');
  const b = body as Record<string, unknown>;
  if (typeof b.access_token !== 'string' || !b.access_token) {
    throw new FitApiError(502, 'Google token response missing access_token');
  }
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === 'string' ? b.refresh_token : null,
    expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 3600,
  };
}

/** Exchange the authorization code for tokens. `fetchImpl` injectable for tests. */
export async function exchangeCodeForTokens(code: string, fetchImpl: FetchImpl = fetch): Promise<TokenSet> {
  const body = await postForm(
    GOOGLE_TOKEN_URL,
    {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: fitRedirectUri(),
      grant_type: 'authorization_code',
    },
    fetchImpl,
  );
  return parseTokenSet(body);
}

/** Refresh an expired access token using the stored refresh token. */
export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<TokenSet> {
  const body = await postForm(
    GOOGLE_TOKEN_URL,
    {
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    },
    fetchImpl,
  );
  const parsed = parseTokenSet(body);
  // Google often omits refresh_token on refresh — keep the caller's one.
  return { ...parsed, refreshToken: parsed.refreshToken ?? refreshToken };
}

/* --------------------------- fitness aggregate -------------------------- */

export interface AggregateBucket {
  startTimeMillis: string;
  endTimeMillis: string;
  dataset: Array<{ dataSourceId: string; point: Array<{ value: Array<{ intVal?: number; fpVal?: number }> }> }>;
}

export interface AggregateResponse {
  bucket: AggregateBucket[];
}

/** Build an N-day daily-bucketed aggregate request. `endMs` defaults to now. */
export function buildAggregateRequest(dataTypeName: string, days: number, endMs = Date.now()) {
  const dayMs = 24 * 60 * 60 * 1000;
  const end = Math.floor(endMs);
  const start = end - days * dayMs;
  return {
    aggregateBy: [{ dataTypeName }],
    bucketByTime: { durationMillis: dayMs },
    startTimeMillis: start,
    endTimeMillis: end,
  };
}

/** Parse daily step totals from an aggregate response. Empty → []. */
export function parseStepsAggregate(body: AggregateResponse): Array<{ dayStartMs: number; steps: number }> {
  if (!body || !Array.isArray(body.bucket)) return [];
  const out: Array<{ dayStartMs: number; steps: number }> = [];
  for (const bucket of body.bucket) {
    const start = Number(bucket.startTimeMillis);
    if (!Number.isFinite(start)) continue;
    let steps = 0;
    for (const ds of bucket.dataset ?? []) {
      for (const point of ds.point ?? []) {
        for (const v of point.value ?? []) {
          if (typeof v.intVal === 'number') steps += v.intVal;
        }
      }
    }
    out.push({ dayStartMs: start, steps: Math.max(0, Math.round(steps)) });
  }
  return out;
}

/** Parse daily weight readings (kg, fpVal). Empty → []. */
export function parseWeightAggregate(body: AggregateResponse): Array<{ dayStartMs: number; kg: number }> {
  if (!body || !Array.isArray(body.bucket)) return [];
  const out: Array<{ dayStartMs: number; kg: number }> = [];
  for (const bucket of body.bucket) {
    const start = Number(bucket.startTimeMillis);
    if (!Number.isFinite(start)) continue;
    const readings: number[] = [];
    for (const ds of bucket.dataset ?? []) {
      for (const point of ds.point ?? []) {
        for (const v of point.value ?? []) {
          if (typeof v.fpVal === 'number' && Number.isFinite(v.fpVal) && v.fpVal > 0) {
            readings.push(v.fpVal);
          }
        }
      }
    }
    if (readings.length > 0) out.push({ dayStartMs: start, kg: readings[readings.length - 1] });
  }
  return out;
}

async function postAggregate(
  accessToken: string,
  dataTypeName: string,
  days: number,
  fetchImpl: FetchImpl,
): Promise<AggregateResponse> {
  const res = await fetchImpl(FITNESS_AGGREGATE_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildAggregateRequest(dataTypeName, days)),
  });
  if (res.status === 401 || res.status === 403) {
    throw new FitApiError(res.status, 'Google Fitness rejected the request (auth)');
  }
  if (!res.ok) throw new FitApiError(res.status, `Google Fitness request failed: HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as AggregateResponse | null;
  return body ?? { bucket: [] };
}

/** Daily step totals for the last `days` days (default 7). Never invents data. */
export async function fetchDailySteps(
  accessToken: string,
  days = 7,
  fetchImpl: FetchImpl = fetch,
): Promise<Array<{ dayStartMs: number; steps: number }>> {
  return parseStepsAggregate(await postAggregate(accessToken, STEPS_DATA_TYPE, days, fetchImpl));
}

/** Most recent weight reading (kg) within the last `days` days, or null. */
export async function fetchLatestWeight(
  accessToken: string,
  days = 30,
  fetchImpl: FetchImpl = fetch,
): Promise<{ dayStartMs: number; kg: number } | null> {
  const readings = parseWeightAggregate(await postAggregate(accessToken, WEIGHT_DATA_TYPE, days, fetchImpl));
  return readings.length > 0 ? readings[readings.length - 1] : null;
}

/* --------------------------- token encryption --------------------------- */

export function sealTokens(tokens: TokenSet): { accessTokenEnc: string; refreshTokenEnc: string | null } {
  return {
    accessTokenEnc: encryptToken(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
  };
}

export function openAccessToken(enc: string): string {
  return decryptToken(enc);
}

export function openRefreshToken(enc: string | null): string | null {
  return enc ? decryptToken(enc) : null;
}
