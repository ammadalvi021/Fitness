/**
 * Phase 4 regression: billing hardening under the NEW contract.
 *
 * - Paid entitlement can NEVER come from a frontend claim or a manual
 *   selectPlan() call: `none` and `stripe` modes REJECT paid planIds with
 *   402 `payment_required` (BillingError code, HTTP 402 via POST
 *   /api/subscriptions). Only `sandbox` allows a clearly-labeled TEST-ONLY
 *   upgrade, and only the signature-verified Stripe webhook grants paid
 *   access in `stripe` mode.
 * - POST /api/billing/checkout non-Stripe paths: 401 / 503 / 400s.
 * - POST /api/billing/cancel: 401, none-mode downgrade, sandbox label,
 *   stripe-mode-unconfigured 503.
 *
 * MOCKED vs REAL: everything here is local — no Stripe network calls are
 * made. A real end-to-end Stripe test-mode checkout (creating an actual
 * Checkout Session + webhook delivery) is BLOCKED: it needs real
 * STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / price IDs from the Stripe
 * dashboard, which are not available in this environment.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { BillingError, selectPlan } from '@/lib/billing';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as subscriptionsPOST } from '@/app/api/subscriptions/route';
import { POST as checkoutPOST } from '@/app/api/billing/checkout/route';
import { POST as billingCancelPOST } from '@/app/api/billing/cancel/route';
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

async function freeSub(userId: string, planId = 'free') {
  return prisma.subscription.upsert({
    where: { userId },
    update: { planId, status: 'active' },
    create: { userId, planId, status: 'active' },
  });
}

describe('paid plan without payment is rejected (none mode)', () => {
  it('POST /api/subscriptions {planId:"diet"} -> 402 payment_required', async () => {
    pushEnv({ BILLING_PROVIDER: undefined }); // default: none
    const email = uniqueEmail('ff-402');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);

    const res = await subscriptionsPOST(
      authed(jsonRequest('http://localhost/api/subscriptions', 'POST', { planId: 'diet' }), token),
    );
    expect(res.status).toBe(402);
    const body = await readJson(res);
    expect(body.error.code).toBe('payment_required');

    // the DB row must still be free — no paid access granted
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
  });

  it('direct selectPlan(userId, "diet") throws BillingError payment_required/402', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const email = uniqueEmail('ff-402lib');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);

    let err: unknown = null;
    try {
      await selectPlan(userId, 'diet');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BillingError);
    expect((err as BillingError).code).toBe('payment_required');
    expect((err as BillingError).status).toBe(402);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
  });

  it('stripe mode ALSO rejects paid selectPlan (402) — entitlement comes only from the webhook', async () => {
    // stripe provider selected but unconfigured: selectPlan must still throw
    // payment_required WITHOUT touching the network.
    pushEnv({ BILLING_PROVIDER: 'stripe' });
    const email = uniqueEmail('ff-402stripe');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);

    await expect(selectPlan(userId, 'diet_exercise')).rejects.toMatchObject({
      code: 'payment_required',
      status: 402,
    });
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
  });

  it('a frontend payment claim is ignored -> still 402 (no claim path exists)', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const email = uniqueEmail('ff-claim');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);

    // There is NO route that accepts a frontend payment claim; even stuffing
    // claim-shaped fields into the body must not grant paid access.
    const res = await subscriptionsPOST(
      authed(
        jsonRequest('http://localhost/api/subscriptions', 'POST', {
          planId: 'diet',
          paid: true,
          stripeSessionId: 'cs_fake_123',
          testMode: false,
        }),
        token,
      ),
    );
    expect(res.status).toBe(402);
    expect((await readJson(res)).error.code).toBe('payment_required');
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
  });

  it('downgrading to free is always allowed, every mode', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const email = uniqueEmail('ff-free');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    await freeSub(userId, 'diet'); // simulate a paid row

    const res = await subscriptionsPOST(
      authed(jsonRequest('http://localhost/api/subscriptions', 'POST', { planId: 'free' }), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.subscription.planId).toBe('free');
    expect(body.charged).toBe(false);
    expect(body.testMode).toBe(false);
  });
});

describe('POST /api/billing/checkout (non-Stripe paths)', () => {
  it('401 when unauthenticated', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const res = await checkoutPOST(
      jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'diet' }),
    );
    expect(res.status).toBe(401);
  });

  it('503 stripe_not_configured in none mode', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const email = uniqueEmail('ff-co1');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await checkoutPOST(
      authed(jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'diet' }), token),
    );
    expect(res.status).toBe(503);
    expect((await readJson(res)).error.code).toBe('stripe_not_configured');
  });

  it('400 unknown_plan for a bad plan id', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const email = uniqueEmail('ff-co2');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await checkoutPOST(
      authed(jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'nope' }), token),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('unknown_plan');
  });

  it('400 plan_not_billable for the free plan', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const email = uniqueEmail('ff-co3');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await checkoutPOST(
      authed(jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'free' }), token),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('plan_not_billable');
  });

  it('400 validation_error when planId is missing', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const email = uniqueEmail('ff-co4');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await checkoutPOST(
      authed(jsonRequest('http://localhost/api/billing/checkout', 'POST', {}), token),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('validation_error');
  });

  // BLOCKED (not attempted): creating a real Checkout Session needs live
  // Stripe test-mode keys (STRIPE_SECRET_KEY + price IDs). No network calls
  // to Stripe are made by this suite.
});

describe('POST /api/billing/cancel', () => {
  it('401 when unauthenticated', async () => {
    const res = await billingCancelPOST(
      new NextRequest('http://localhost/api/billing/cancel', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('none mode: cancel downgrades a paid row to free (no charge)', async () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    const email = uniqueEmail('ff-cancel');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    await freeSub(userId, 'diet');

    const res = await billingCancelPOST(
      authed(new NextRequest('http://localhost/api/billing/cancel', { method: 'POST' }), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.subscription.planId).toBe('free');
    expect(body.subscription.status).toBe('active');
    expect(body.subscription.stripeSubscriptionId).toBeNull();
    expect(body.note).toMatch(/No charge/i);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
  });

  it('sandbox mode: cancel is labeled test-only', async () => {
    pushEnv({ BILLING_PROVIDER: 'sandbox' });
    const email = uniqueEmail('ff-cancelsb');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const sel = await subscriptionsPOST(
      authed(jsonRequest('http://localhost/api/subscriptions', 'POST', { planId: 'diet' }), token),
    );
    expect(sel.status).toBe(200);

    const res = await billingCancelPOST(
      authed(new NextRequest('http://localhost/api/billing/cancel', { method: 'POST' }), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.subscription.planId).toBe('free');
    expect(body.testMode).toBe(true);
  });

  it('stripe mode without full config -> 503 (no network attempted)', async () => {
    pushEnv({ BILLING_PROVIDER: 'stripe' });
    const email = uniqueEmail('ff-cancelstripe');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await billingCancelPOST(
      authed(new NextRequest('http://localhost/api/billing/cancel', { method: 'POST' }), token),
    );
    expect(res.status).toBe(503);
    expect((await readJson(res)).error.code).toBe('stripe_not_configured');
  });

  // BLOCKED (not attempted): stripe-mode cancel_at_period_end needs live
  // test-mode keys; the local downgrade then happens only via webhook.
});
