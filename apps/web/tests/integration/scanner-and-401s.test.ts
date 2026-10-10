/**
 * Phase 4 regression:
 * - Scanner route validation + honest degradation (no network). The
 *   `not_configured` happy path is covered in extended-flows.test.ts; here
 *   we pin the validation branches (400/415) and the configured-shape
 *   contract. The CONFIGURED path (real AI vision) is BLOCKED — it needs a
 *   live AI_API_KEY and would make real network calls.
 * - 401 sweep: key authenticated routes reject missing/invalid sessions.
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as scansPOST } from '@/app/api/scans/route';
import { GET as diaryGET } from '@/app/api/diary/route';
import { GET as measurementsGET } from '@/app/api/measurements/route';
import { GET as subscriptionsGET } from '@/app/api/subscriptions/route';
import { POST as mealGeneratePOST } from '@/app/api/meals/plans/generate/route';
import { POST as billingCancelPOST } from '@/app/api/billing/cancel/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

describe('scanner route validation (no network)', () => {
  afterAll(cleanupUsers);

  it('non-multipart body -> 400 invalid_request', async () => {
    const email = uniqueEmail('ff-scanv1');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await scansPOST(
      authed(jsonRequest('http://localhost/api/scans', 'POST', { image: 'nope' }), token),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('invalid_request');
  });

  it('multipart without an image field -> 400 validation_error', async () => {
    const email = uniqueEmail('ff-scanv2');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const form = new FormData();
    form.append('note', 'no image here');
    const res = await scansPOST(
      authed(new NextRequest('http://localhost/api/scans', { method: 'POST', body: form }), token),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('validation_error');
  });

  it('non-image file -> 415 unsupported_media_type', async () => {
    const email = uniqueEmail('ff-scanv3');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const form = new FormData();
    form.append('image', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const res = await scansPOST(
      authed(new NextRequest('http://localhost/api/scans', { method: 'POST', body: form }), token),
    );
    expect(res.status).toBe(415);
    expect((await readJson(res)).error.code).toBe('unsupported_media_type');
  });

  // BLOCKED (not attempted): the configured path (real AI vision returning
  // items with status 'review') needs a live AI_API_KEY and real network.
});

describe('401 sweep: unauthenticated requests are rejected', () => {
  it.each([
    ['GET /api/diary', () => diaryGET(new NextRequest('http://localhost/api/diary?date=2026-10-09'))],
    ['GET /api/measurements', () => measurementsGET(new NextRequest('http://localhost/api/measurements'))],
    ['GET /api/subscriptions', () => subscriptionsGET(new NextRequest('http://localhost/api/subscriptions'))],
    [
      'POST /api/meals/plans/generate',
      () => mealGeneratePOST(jsonRequest('http://localhost/api/meals/plans/generate', 'POST', {})),
    ],
    [
      'POST /api/billing/cancel',
      () => billingCancelPOST(new NextRequest('http://localhost/api/billing/cancel', { method: 'POST' })),
    ],
  ])('%s -> 401 unauthorized', async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe('unauthorized');
  });

  it('a bogus session token -> 401 unauthorized', async () => {
    const bad = new NextRequest('http://localhost/api/diary?date=2026-10-09');
    bad.cookies.set('ff_session', 'bogus-token-that-matches-nothing');
    const res = await diaryGET(bad);
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe('unauthorized');
  });
});
