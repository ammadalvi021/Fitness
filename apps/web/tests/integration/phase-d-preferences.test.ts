/**
 * Phase D — workout-type preferences (API wiring).
 * DB-backed — skipped gracefully when no PostgreSQL is reachable.
 * Route handlers are imported directly and called with real requests
 * against the real database, following guided-sessions-api.test.ts /
 * extended-flows.test.ts patterns.
 *
 * Verifies:
 *  (a) PUT /api/settings dedupes workoutTypes (first-occurrence order)
 *      and GET /api/settings returns the same value.
 *  (b) PUT /api/settings rejects an invalid workout type with
 *      400 validation_error.
 *  (c) PUT /api/profile stores workoutTypes and GET /api/profile
 *      returns it (whole profile row).
 *  (d) PUT /api/profile rejects an invalid workout type with 400.
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/settings/route';
import { GET as profileGET, PUT as profilePUT } from '@/app/api/profile/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

describe.skipIf(!HAS_DB)('Phase D workout-type preferences (DB)', () => {
  afterAll(async () => {
    await cleanupUsers();
  });

  it('(a) PUT /api/settings dedupes workoutTypes preserving order; GET returns the same', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-phase-d'),
    );

    const putRes = await settingsPUT(
      authed(
        jsonRequest('http://localhost/api/settings', 'PUT', {
          workoutTypes: ['yoga', 'strength', 'yoga'],
        }),
        token,
      ),
    );
    expect(putRes.status).toBe(200);
    const putBody = await readJson(putRes);
    expect(putBody.settings.workoutTypes).toEqual(['yoga', 'strength']);

    const getRes = await settingsGET(
      authed(new NextRequest('http://localhost/api/settings'), token),
    );
    expect(getRes.status).toBe(200);
    const getBody = await readJson(getRes);
    expect(getBody.settings.workoutTypes).toEqual(['yoga', 'strength']);
  });

  it('(b) PUT /api/settings rejects an invalid workout type with 400 validation_error', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-phase-d'),
    );

    const res = await settingsPUT(
      authed(
        jsonRequest('http://localhost/api/settings', 'PUT', {
          workoutTypes: ['cardio'],
        }),
        token,
      ),
    );
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('(c) PUT /api/profile stores workoutTypes; GET /api/profile returns it', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-phase-d'),
    );

    const putRes = await profilePUT(
      authed(
        jsonRequest('http://localhost/api/profile', 'PUT', {
          workoutTypes: ['aerobics', 'yoga'],
        }),
        token,
      ),
    );
    expect(putRes.status).toBe(200);
    const putBody = await readJson(putRes);
    expect(putBody.profile.workoutTypes).toEqual(['aerobics', 'yoga']);

    const getRes = await profileGET(
      authed(new NextRequest('http://localhost/api/profile'), token),
    );
    expect(getRes.status).toBe(200);
    const getBody = await readJson(getRes);
    expect(getBody.profile.workoutTypes).toEqual(['aerobics', 'yoga']);
  });

  it('(d) PUT /api/profile rejects an invalid workout type with 400', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-phase-d'),
    );

    const res = await profilePUT(
      authed(
        jsonRequest('http://localhost/api/profile', 'PUT', {
          workoutTypes: ['running'],
        }),
        token,
      ),
    );
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error.code).toBe('validation_error');
  });
});
