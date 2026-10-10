/**
 * GET /api/billing/status — server-computed paid-entitlement result.
 *
 * - `entitled` is computed SERVER-side with `subscriptionGrantsPaidAccess()`,
 *   including the configured past-due grace policy. The success page trusts
 *   ONLY this result: "Payment confirmed" shows only for a paid planId with
 *   a confirmed status (`active`/`trialing`); `past_due` — even inside the
 *   grace window — must NOT read as confirmed.
 * - The endpoint only READS: it never grants or revokes entitlement.
 * - MOCKED vs REAL: all local, no Stripe network calls.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { GET as statusGET } from '@/app/api/billing/status/route';
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
afterEach(() => {
  while (envStack.length) {
    const snap = envStack.pop()!;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
afterAll(cleanupUsers);

const DAY_MS = 24 * 60 * 60 * 1000;

async function setSub(
  userId: string,
  data: {
    planId: string;
    status: string;
    pastDueSince?: Date | null;
    provider?: string;
  },
) {
  return prisma.subscription.upsert({
    where: { userId },
    update: {
      planId: data.planId,
      status: data.status,
      pastDueSince: data.pastDueSince ?? null,
      provider: data.provider ?? 'stripe',
    },
    create: {
      userId,
      planId: data.planId,
      status: data.status,
      pastDueSince: data.pastDueSince ?? null,
      provider: data.provider ?? 'stripe',
    },
  });
}

async function getStatus(token: string) {
  const res = await statusGET(
    authed(jsonRequest('http://localhost/api/billing/status', 'GET'), token),
  );
  expect(res.status).toBe(200);
  return readJson(res);
}

describe('GET /api/billing/status', () => {
  it('401 when unauthenticated', async () => {
    const res = await statusGET(
      jsonRequest('http://localhost/api/billing/status', 'GET'),
    );
    expect(res.status).toBe(401);
  });

  it('entitled=true for an active paid subscription', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-status-active'),
    );
    await setSub(userId, { planId: 'diet', status: 'active' });

    const body = await getStatus(token);
    expect(body.entitlement.entitled).toBe(true);
    expect(body.entitlement.planId).toBe('diet');
    expect(body.entitlement.status).toBe('active');
    expect(body.entitlement.pastDueGraceUntil).toBeNull();
  });

  it('entitled=false for a free plan', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-status-free'),
    );
    await setSub(userId, { planId: 'free', status: 'active' });

    const body = await getStatus(token);
    expect(body.entitlement.entitled).toBe(false);
    expect(body.entitlement.planId).toBe('free');
  });

  it('past_due inside the grace window: entitled=true but pastDueGraceUntil set (success page must NOT show "Payment confirmed")', async () => {
    pushEnv({ PAST_DUE_GRACE_DAYS: '7' });
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-status-pd-grace'),
    );
    const pastDueSince = new Date(Date.now() - 2 * DAY_MS);
    await setSub(userId, { planId: 'diet', status: 'past_due', pastDueSince });

    const body = await getStatus(token);
    expect(body.entitlement.entitled).toBe(true);
    expect(body.entitlement.status).toBe('past_due');
    expect(body.entitlement.pastDueGraceUntil).toBe(
      new Date(pastDueSince.getTime() + 7 * DAY_MS).toISOString(),
    );
    // grace is finite: the window must end in the future here
    expect(
      new Date(body.entitlement.pastDueGraceUntil).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it('past_due past the grace window: entitled=false', async () => {
    pushEnv({ PAST_DUE_GRACE_DAYS: '7' });
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-status-pd-expired'),
    );
    await setSub(userId, {
      planId: 'diet',
      status: 'past_due',
      pastDueSince: new Date(Date.now() - 8 * DAY_MS),
    });

    const body = await getStatus(token);
    expect(body.entitlement.entitled).toBe(false);
    expect(body.entitlement.status).toBe('past_due');
    expect(body.entitlement.pastDueGraceUntil).not.toBeNull();
  });

  it('past_due with no pastDueSince: entitled=false (fail-closed)', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-status-pd-noclock'),
    );
    await setSub(userId, {
      planId: 'diet',
      status: 'past_due',
      pastDueSince: null,
    });

    const body = await getStatus(token);
    expect(body.entitlement.entitled).toBe(false);
  });

  it('ineligible statuses never grant entitlement', async () => {
    for (const [tag, status] of [
      ['incomplete', 'incomplete'],
      ['unpaid', 'unpaid'],
      ['canceled', 'canceled'],
    ] as const) {
      const { userId, token } = await registerAndLogin(
        registerPOST,
        loginPOST,
        uniqueEmail(`ff-status-${tag}`),
      );
      await setSub(userId, { planId: 'diet', status });
      const body = await getStatus(token);
      expect(body.entitlement.entitled).toBe(false);
      expect(body.entitlement.status).toBe(status);
    }
  });

  it('is read-only: calling it changes nothing in the DB', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-status-readonly'),
    );
    const before = await setSub(userId, {
      planId: 'diet',
      status: 'past_due',
      pastDueSince: new Date(Date.now() - 2 * DAY_MS),
    });
    await getStatus(token);
    const after = await prisma.subscription.findUnique({
      where: { userId },
    });
    expect(after?.planId).toBe(before.planId);
    expect(after?.status).toBe(before.status);
    expect(after?.pastDueSince?.getTime()).toBe(
      before.pastDueSince?.getTime(),
    );
  });
});
