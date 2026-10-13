/**
 * Google Fit sync tests (V20 Feature 6).
 *
 * Google is fully mocked (global fetch stub) — no network calls ever.
 * Route handlers run against the real PostgreSQL database (DATABASE_URL
 * from the environment, same as the other integration suites).
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@fitfusion/db';
import { MeasurementSchema } from '@fitfusion/core';
import { encryptToken, decryptToken } from '@/lib/health-crypto';
import {
  FitApiError,
  buildAggregateRequest,
  exchangeCodeForTokens,
  newOAuthState,
  parseStepsAggregate,
  parseWeightAggregate,
  refreshAccessToken,
  sealTokens,
  validateOAuthState,
} from '@/lib/google-fit';
import { GET as connectGET } from '@/app/api/health/google/connect/route';
import { GET as callbackGET } from '@/app/api/health/google/callback/route';
import { GET as statusGET } from '@/app/api/health/google/status/route';
import { POST as syncPOST } from '@/app/api/health/google/sync/route';
import { DELETE as disconnectDELETE } from '@/app/api/health/google/disconnect/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

const TEST_SYNC_SECRET = 'ab'.repeat(32); // 64 hex chars
const TEST_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const TEST_CLIENT_SECRET = 'test-client-secret';

const savedEnv: Record<string, string | undefined> = {};

function setFitEnv() {
  for (const k of ['HEALTH_SYNC_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
    savedEnv[k] = process.env[k];
  }
  process.env.HEALTH_SYNC_SECRET = TEST_SYNC_SECRET;
  process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = TEST_CLIENT_SECRET;
}

function restoreEnv() {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

/* ------------------------- mocked Google HTTP ------------------------- */

interface MockRoute {
  match: (url: string, init?: RequestInit) => boolean;
  respond: (url: string, init?: RequestInit) => { status: number; body: unknown };
}

let mockRoutes: MockRoute[] = [];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const route = mockRoutes.find((r) => r.match(url, init));
      if (!route) throw new Error(`unexpected fetch to ${url}`);
      const { status, body } = route.respond(url, init);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function stepsAggregateBody(days: { dayStartMs: number; steps: number }[]) {
  return {
    bucket: days.map((d) => ({
      startTimeMillis: String(d.dayStartMs),
      endTimeMillis: String(d.dayStartMs + 86_400_000),
      dataset: [
        {
          dataSourceId: 'derived:com.google.step_count.delta:mock',
          point: [{ value: [{ intVal: d.steps }] }],
        },
      ],
    })),
  };
}

function weightAggregateBody(readings: { dayStartMs: number; kg: number }[]) {
  return {
    bucket: readings.map((r) => ({
      startTimeMillis: String(r.dayStartMs),
      endTimeMillis: String(r.dayStartMs + 86_400_000),
      dataset: [
        {
          dataSourceId: 'derived:com.google.weight.summary:mock',
          point: [{ value: [{ fpVal: r.kg }] }],
        },
      ],
    })),
  };
}

function mockTokenSuccess() {
  mockRoutes.push({
    match: (url) => url.includes('oauth2.googleapis.com/token'),
    respond: () => ({
      status: 200,
      body: {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    }),
  });
}

function mockFitnessAggregates(
  steps: { dayStartMs: number; steps: number }[],
  weights: { dayStartMs: number; kg: number }[],
) {
  mockRoutes.push({
    match: (url, init) =>
      url.includes('googleapis.com/fitness/v1/users/me/dataset:aggregate') &&
      String(init?.body).includes('com.google.step_count.delta'),
    respond: () => ({ status: 200, body: stepsAggregateBody(steps) }),
  });
  mockRoutes.push({
    match: (url, init) =>
      url.includes('googleapis.com/fitness/v1/users/me/dataset:aggregate') &&
      String(init?.body).includes('com.google.weight.summary'),
    respond: () => ({ status: 200, body: weightAggregateBody(weights) }),
  });
}

async function authedUser() {
  const email = uniqueEmail('ff-fit');
  const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
  return { userId, token };
}

function withSession(url: string, token: string, cookie?: string): NextRequest {
  const req = new NextRequest(url);
  authed(req, token);
  if (cookie) req.cookies.set('ff_fit_oauth_state', cookie);
  return req;
}

beforeAll(() => {
  setFitEnv();
  stubFetch();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  restoreEnv();
  await cleanupUsers();
});

/* ------------------------------- crypto -------------------------------- */

describe('health token encryption', () => {
  it('round-trips through AES-256-GCM', () => {
    const enc = encryptToken('secret-token-value');
    expect(enc).not.toContain('secret-token-value');
    expect(decryptToken(enc)).toBe('secret-token-value');
  });

  it('rejects tampered payloads', () => {
    const enc = encryptToken('abc');
    const tampered = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA');
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('rejects malformed payloads', () => {
    expect(() => decryptToken('not-a-payload')).toThrow();
    expect(() => decryptToken('')).toThrow();
  });
});

/* --------------------------- OAuth state -------------------------------- */

describe('OAuth state validation', () => {
  it('accepts a matching state', () => {
    const s = newOAuthState();
    expect(validateOAuthState(s, s)).toBe(true);
  });

  it('rejects a tampered state', () => {
    const s = newOAuthState();
    expect(validateOAuthState(s, s + 'x')).toBe(false);
    expect(validateOAuthState(s, 'attacker-state')).toBe(false);
  });

  it('rejects missing state', () => {
    expect(validateOAuthState(undefined, 'x')).toBe(false);
    expect(validateOAuthState('x', null)).toBe(false);
  });
});

/* --------------------------- aggregate parsing -------------------------- */

describe('fitness aggregate parsing', () => {
  it('sums daily steps and never invents data on empty buckets', () => {
    const now = Date.now();
    const day = 86_400_000;
    const parsed = parseStepsAggregate(
      stepsAggregateBody([
        { dayStartMs: now - 2 * day, steps: 1000 },
        { dayStartMs: now - day, steps: 2500 },
      ]),
    );
    expect(parsed.map((p) => p.steps)).toEqual([1000, 2500]);
    expect(parseStepsAggregate({ bucket: [] })).toEqual([]);
    expect(parseStepsAggregate(null as never)).toEqual([]);
  });

  it('takes the last weight reading of a day; empty → []', () => {
    const now = Date.now();
    const parsed = parseWeightAggregate(weightAggregateBody([{ dayStartMs: now, kg: 72.5 }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].kg).toBeCloseTo(72.5);
    expect(parseWeightAggregate({ bucket: [] })).toEqual([]);
  });

  it('builds a well-formed aggregate request', () => {
    const body = buildAggregateRequest('com.google.step_count.delta', 7, 1_700_000_000_000);
    expect(body.aggregateBy[0].dataTypeName).toBe('com.google.step_count.delta');
    expect(body.bucketByTime.durationMillis).toBe(86_400_000);
    expect(body.endTimeMillis - body.startTimeMillis).toBe(7 * 86_400_000);
  });
});

/* ------------------------------ token flow ------------------------------ */

describe('token exchange / refresh (mocked HTTP)', () => {
  it('exchanges an auth code for a token set', async () => {
    mockRoutes = [];
    mockTokenSuccess();
    const tokens = await exchangeCodeForTokens('auth-code-123');
    expect(tokens.accessToken).toBe('mock-access-token');
    expect(tokens.refreshToken).toBe('mock-refresh-token');
    expect(tokens.expiresIn).toBe(3600);
  });

  it('throws FitApiError when Google rejects the code', async () => {
    mockRoutes = [
      {
        match: (url) => url.includes('oauth2.googleapis.com/token'),
        respond: () => ({
          status: 400,
          body: { error: 'invalid_grant', error_description: 'Bad code' },
        }),
      },
    ];
    await expect(exchangeCodeForTokens('bad-code')).rejects.toBeInstanceOf(FitApiError);
  });

  it('keeps the caller refresh token when Google omits it on refresh', async () => {
    mockRoutes = [
      {
        match: (url) => url.includes('oauth2.googleapis.com/token'),
        respond: () => ({
          status: 200,
          body: { access_token: 'new-access', expires_in: 3600 },
        }),
      },
    ];
    const refreshed = await refreshAccessToken('old-refresh');
    expect(refreshed.accessToken).toBe('new-access');
    expect(refreshed.refreshToken).toBe('old-refresh');
  });

  it('MeasurementSchema accepts the new "steps" type', () => {
    expect(
      MeasurementSchema.safeParse({ type: 'steps', value: 8000, unit: 'steps' }).success,
    ).toBe(true);
  });
});

/* -------------------------------- routes -------------------------------- */

describe('GET /api/health/google/connect', () => {
  it('503s when not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { userId, token } = await authedUser();
    void userId;
    const res = await connectGET(withSession('http://localhost/api/health/google/connect', token));
    expect(res.status).toBe(503);
    expect((await readJson(res)).error.code).toBe('not_configured');
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
  });

  it('302-redirects to Google with state + httpOnly cookie when configured', async () => {
    const { token } = await authedUser();
    const res = await connectGET(withSession('http://localhost/api/health/google/connect', token));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain(encodeURIComponent('fitness.activity.read'));
    expect(location).toContain(encodeURIComponent('fitness.body.read'));
    expect(location).toContain('access_type=offline');
    expect(location).toContain('prompt=consent');
    const stateParam = new URL(location).searchParams.get('state');
    expect(stateParam).toBeTruthy();
    const cookie = res.cookies.get('ff_fit_oauth_state');
    expect(cookie?.value).toBe(stateParam);
    expect(cookie?.httpOnly).toBe(true);
  });
});

describe('GET /api/health/google/callback', () => {
  it('rejects a tampered state with an error redirect (no tokens stored)', async () => {
    const { userId, token } = await authedUser();
    mockRoutes = [];
    mockTokenSuccess();
    const realState = newOAuthState();
    const req = withSession(
      `http://localhost/api/health/google/callback?code=code1&state=tampered`,
      token,
      realState,
    );
    const res = await callbackGET(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('fit')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('invalid_state');
    expect(await prisma.healthConnection.findUnique({ where: { userId } })).toBeNull();
  });

  it('stores encrypted tokens on a valid callback', async () => {
    const { userId, token } = await authedUser();
    mockRoutes = [];
    mockTokenSuccess();
    const state = newOAuthState();
    const req = withSession(
      `http://localhost/api/health/google/callback?code=code2&state=${state}`,
      token,
      state,
    );
    const res = await callbackGET(req);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('fit')).toBe('connected');
    const conn = await prisma.healthConnection.findUnique({ where: { userId } });
    expect(conn).not.toBeNull();
    expect(conn!.accessTokenEnc).not.toContain('mock-access-token');
    expect(decryptToken(conn!.accessTokenEnc)).toBe('mock-access-token');
    expect(decryptToken(conn!.refreshTokenEnc!)).toBe('mock-refresh-token');
  });

  it('redirects with reason=denied when the user declines at Google', async () => {
    const { token } = await authedUser();
    const req = withSession(
      'http://localhost/api/health/google/callback?error=access_denied',
      token,
    );
    const res = await callbackGET(req);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('reason')).toBe('denied');
  });
});

describe('POST /api/health/google/sync + status + disconnect', () => {
  it('404s when not connected', async () => {
    const { token } = await authedUser();
    const req = authed(
      jsonRequest('http://localhost/api/health/google/sync', 'POST'),
      token,
    );
    const res = await syncPOST(req);
    expect(res.status).toBe(404);
    expect((await readJson(res)).error.code).toBe('not_connected');
  });

  it('imports steps + weight, refreshes an expired token, and never duplicates', async () => {
    const { userId, token } = await authedUser();
    const now = Date.now();
    const day = 86_400_000;
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    // Seed an expired connection with a refresh token.
    const sealed = sealTokens({
      accessToken: 'expired-access',
      refreshToken: 'valid-refresh',
      expiresIn: 3600,
    });
    await prisma.healthConnection.create({
      data: {
        userId,
        provider: 'google',
        accessTokenEnc: sealed.accessTokenEnc,
        refreshTokenEnc: sealed.refreshTokenEnc,
        accessTokenExpiresAt: new Date(now - 1000), // expired
      },
    });

    mockRoutes = [];
    // refresh endpoint: returns a new access token, no refresh token
    mockRoutes.push({
      match: (url, init) =>
        url.includes('oauth2.googleapis.com/token') &&
        String(init?.body).includes('grant_type=refresh_token'),
      respond: () => ({
        status: 200,
        body: { access_token: 'fresh-access-token', expires_in: 3600 },
      }),
    });
    mockFitnessAggregates(
      [
        { dayStartMs: dayStart.getTime() - 2 * day, steps: 3000 },
        { dayStartMs: dayStart.getTime() - day, steps: 5000 },
        { dayStartMs: dayStart.getTime(), steps: 1234 },
      ],
      [{ dayStartMs: dayStart.getTime(), kg: 71.8 }],
    );

    const authedSync = () => {
      const req = jsonRequest('http://localhost/api/health/google/sync', 'POST');
      return authed(req, token);
    };
    const res1 = await syncPOST(authedSync());
    expect(res1.status).toBe(200);
    const body1 = await readJson(res1);
    expect(body1.imported.stepDays).toBe(3);
    expect(body1.imported.stepsUpserted).toBe(3);
    expect(body1.imported.weightImported).toBe(true);
    expect(body1.imported.weightKg).toBeCloseTo(71.8);

    // Access token was rotated and the old refresh token preserved.
    const conn = await prisma.healthConnection.findUnique({ where: { userId } });
    expect(decryptToken(conn!.accessTokenEnc)).toBe('fresh-access-token');
    expect(decryptToken(conn!.refreshTokenEnc!)).toBe('valid-refresh');
    expect(conn!.lastSyncAt).not.toBeNull();

    const stepsRows = await prisma.measurement.findMany({
      where: { userId, type: 'steps' },
      orderBy: { recordedAt: 'asc' },
    });
    expect(stepsRows.map((r) => r.value)).toEqual([3000, 5000, 1234]);
    expect(new Set(stepsRows.map((r) => r.unit))).toEqual(new Set(['steps']));
    const weightRows = await prisma.measurement.findMany({
      where: { userId, type: 'weight', note: 'Imported from Google Fit' },
    });
    expect(weightRows).toHaveLength(1);
    expect(weightRows[0].unit).toBe('kg');

    // Second sync with identical data: no duplicates, no new writes.
    const res2 = await syncPOST(authedSync());
    expect(res2.status).toBe(200);
    expect((await readJson(res2)).imported.stepsUpserted).toBe(0);
    expect(
      await prisma.measurement.count({ where: { userId, type: 'steps' } }),
    ).toBe(3);
    expect(
      await prisma.measurement.count({
        where: { userId, type: 'weight', note: 'Imported from Google Fit' },
      }),
    ).toBe(1);

    // Status reflects the connection and today's steps.
    const statusRes = await statusGET(
      withSession('http://localhost/api/health/google/status', token),
    );
    const statusBody = await readJson(statusRes);
    expect(statusBody.connected).toBe(true);
    expect(statusBody.stepsToday).toBe(1234);
    expect(statusBody.lastSyncAt).toBeTruthy();

    // Disconnect clears the tokens; imported measurements stay.
    const delRes = await disconnectDELETE(
      withSession('http://localhost/api/health/google/disconnect', token),
    );
    expect(delRes.status).toBe(200);
    expect((await readJson(delRes)).connected).toBe(false);
    expect(await prisma.healthConnection.findUnique({ where: { userId } })).toBeNull();
    expect(await prisma.measurement.count({ where: { userId, type: 'steps' } })).toBe(3);

    const statusAfter = await readJson(
      await statusGET(withSession('http://localhost/api/health/google/status', token)),
    );
    expect(statusAfter.connected).toBe(false);
    expect(statusAfter.stepsToday).toBeNull();
  });

  it('handles empty Google data honestly: no rows, empty:true', async () => {
    const { userId, token } = await authedUser();
    const sealed = sealTokens({
      accessToken: 'valid-access',
      refreshToken: 'valid-refresh',
      expiresIn: 3600,
    });
    await prisma.healthConnection.create({
      data: {
        userId,
        provider: 'google',
        accessTokenEnc: sealed.accessTokenEnc,
        refreshTokenEnc: sealed.refreshTokenEnc,
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    mockRoutes = [];
    mockFitnessAggregates([], []);
    const req = jsonRequest('http://localhost/api/health/google/sync', 'POST');
    const res = await syncPOST(authed(req, token));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.empty).toBe(true);
    expect(body.imported.stepDays).toBe(0);
    expect(body.imported.weightKg).toBeNull();
    expect(await prisma.measurement.count({ where: { userId } })).toBe(0);
  });
});
