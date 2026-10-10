/**
 * (a) register -> login -> me -> logout flow
 * (d) unauthenticated /api/diary -> 401
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as logoutPOST } from '@/app/api/auth/logout/route';
import { GET as meGET } from '@/app/api/auth/me/route';
import { GET as diaryGET } from '@/app/api/diary/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  sessionTokenFrom,
  uniqueEmail,
} from './helpers';

describe('auth flow: register -> login -> me -> logout', () => {
  afterAll(cleanupUsers);

  it('registers, logs in, reads me, logs out, and is then unauthorized', async () => {
    const email = uniqueEmail('ff-auth');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    expect(userId).toBeTruthy();

    // me (authenticated)
    const meRes = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(meRes.status).toBe(200);
    const meBody = await readJson(meRes);
    expect(meBody.user.email).toBe(email);
    expect(meBody.subscription.planId).toBe('free');

    // logout
    const logoutRes = await logoutPOST(authed(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }), token));
    expect(logoutRes.status).toBe(200);

    // me after logout -> 401
    const meAfter = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(meAfter.status).toBe(401);
    const errBody = await readJson(meAfter);
    expect(errBody.error.code).toBe('unauthorized');
  });

  it('rejects duplicate registration with 409', async () => {
    const email = uniqueEmail('ff-dup');
    const first = await registerPOST(
      jsonRequest('http://localhost/api/auth/register', 'POST', { email, password: 'Test1234' }),
    );
    expect(first.status).toBe(201);
    const body = await readJson(first);
    const { trackUser } = await import('./helpers');
    trackUser(body.user.id);

    const second = await registerPOST(
      jsonRequest('http://localhost/api/auth/register', 'POST', { email, password: 'Test1234' }),
    );
    expect(second.status).toBe(409);
    expect((await readJson(second)).error.code).toBe('email_taken');
  });

  it('rejects bad credentials with 401', async () => {
    const res = await loginPOST(
      jsonRequest('http://localhost/api/auth/login', 'POST', {
        email: uniqueEmail('ff-nope'),
        password: 'Wrong1234',
      }),
    );
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe('invalid_credentials');
  });

  it('returns 401 for unauthenticated GET /api/diary', async () => {
    const res = await diaryGET(new NextRequest('http://localhost/api/diary?date=2026-10-09'));
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe('unauthorized');
  });

  it('login sets the ff_session cookie', async () => {
    const email = uniqueEmail('ff-cookie');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(32);
    void sessionTokenFrom;
  });
});
