/**
 * Cancellation-safety regression tests (billing-flow scope).
 *
 * - Legacy POST /api/subscriptions/cancel must NEVER locally downgrade an
 *   account linked to a live-looking Stripe subscription: it returns 409
 *   `stripe_cancellation_required` and leaves the DB row untouched, so the
 *   verified webhook remains the only path that synchronizes state.
 * - POST /api/billing/cancel in `none`/`sandbox` mode refuses the same
 *   situation (e.g. BILLING_PROVIDER was switched away from 'stripe'
 *   mid-subscription) instead of orphaning the remote subscription.
 * - Free-plan selection keeps working for users without a paid Stripe
 *   subscription, and Stripe customer ids are never cleared by a local
 *   downgrade.
 *
 * MOCKED vs REAL: everything is local — no Stripe network calls. The
 * `stripeSubscriptionId` values used are synthetic (`sub_test_...`).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as legacyCancelPOST } from '@/app/api/subscriptions/cancel/route';
import { POST as billingCancelPOST } from '@/app/api/billing/cancel/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

// --- per-test env save/restore (mirrors billing-hardening.test.ts) ---------
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

function stripeIds() {
  const r = Math.random().toString(36).slice(2, 10);
  return { customer: `cus_test_${r}`, subscription: `sub_test_${r}` };
}

/** Simulate a webhook-granted paid subscription linked to Stripe. */
async function linkLiveStripeSub(userId: string) {
  const ids = stripeIds();
  await prisma.subscription.upsert({
    where: { userId },
    update: {
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      billingPeriod: 'monthly',
      stripeCustomerId: ids.customer,
      stripeSubscriptionId: ids.subscription,
    },
    create: {
      userId,
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      billingPeriod: 'monthly',
      stripeCustomerId: ids.customer,
      stripeSubscriptionId: ids.subscription,
    },
  });
  return ids;
}

describe('legacy POST /api/subscriptions/cancel', () => {
  it('401 when unauthenticated', async () => {
    const res = await legacyCancelPOST(
      jsonRequest('http://localhost/api/subscriptions/cancel', 'POST'),
    );
    expect(res.status).toBe(401);
  });

  it('200: free user (none mode) downgrades locally, no-op is safe', async () => {
    pushEnv({ BILLING_PROVIDER: undefined }); // default: none
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-cancel'),
    );
    const res = await legacyCancelPOST(
      authed(jsonRequest('http://localhost/api/subscriptions/cancel', 'POST'), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.subscription.planId).toBe('free');
    expect(body.note).toMatch(/free plan/i);
    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.planId).toBe('free');
  });

  it('409 stripe_cancellation_required: never locally downgrades a live Stripe subscription', async () => {
    pushEnv({ BILLING_PROVIDER: undefined }); // default: none
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-cancel'),
    );
    const ids = await linkLiveStripeSub(userId);

    const res = await legacyCancelPOST(
      authed(jsonRequest('http://localhost/api/subscriptions/cancel', 'POST'), token),
    );
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error.code).toBe('stripe_cancellation_required');
    expect(body.error.message).toMatch(/api\/billing\/cancel/);

    // DB row untouched: paid plan kept, Stripe linkage preserved.
    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.planId).toBe('diet');
    expect(row?.stripeSubscriptionId).toBe(ids.subscription);
    expect(row?.stripeCustomerId).toBe(ids.customer);
  });

  it('409 in sandbox mode too when a live Stripe subscription is linked', async () => {
    pushEnv({ BILLING_PROVIDER: 'sandbox' });
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-cancel'),
    );
    const ids = await linkLiveStripeSub(userId);

    const res = await legacyCancelPOST(
      authed(jsonRequest('http://localhost/api/subscriptions/cancel', 'POST'), token),
    );
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error.code).toBe('stripe_cancellation_required');

    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.planId).toBe('diet');
    expect(row?.stripeSubscriptionId).toBe(ids.subscription);
  });

  it('200: sandbox test upgrade without Stripe linkage downgrades locally and keeps stripeCustomerId', async () => {
    pushEnv({ BILLING_PROVIDER: 'sandbox' });
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-cancel'),
    );
    await prisma.subscription.upsert({
      where: { userId },
      update: {
        planId: 'diet',
        status: 'active',
        provider: 'sandbox',
        billingPeriod: 'monthly',
        stripeCustomerId: 'cus_keep_me',
        stripeSubscriptionId: null,
      },
      create: {
        userId,
        planId: 'diet',
        status: 'active',
        provider: 'sandbox',
        billingPeriod: 'monthly',
        stripeCustomerId: 'cus_keep_me',
      },
    });

    const res = await legacyCancelPOST(
      authed(jsonRequest('http://localhost/api/subscriptions/cancel', 'POST'), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.subscription.planId).toBe('free');

    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.planId).toBe('free');
    expect(row?.stripeCustomerId).toBe('cus_keep_me');
    expect(row?.stripeSubscriptionId).toBeNull();
  });
});

describe('POST /api/billing/cancel (none/sandbox local path)', () => {
  it('401 when unauthenticated', async () => {
    const res = await billingCancelPOST(
      jsonRequest('http://localhost/api/billing/cancel', 'POST'),
    );
    expect(res.status).toBe(401);
  });

  it('200: none mode, no Stripe linkage -> local downgrade to free', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-cancel'),
    );
    const res = await billingCancelPOST(
      authed(jsonRequest('http://localhost/api/billing/cancel', 'POST'), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.subscription.planId).toBe('free');
    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.planId).toBe('free');
  });

  it('409 stripe_cancellation_required: none mode refuses to orphan a live-looking Stripe subscription', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-cancel'),
    );
    const ids = await linkLiveStripeSub(userId);

    const res = await billingCancelPOST(
      authed(jsonRequest('http://localhost/api/billing/cancel', 'POST'), token),
    );
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error.code).toBe('stripe_cancellation_required');

    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.planId).toBe('diet');
    expect(row?.stripeSubscriptionId).toBe(ids.subscription);
  });
});
