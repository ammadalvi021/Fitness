/**
 * Phase 4 regression (+ unit-conversion fix, 2026-10-09): getSessionUser
 * attaches the latest weight Measurement as `weightKg` on the session
 * profile (SessionProfile in apps/web/lib/auth.ts), CONVERTED TO KILOGRAMS
 * using the measurement's stored `unit`:
 *
 *   kg / kgs / kilogram / kilograms -> as-is
 *   lb / lbs / pound / pounds       -> converted via kgFromLb
 *   anything else                   -> weightKg is NOT attached (never guess;
 *                                      the unit is logged server-side)
 *
 * Before the fix, the raw value was attached as-is: a 150 lb measurement
 * surfaced as weightKg: 150 and inflated every downstream calorie/macro/
 * water target. These tests pin the converted behavior.
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { getSessionUser } from '@/lib/auth';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as meGET } from '@/app/api/auth/me/route';
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

describe('getSessionUser weightKg attachment', () => {
  afterAll(cleanupUsers);

  it('profile without any weight measurement has no weightKg', async () => {
    const email = uniqueEmail('ff-w0');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    // onboarding without weightKg -> profile exists, no measurement
    const ob = await onboardingPOST(
      authed(jsonRequest('http://localhost/api/onboarding', 'POST', { goal: 'maintain' }), token),
    );
    expect(ob.status).toBe(200);

    const me = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(me.status).toBe(200);
    const body = await readJson(me);
    expect(body.profile).toBeTruthy();
    expect(body.profile.weightKg).toBeUndefined();

    // direct unit-level check of getSessionUser as well
    const s = await getSessionUser(authed(new NextRequest('http://localhost/api/x'), token));
    expect(s?.profile?.weightKg).toBeUndefined();
  });

  it('onboarding weightKg is attached to the session profile (kg, as-is)', async () => {
    const email = uniqueEmail('ff-w1');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const ob = await onboardingPOST(
      authed(
        jsonRequest('http://localhost/api/onboarding', 'POST', { goal: 'lose', weightKg: 72 }),
        token,
      ),
    );
    expect(ob.status).toBe(200);

    const me = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(me.status).toBe(200);
    expect((await readJson(me)).profile.weightKg).toBe(72);

    const s = await getSessionUser(authed(new NextRequest('http://localhost/api/x'), token));
    expect(s?.profile?.weightKg).toBe(72);
  });

  it('a later weight measurement in lb is converted to kg before attaching', async () => {
    const email = uniqueEmail('ff-w2');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    await onboardingPOST(
      authed(
        jsonRequest('http://localhost/api/onboarding', 'POST', { goal: 'lose', weightKg: 72 }),
        token,
      ),
    );

    // second measurement in lb, explicitly later than the onboarding one so
    // "latest by recordedAt" is deterministic
    const later = new Date(Date.now() + 60_000).toISOString();
    const m = await measurementsPOST(
      authed(
        jsonRequest('http://localhost/api/measurements', 'POST', {
          type: 'weight',
          value: 150,
          unit: 'lb',
          recordedAt: later,
        }),
        token,
      ),
    );
    expect(m.status).toBe(201);

    const me = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(me.status).toBe(200);
    // 150 lb -> kg, NOT the raw 150 (the old buggy behavior).
    expect((await readJson(me)).profile.weightKg).toBeCloseTo(68.0388555, 4);

    const s = await getSessionUser(authed(new NextRequest('http://localhost/api/x'), token));
    expect(s?.profile?.weightKg).toBeCloseTo(68.0388555, 4);

    // a still-later kg measurement replaces it (as-is, no conversion)
    const latest = new Date(Date.now() + 120_000).toISOString();
    await measurementsPOST(
      authed(
        jsonRequest('http://localhost/api/measurements', 'POST', {
          type: 'weight',
          value: 75,
          unit: 'kg',
          recordedAt: latest,
        }),
        token,
      ),
    );
    const me2 = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect((await readJson(me2)).profile.weightKg).toBe(75);
  });

  it('unit aliases are handled case-insensitively', async () => {
    const email = uniqueEmail('ff-w3');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);

    const m = await measurementsPOST(
      authed(
        jsonRequest('http://localhost/api/measurements', 'POST', {
          type: 'weight',
          value: 165,
          unit: 'LBS',
          recordedAt: new Date().toISOString(),
        }),
        token,
      ),
    );
    expect(m.status).toBe(201);

    const s = await getSessionUser(authed(new NextRequest('http://localhost/api/x'), token));
    // 165 lbs -> kg
    expect(s?.profile?.weightKg).toBeCloseTo(74.8427411, 4);
  });

  it('an unrecognized unit never guesses — weightKg is left unset', async () => {
    const email = uniqueEmail('ff-w4');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    await onboardingPOST(
      authed(
        jsonRequest('http://localhost/api/onboarding', 'POST', { goal: 'maintain' }),
        token,
      ),
    );

    const m = await measurementsPOST(
      authed(
        jsonRequest('http://localhost/api/measurements', 'POST', {
          type: 'weight',
          value: 12,
          unit: 'stone',
          recordedAt: new Date().toISOString(),
        }),
        token,
      ),
    );
    expect(m.status).toBe(201);

    const s = await getSessionUser(authed(new NextRequest('http://localhost/api/x'), token));
    expect(s?.profile).toBeTruthy();
    expect(s?.profile?.weightKg).toBeUndefined();

    const me = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect((await readJson(me)).profile.weightKg).toBeUndefined();
  });
});
