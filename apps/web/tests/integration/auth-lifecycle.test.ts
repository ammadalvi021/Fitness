/**
 * Phase 4 regression: auth lifecycle extras + persistence across re-login.
 * (Basic register->login->me->logout->401 is covered in auth-flow.test.ts;
 * diary idempotency itself is covered in diary-idempotency.test.ts.)
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as logoutPOST } from '@/app/api/auth/logout/route';
import { GET as meGET } from '@/app/api/auth/me/route';
import { POST as diaryPOST, GET as diaryGET } from '@/app/api/diary/route';
import { POST as measurementsPOST, GET as measurementsGET } from '@/app/api/measurements/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

describe('auth lifecycle extras', () => {
  afterAll(cleanupUsers);

  it('rejects a wrong password for an EXISTING user with 401', async () => {
    const email = uniqueEmail('ff-wrongpw');
    await registerAndLogin(registerPOST, loginPOST, email, 'Right1234');
    const res = await loginPOST(
      jsonRequest('http://localhost/api/auth/login', 'POST', {
        email,
        password: 'Wrong1234',
      }),
    );
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe('invalid_credentials');
  });

  it('profile data persists: name given at register shows on /me', async () => {
    const email = uniqueEmail('ff-persist');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const me = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(me.status).toBe(200);
    const body = await readJson(me);
    expect(body.user.email).toBe(email);
    expect(body.user.name).toBe('Test User'); // helpers.ts registers name 'Test User'
  });

  it('data survives logout + re-login (new session, same rows)', async () => {
    const email = uniqueEmail('ff-relogin');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);

    // create rows under the first session
    const d = await diaryPOST(
      authed(
        jsonRequest('http://localhost/api/diary', 'POST', {
          date: '2026-10-09',
          mealType: 'dinner',
          customName: 'Persistence bowl',
          servings: 1,
          kcal: 500,
          proteinG: 30,
        }),
        token,
      ),
    );
    expect(d.status).toBe(201);
    const entryId = (await readJson(d)).entry.id;

    const m = await measurementsPOST(
      authed(
        jsonRequest('http://localhost/api/measurements', 'POST', {
          type: 'weight',
          value: 70,
          unit: 'kg',
        }),
        token,
      ),
    );
    expect(m.status).toBe(201);

    // logout kills the old session
    const lo = await logoutPOST(
      authed(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }), token),
    );
    expect(lo.status).toBe(200);
    const meOld = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(meOld.status).toBe(401);

    // re-login issues a NEW session token; the rows must still be there
    const login2 = await loginPOST(
      jsonRequest('http://localhost/api/auth/login', 'POST', { email, password: 'Test1234' }),
    );
    expect(login2.status).toBe(200);
    const token2 = login2.cookies.get('ff_session')?.value;
    expect(token2).toBeTruthy();
    expect(token2).not.toBe(token);

    const diary = await diaryGET(
      authed(new NextRequest('http://localhost/api/diary?date=2026-10-09'), token2!),
    );
    expect(diary.status).toBe(200);
    const diaryBody = await readJson(diary);
    expect(diaryBody.entries.map((e: any) => e.id)).toContain(entryId);

    const ms = await measurementsGET(
      authed(new NextRequest('http://localhost/api/measurements?type=weight'), token2!),
    );
    expect(ms.status).toBe(200);
    expect((await readJson(ms)).measurements.length).toBeGreaterThan(0);
  });
});
