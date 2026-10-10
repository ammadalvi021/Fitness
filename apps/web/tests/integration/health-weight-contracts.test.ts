/**
 * Phase 5 (V2 hardening) tests: health-check and weight-conversion contracts.
 *
 * Covers §8 items:
 *  11. Health check with env vars set but no `.env` file present. The
 *      `GET /api/health` route calls `checkEnv()` (which normally resolves
 *      the real repo root); here it is pointed at an empty temp dir via a
 *      module mock, while DATABASE_URL / SESSION_SECRET stay set in
 *      `process.env` — i.e. "env vars set, no .env file". Contract asserted:
 *      the response is `{ ok, checks }` and carries NO secret values
 *      (names only, never values).
 *  12. Kilogram / pound weight conversion on the session profile, per the
 *      landed implementation in `apps/web/lib/auth.ts` (`measurementWeightKg`):
 *      kg/kgs/kilogram/kilograms attach as-is; lb/lbs/pound/pounds convert to
 *      kg (× 0.45359237, `kgFromLb` from @fitfusion/core units.ts); any
 *      unknown unit means weightKg is NOT attached (never guessed; the unit
 *      is logged server-side). Both `GET /api/auth/me` and `getSessionUser`
 *      must agree. (The existing weightkg-regression.test.ts pins the same
 *      contract in more depth; these assertions are the §8.12 contract
 *      coverage owned by this file.)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdirSync } from 'node:fs';
import { prisma } from '@fitfusion/db';
import { checkEnv } from '../../../../scripts/check-env.mjs';
import { getSessionUser } from '@/lib/auth';
import { GET as healthGET } from '@/app/api/health/route';
import { GET as meGET } from '@/app/api/auth/me/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as onboardingPOST } from '@/app/api/onboarding/route';
import { POST as measurementsPOST } from '@/app/api/measurements/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

// --- per-test env save/restore ---------------------------------------------
const envStack: Array<Record<string, string | undefined>> = [];
function pushEnv(vars: Record<string, string | undefined>) {
  envStack.push(
    Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]])),
  );
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
function popEnv() {
  while (envStack.length) {
    const snap = envStack.pop()!;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
afterAll(cleanupUsers);

// A temp dir with NO .env file (and no apps/web subdir) — simulates an
// environment where config comes only from process.env.
const FAKE_ROOT = vi.hoisted(
  () => `/tmp/ff-health-noenv-${process.pid}`,
);
vi.mock('../../../../../scripts/check-env.mjs', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, (...a: unknown[]) => unknown>;
  return {
    ...real,
    checkEnv: (dir?: string) => real.checkEnv(dir ?? FAKE_ROOT),
  };
});

beforeAll(() => {
  mkdirSync(FAKE_ROOT, { recursive: true });
});

describe('health check with env vars set but no .env file (§8.11)', () => {
  it('checkEnv finds required vars via process.env and reports no .env file', () => {
    pushEnv({ SESSION_SECRET: 'ff_health_test_secret_value_xyz' });
    try {
      const r = checkEnv(FAKE_ROOT);
      expect(r.envFileExists).toBe(false);
      // env vars are present, so none are reported missing...
      expect(r.missingVars).toEqual([]);
      // ...and the report names only variable NAMES, never values.
      expect(JSON.stringify(r)).not.toContain('ff_health_test_secret_value_xyz');
      expect(JSON.stringify(r)).not.toContain(String(process.env.DATABASE_URL));
    } finally {
      popEnv();
    }
  });

  it('GET /api/health returns {ok, checks} with no secret values and working DB checks', async () => {
    const plantedSecret = 'ff_health_test_secret_value_xyz';
    pushEnv({ SESSION_SECRET: plantedSecret });
    try {
      const res = await healthGET();
      const body = await readJson(res);

      // Contract shape: { ok, checks: { database, env, migrations } }.
      expect(typeof body.ok).toBe('boolean');
      expect(body.checks).toBeTruthy();
      expect(typeof body.checks.database?.ok).toBe('boolean');
      expect(typeof body.checks.migrations?.ok).toBe('boolean');
      expect(typeof body.checks.env?.ok).toBe('boolean');
      expect(Array.isArray(body.checks.env.missingVars)).toBe(true);

      // The database and migration checks run against the real DB — they do
      // not depend on the .env file being present.
      expect(body.checks.database.ok).toBe(true);
      expect(body.checks.migrations.ok).toBe(true);

      // No secret VALUES anywhere in the response (names only).
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(plantedSecret);
      expect(serialized).not.toContain(String(process.env.DATABASE_URL));
      for (const name of body.checks.env.missingVars as string[]) {
        expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/); // a var NAME, not a value
      }
    } finally {
      popEnv();
    }
  });
});

describe('session weightKg unit conversion (§8.12)', () => {
  const KG_PER_LB = 0.45359237;

  async function authedToken(prefix: string) {
    const email = uniqueEmail(prefix);
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const ob = await onboardingPOST(
      authed(jsonRequest('http://localhost/api/onboarding', 'POST', { goal: 'maintain' }), token),
    );
    expect(ob.status).toBe(200);
    return token;
  }

  async function logWeight(token: string, value: number, unit: string, recordedAt: string) {
    const m = await measurementsPOST(
      authed(
        jsonRequest('http://localhost/api/measurements', 'POST', {
          type: 'weight',
          value,
          unit,
          recordedAt,
        }),
        token,
      ),
    );
    expect(m.status).toBe(201);
  }

  async function sessionWeightKg(token: string): Promise<number | undefined | null> {
    const me = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(me.status).toBe(200);
    const viaMe = (await readJson(me)).profile.weightKg;
    const s = await getSessionUser(authed(new NextRequest('http://localhost/api/x'), token));
    const viaSession = s?.profile?.weightKg;
    // both paths must agree
    expect(viaSession).toEqual(viaMe);
    return viaMe;
  }

  it('kg measurements are attached unchanged (incl. kg aliases)', async () => {
    const token = await authedToken('ff-wconv-kg');
    const t = (ms: number) => new Date(Date.now() + ms).toISOString();
    await logWeight(token, 75, 'kg', t(60_000));
    expect(await sessionWeightKg(token)).toBe(75);
    await logWeight(token, 80, 'kilograms', t(120_000));
    expect(await sessionWeightKg(token)).toBe(80);
    await logWeight(token, 85, 'kgs', t(180_000));
    expect(await sessionWeightKg(token)).toBe(85);
  });

  it('lb measurements are converted to kg', async () => {
    const token = await authedToken('ff-wconv-lb');
    await logWeight(token, 150, 'lb', new Date(Date.now() + 60_000).toISOString());
    expect(await sessionWeightKg(token)).toBeCloseTo(150 * KG_PER_LB, 10);
  });

  it('lbs / pound / POUNDS variants are converted to kg', async () => {
    const token = await authedToken('ff-wconv-vars');
    const t = (ms: number) => new Date(Date.now() + ms).toISOString();
    await logWeight(token, 100, 'lbs', t(60_000));
    expect(await sessionWeightKg(token)).toBeCloseTo(100 * KG_PER_LB, 10);
    await logWeight(token, 200, 'pound', t(120_000));
    expect(await sessionWeightKg(token)).toBeCloseTo(200 * KG_PER_LB, 10);
    await logWeight(token, 300, 'POUNDS', t(180_000));
    expect(await sessionWeightKg(token)).toBeCloseTo(300 * KG_PER_LB, 10);
  });

  it('an unknown unit never guesses — weightKg is left unset', async () => {
    const token = await authedToken('ff-wconv-unknown');
    await logWeight(token, 42, 'stone', new Date(Date.now() + 60_000).toISOString());
    // Safe default per the contract: not attached, never guessed.
    expect(await sessionWeightKg(token)).toBeUndefined();
  });

  it('the latest measurement wins, in its own unit', async () => {
    const token = await authedToken('ff-wconv-latest');
    const t = (ms: number) => new Date(Date.now() + ms).toISOString();
    await logWeight(token, 150, 'lb', t(60_000));
    expect(await sessionWeightKg(token)).toBeCloseTo(150 * KG_PER_LB, 10);
    await logWeight(token, 75, 'kg', t(120_000));
    expect(await sessionWeightKg(token)).toBe(75);
  });

  it('no weight measurement -> weightKg is undefined', async () => {
    const token = await authedToken('ff-wconv-none');
    expect(await sessionWeightKg(token)).toBeUndefined();
  });
});
