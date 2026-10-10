/**
 * Phase 4 regression: POST /api/billing/webhook.
 *
 * MOCKED (clearly labeled — no Stripe network calls are made):
 * - Signatures are REAL HMAC signatures produced locally with
 *   `Stripe.webhooks.generateTestHeaderString` and a dummy `whsec_...`
 *   secret — signature verification itself is genuinely exercised.
 * - The `checkout.session.completed` handler calls
 *   `stripe.subscriptions.retrieve()`, which WOULD hit the Stripe API; that
 *   single SDK method is stubbed on the route's own Stripe instance to
 *   return a canned subscription object. Everything else (signature check,
 *   idempotency claim, DB writes) runs for real.
 *
 * BLOCKED (not attempted): a true end-to-end test with real Stripe
 * test-mode keys (real Checkout Session + real webhook delivery from
 * Stripe) needs live STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / price IDs.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@fitfusion/db';
import { getStripe } from '@/lib/billing';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as webhookPOST } from '@/app/api/billing/webhook/route';
import {
  cleanupUsers,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

const WEBHOOK_SECRET = 'whsec_test_dummy_secret_123';
const PRICE_DIET = 'price_test_diet';
const PRICE_DIET_EXERCISE = 'price_test_diet_exercise';
const EVT_PREFIX = 'evt_test_wh_';

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
function stripeTestEnv() {
  pushEnv({
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_dummy_123',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_DIET: PRICE_DIET,
    STRIPE_PRICE_DIET_EXERCISE: PRICE_DIET_EXERCISE,
  });
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
afterAll(async () => {
  await prisma.stripeWebhookEvent
    .deleteMany({ where: { eventId: { startsWith: EVT_PREFIX } } })
    .catch(() => {});
  await cleanupUsers();
});

let evtSeq = 0;
function nextEventId() {
  evtSeq += 1;
  return `${EVT_PREFIX}${Date.now()}_${evtSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a signed webhook request; returns {req, raw, eventId}. */
function signedWebhook(type: string, object: unknown) {
  const eventId = nextEventId();
  const payload = { id: eventId, object: 'event', type, data: { object } };
  const raw = JSON.stringify(payload);
  const sig = Stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: WEBHOOK_SECRET,
  });
  const req = new NextRequest('http://localhost/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    body: raw,
  });
  return { req, raw, eventId };
}

/**
 * MOCKED: stub stripe.subscriptions.retrieve on the route's Stripe instance
 * so the checkout.session.completed handler can run without network.
 * Returns a restore function.
 */
function stubSubscriptionRetrieve(sub: Record<string, unknown>) {
  const stripe = getStripe();
  if (!stripe) throw new Error('expected configured Stripe client in test');
  const target = stripe.subscriptions as unknown as Record<string, unknown>;
  const original = target.retrieve;
  target.retrieve = async () => sub;
  return () => {
    target.retrieve = original;
  };
}

describe('webhook signature verification', () => {
  it('tampered body -> 400 invalid_signature and nothing processed', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-wh-tamper');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);

    const eventId = nextEventId();
    const payload = {
      id: eventId,
      object: 'event',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_tamper', object: 'invoice' } },
    };
    const raw = JSON.stringify(payload);
    // Tamper one byte AFTER signing.
    const tampered = raw.replace('invoice.payment_failed', 'invoice.payment_faileX');
    const sig = Stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret: WEBHOOK_SECRET,
    });
    const tamperedReq = new NextRequest('http://localhost/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      body: tampered,
    });

    const res = await webhookPOST(tamperedReq);
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('invalid_signature');

    // nothing was claimed or processed
    const claimed = await prisma.stripeWebhookEvent.findUnique({
      where: { eventId },
    });
    expect(claimed).toBeNull();
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
  });

  it('missing signature -> 400 invalid_signature', async () => {
    stripeTestEnv();
    const raw = JSON.stringify({ id: nextEventId(), object: 'event', type: 'ping' });
    const res = await webhookPOST(
      new NextRequest('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw,
      }),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('invalid_signature');
  });
});

describe('webhook event handling (retrieve MOCKED, DB real)', () => {
  it('checkout.session.completed activates diet/active with Stripe IDs stored', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-wh-active');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);

    const stripeSubId = `sub_test_${Date.now()}`;
    // V3, P2-3: the webhook binds only via the server-side session mapping
    // stored at checkout creation.
    await prisma.subscription.update({
      where: { userId },
      data: { stripeCheckoutSessionId: 'cs_test_1' },
    });
    const restore = stubSubscriptionRetrieve({
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'active',
      items: {
        object: 'list',
        data: [{ id: 'si_test_1', current_period_end: 1893456000, price: { id: PRICE_DIET } }],
      },
    });
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_test_1',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
      expect((await readJson(res)).received).toBe(true);
    } finally {
      restore();
    }

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.status).toBe('active');
    expect(sub?.provider).toBe('stripe');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
    expect(sub?.stripeCustomerId).toBe('cus_test_1');
  });

  it('duplicate delivery of the same event id is processed once (idempotent)', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-wh-dedup');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_dedup_${Date.now()}`;
    await prisma.subscription.upsert({
      where: { userId },
      update: {
        planId: 'diet',
        status: 'active',
        provider: 'stripe',
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_1',
      },
      create: {
        userId,
        planId: 'diet',
        status: 'active',
        provider: 'stripe',
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_1',
      },
    });

    const { req, raw, eventId } = signedWebhook('invoice.payment_failed', {
      id: 'in_dedup',
      object: 'invoice',
      customer: 'cus_test_1',
      parent: { subscription_details: { subscription: stripeSubId } },
    });

    const first = await webhookPOST(req);
    expect(first.status).toBe(200);

    // exact same delivery again (same body, same signature)
    const sig = Stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret: WEBHOOK_SECRET,
    });
    const again = await webhookPOST(
      new NextRequest('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
        body: raw,
      }),
    );
    expect(again.status).toBe(200);
    const againBody = await readJson(again);
    expect(againBody.received).toBe(true);
    expect(againBody.deduped).toBe(true);

    const rows = await prisma.stripeWebhookEvent.findMany({ where: { eventId } });
    expect(rows.length).toBe(1);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.status).toBe('past_due'); // from the FIRST (real) processing
    expect(sub?.planId).toBe('diet'); // plan retained during grace
  });

  it('invoice.payment_failed -> status past_due, planId retained (grace)', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-wh-failed');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_failed_${Date.now()}`;
    await prisma.subscription.upsert({
      where: { userId },
      update: {
        planId: 'diet',
        status: 'active',
        provider: 'stripe',
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_1',
      },
      create: {
        userId,
        planId: 'diet',
        status: 'active',
        provider: 'stripe',
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_1',
      },
    });

    const { req } = signedWebhook('invoice.payment_failed', {
      id: 'in_failed',
      object: 'invoice',
      customer: 'cus_test_1',
      parent: { subscription_details: { subscription: stripeSubId } },
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.status).toBe('past_due');
    expect(sub?.planId).toBe('diet'); // grace: access continues
  });

  it('customer.subscription.deleted -> downgraded to free', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-wh-deleted');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_deleted_${Date.now()}`;
    await prisma.subscription.upsert({
      where: { userId },
      update: {
        planId: 'diet',
        status: 'active',
        provider: 'stripe',
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_1',
      },
      create: {
        userId,
        planId: 'diet',
        status: 'active',
        provider: 'stripe',
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_1',
      },
    });

    const { req } = signedWebhook('customer.subscription.deleted', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'canceled',
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBeNull();
  });
});
