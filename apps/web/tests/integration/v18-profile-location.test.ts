/**
 * V18 profile location fields: PUT validation + normalization through
 * /api/profile. DB-backed — skipped gracefully when no PostgreSQL is reachable.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
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

describe.skipIf(!HAS_DB)('V18 profile location fields', () => {
  let token = '';

  afterAll(cleanupUsers);

  it('registers a user', async () => {
    ({ token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-v18loc')));
    expect(token).toBeTruthy();
  });

  it('PUT accepts a full location payload and normalizes the country code', async () => {
    const res = await profilePUT(
      authed(
        jsonRequest('http://localhost/api/profile', 'PUT', {
          country: 'pk',
          cityRegion: 'Lahore',
          language: 'roman-ur',
          unitSystem: 'metric',
          ramadanMode: true,
          halalOnly: true,
        }),
        token,
      ),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.profile.country).toBe('PK');
    expect(body.profile.cityRegion).toBe('Lahore');
    expect(body.profile.language).toBe('roman-ur');
    expect(body.profile.unitSystem).toBe('metric');
    expect(body.profile.ramadanMode).toBe(true);
    expect(body.profile.halalOnly).toBe(true);
  });

  it('GET returns the stored location fields', async () => {
    const { NextRequest } = await import('next/server');
    const res = await profileGET(
      authed(new NextRequest('http://localhost/api/profile'), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.profile.country).toBe('PK');
    expect(body.profile.language).toBe('roman-ur');
  });

  it('PUT rejects invalid location values with 400', async () => {
    for (const bad of [
      { country: 'PKK' },
      { country: 'P' },
      { language: 'punjabi' },
      { unitSystem: 'us' },
      { cityRegion: '' },
      { ramadanMode: 'yes' },
    ]) {
      const res = await profilePUT(
        authed(jsonRequest('http://localhost/api/profile', 'PUT', bad), token),
      );
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });
});
