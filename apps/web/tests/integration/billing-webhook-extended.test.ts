/**
 * Phase 5 (V2 hardening) tests: Stripe webhook lifecycle beyond the basic
 * signature/idempotency coverage in stripe-webhook.test.ts.
 *
 * Covers §8 items:
 *   3. Successful ELIGIBLE subscription activation via webhook — `trialing`
 *      subscriptions grant paid access (in addition to `active`, already
 *      covered). The SDK's `subscriptions.retrieve` is MOCKED on the route's
 *      own Stripe instance (counted); signatures are REAL local HMAC
 *      signatures; DB writes are real.
 *   4. `incomplete` subscription via checkout.session.completed does NOT
 *      grant paid access.
 *   5. Declined/delayed payment scenarios the implementation handles:
 *      invoice.payment_failed for an unknown subscription (acked, no-op),
 *      and the delayed recovery sequence failed -> past_due -> succeeded.
 *   6. Duplicate AND concurrent deliveries of the same event id -> processed
 *      once. Plus: a stale unprocessed claim (crash between claim and
 *      completion) is reprocessed on redelivery.
 *   7. Cancellation at period end: customer.subscription.updated with
 *      cancel_at_period_end=true keeps paid access; the later
 *      customer.subscription.deleted downgrades to free.
 *   9. Successful and failed renewals (invoice.payment_succeeded /
 *      invoice.payment_failed) with the grace policy.
 *  10. Unknown/mismatched Stripe Price IDs -> no entitlement.
 *
 * MOCKED vs REAL: no Stripe network calls are made. A true end-to-end test
 * with real Stripe test-mode keys (real Checkout Session + real webhook
 * delivery from Stripe) is BLOCKED: it needs live STRIPE_SECRET_KEY /
 * STRIPE_WEBHOOK_SECRET / price IDs from the Stripe dashboard.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@fitfusion/db';
import { getStripe } from '@/lib/billing';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as webhookPOST } from '@/app/api/billing/webhook/route';
import { POST as mealGeneratePOST } from '@/app/api/meals/plans/generate/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

const WEBHOOK_SECRET = 'whsec_test_dummy_secret_123';
const PRICE_DIET = 'price_test_diet';
const PRICE_DIET_EXERCISE = 'price_test_diet_exercise';
const EVT_PREFIX = 'evt_test_whx_';

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

/** Build a signed webhook request; accepts an explicit eventId for redelivery tests. */
function signedWebhook(type: string, object: unknown, eventId = nextEventId()) {
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
  return { req, raw, sig, eventId };
}

/** A second NextRequest carrying the EXACT same delivery (same body + signature). */
function redeliver(raw: string, sig: string) {
  return new NextRequest('http://localhost/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    body: raw,
  });
}

/**
 * MOCKED: stub stripe.subscriptions.retrieve on the route's Stripe instance.
 * Counts invocations (for the concurrency test) and returns the canned sub.
 */
function stubSubscriptionRetrieve(sub: Record<string, unknown>) {
  const stripe = getStripe();
  if (!stripe) throw new Error('expected configured Stripe client in test');
  const target = stripe.subscriptions as unknown as Record<string, unknown>;
  const original = target.retrieve;
  const calls = { count: 0 };
  target.retrieve = async () => {
    calls.count += 1;
    return sub;
  };
  return {
    calls,
    restore() {
      target.retrieve = original;
    },
  };
}

function cannedSubscription(opts: {
  id: string;
  status: string;
  priceId: string;
  periodEndSecs?: number;
  customer?: string;
}) {
  return {
    id: opts.id,
    object: 'subscription',
    customer: opts.customer ?? 'cus_test_x',
    status: opts.status,
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test_x',
          current_period_end: opts.periodEndSecs ?? 1893456000,
          price: { id: opts.priceId },
        },
      ],
    },
  };
}

function invoiceFor(subId: string, invoiceId: string) {
  return {
    id: invoiceId,
    object: 'invoice',
    customer: 'cus_test_x',
    parent: { subscription_details: { subscription: subId } },
  };
}

async function seedActiveSub(userId: string, stripeSubId: string, planId = 'diet') {
  return prisma.subscription.upsert({
    where: { userId },
    update: {
      planId,
      status: 'active',
      provider: 'stripe',
      providerRef: stripeSubId,
      stripeSubscriptionId: stripeSubId,
      stripeCustomerId: 'cus_test_x',
    },
    create: {
      userId,
      planId,
      status: 'active',
      provider: 'stripe',
      providerRef: stripeSubId,
      stripeSubscriptionId: stripeSubId,
      stripeCustomerId: 'cus_test_x',
    },
  });
}

/** Access-level assertion: is the paid `diet` feature reachable? */
/** Returns the HTTP status of the paid-gated meal-plan generate route. */
async function mealAccess(token: string): Promise<number> {
  const res = await mealGeneratePOST(
    authed(jsonRequest('http://localhost/api/meals/plans/generate', 'POST', {}), token),
  );
  return res.status;
}
/** 201 = plan created (gating passed); 403 = plan_required (gated out). */
const GRANTED = 201;
const DENIED = 403;

describe('eligible activation grants paid access (§8.3)', () => {
  it('trialing subscription via checkout.session.completed grants access', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-trial');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);

    const stripeSubId = `sub_test_trial_${Date.now()}`;
    // V3, P2-3: the webhook binds only via the server-side session mapping
    // stored at checkout creation.
    await prisma.subscription.update({
      where: { userId },
      data: { stripeCheckoutSessionId: 'cs_test_trial' },
    });
    const { calls, restore } = stubSubscriptionRetrieve(
      cannedSubscription({ id: stripeSubId, status: 'trialing', priceId: PRICE_DIET_EXERCISE }),
    );
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_test_trial',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet_exercise' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
      expect((await readJson(res)).received).toBe(true);
    } finally {
      restore();
    }
    expect(calls.count).toBe(1);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet_exercise');
    expect(sub?.status).toBe('active'); // trialing maps to active locally
    expect(sub?.provider).toBe('stripe');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);

    // access-level: the paid feature is reachable
    expect(await mealAccess(token)).toBe(GRANTED);
  });
});

describe('ineligible statuses never grant paid access (§8.4)', () => {
  it('checkout.session.completed with an `incomplete` subscription does NOT grant access', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-incomplete');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);

    const stripeSubId = `sub_test_incomplete_${Date.now()}`;
    // V3, P2-3: the webhook binds only via the server-side session mapping
    // stored at checkout creation.
    await prisma.subscription.update({
      where: { userId },
      data: { stripeCheckoutSessionId: 'cs_test_incomplete' },
    });
    const { restore } = stubSubscriptionRetrieve(
      cannedSubscription({ id: stripeSubId, status: 'incomplete', priceId: PRICE_DIET }),
    );
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_test_incomplete',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200); // acked — but must grant nothing
    } finally {
      restore();
    }

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).not.toBe('diet');
    expect(sub?.planId).not.toBe('diet_exercise');

    // access-level: the paid feature stays denied
    expect(await mealAccess(token)).toBe(403);
  });
});

describe('declined / delayed payments the implementation handles (§8.5)', () => {
  it('invoice.payment_failed for an unknown subscription -> 200 acked, no-op', async () => {
    stripeTestEnv();
    const { req } = signedWebhook(
      'invoice.payment_failed',
      invoiceFor('sub_test_ghost_1', 'in_ghost_1'),
    );
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);
    expect((await readJson(res)).received).toBe(true);
    // no subscription row was fabricated for the unknown customer
    const ghost = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: 'sub_test_ghost_1' },
    });
    expect(ghost).toBeNull();
  });

  it('delayed recovery: failed -> past_due (grace) -> succeeded -> active again', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-recover');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_recover_${Date.now()}`;
    await seedActiveSub(userId, stripeSubId);

    // 1. payment fails -> past_due, plan retained (grace)
    const { req: failedReq } = signedWebhook(
      'invoice.payment_failed',
      invoiceFor(stripeSubId, 'in_recover_1'),
    );
    expect((await webhookPOST(failedReq)).status).toBe(200);
    let sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.status).toBe('past_due');
    expect(sub?.planId).toBe('diet');
    expect(await mealAccess(token)).toBe(GRANTED); // grace: access continues

    // 2. delayed successful retry -> back to active
    const { calls, restore } = stubSubscriptionRetrieve(
      cannedSubscription({
        id: stripeSubId,
        status: 'active',
        priceId: PRICE_DIET,
        periodEndSecs: 1924992000,
      }),
    );
    try {
      const { req: okReq } = signedWebhook(
        'invoice.payment_succeeded',
        invoiceFor(stripeSubId, 'in_recover_2'),
      );
      expect((await webhookPOST(okReq)).status).toBe(200);
    } finally {
      restore();
    }
    expect(calls.count).toBe(1);
    sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.status).toBe('active');
    expect(sub?.planId).toBe('diet');
    expect(sub?.currentPeriodEnd?.getTime()).toBe(1924992000 * 1000);
  });
});

describe('duplicate and concurrent deliveries (§8.6)', () => {
  it('concurrent duplicate deliveries of the same event are processed exactly once', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-conc');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);

    const stripeSubId = `sub_test_conc_${Date.now()}`;
    // V3, P2-3: the webhook binds only via the server-side session mapping
    // stored at checkout creation.
    await prisma.subscription.update({
      where: { userId },
      data: { stripeCheckoutSessionId: 'cs_test_conc' },
    });
    const { calls, restore } = stubSubscriptionRetrieve(
      cannedSubscription({ id: stripeSubId, status: 'active', priceId: PRICE_DIET }),
    );
    try {
      const { raw, sig, eventId } = signedWebhook('checkout.session.completed', {
        id: 'cs_test_conc',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });

      // Two deliveries of the SAME event, in flight at the same time.
      const [a, b] = await Promise.all([
        webhookPOST(redeliver(raw, sig)),
        webhookPOST(redeliver(raw, sig)),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      // exactly one claim row exists
      const rows = await prisma.stripeWebhookEvent.findMany({ where: { eventId } });
      expect(rows.length).toBe(1);
      expect(rows[0].processedAt).not.toBeNull();

      // the subscription was retrieved (i.e. handled) exactly once
      expect(calls.count).toBe(1);

      const sub = await prisma.subscription.findUnique({ where: { userId } });
      expect(sub?.planId).toBe('diet');
      expect(sub?.status).toBe('active');
    } finally {
      restore();
    }
  });

  it('a stale unprocessed claim (crash between claim and completion) is reprocessed on redelivery', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-stale');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);

    const stripeSubId = `sub_test_stale_${Date.now()}`;
    await seedActiveSub(userId, stripeSubId);

    // Simulate a crashed delivery: claim row exists, processedAt is null.
    const eventId = nextEventId();
    await prisma.stripeWebhookEvent.create({
      data: { eventId, type: 'invoice.payment_succeeded' },
    });

    const { calls, restore } = stubSubscriptionRetrieve(
      cannedSubscription({
        id: stripeSubId,
        status: 'active',
        priceId: PRICE_DIET,
        periodEndSecs: 1924992000,
      }),
    );
    try {
      const { req } = signedWebhook(
        'invoice.payment_succeeded',
        invoiceFor(stripeSubId, 'in_stale_1'),
        eventId,
      );
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.received).toBe(true);
      expect(body.deduped ?? false).toBe(false); // reprocessed, not skipped
    } finally {
      restore();
    }
    expect(calls.count).toBe(1);
    const row = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } });
    expect(row?.processedAt).not.toBeNull();
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.currentPeriodEnd?.getTime()).toBe(1924992000 * 1000);
  });

  it('two different events for the same subscription are each processed once', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-two');
    const { userId } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_two_${Date.now()}`;
    await seedActiveSub(userId, stripeSubId);

    const { calls, restore } = stubSubscriptionRetrieve(
      cannedSubscription({
        id: stripeSubId,
        status: 'active',
        priceId: PRICE_DIET,
        periodEndSecs: 1924992000,
      }),
    );
    try {
      const ok = signedWebhook('invoice.payment_succeeded', invoiceFor(stripeSubId, 'in_two_1'));
      const failed = signedWebhook('invoice.payment_failed', invoiceFor(stripeSubId, 'in_two_2'));
      const [r1, r2] = await Promise.all([
        webhookPOST(redeliver(ok.raw, ok.sig)),
        webhookPOST(redeliver(failed.raw, failed.sig)),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect((await readJson(r1)).received).toBe(true);
      expect((await readJson(r2)).received).toBe(true);

      // each event id claimed exactly once
      for (const eid of [ok.eventId, failed.eventId]) {
        const rows = await prisma.stripeWebhookEvent.findMany({ where: { eventId: eid } });
        expect(rows.length).toBe(1);
        expect(rows[0].processedAt).not.toBeNull();
      }
    } finally {
      restore();
    }
  });
});

describe('cancellation at period end (§8.7)', () => {
  it('subscription.updated with cancel_at_period_end keeps access; deleted ends it', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-cxlend');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_cxlend_${Date.now()}`;
    await seedActiveSub(userId, stripeSubId);
    expect(await mealAccess(token)).toBe(GRANTED);

    // 1. cancel_at_period_end=true, status still active -> access preserved
    const periodEnd = 1924992000;
    const { req: updReq } = signedWebhook('customer.subscription.updated', {
      ...cannedSubscription({
        id: stripeSubId,
        status: 'active',
        priceId: PRICE_DIET,
        periodEndSecs: periodEnd,
      }),
      cancel_at_period_end: true,
    });
    expect((await webhookPOST(updReq)).status).toBe(200);
    let sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.status).toBe('active');
    expect(sub?.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId); // still tracked
    expect(await mealAccess(token)).toBe(GRANTED); // paid access continues until period end

    // 2. at period end Stripe sends deleted -> downgraded to free
    const { req: delReq } = signedWebhook('customer.subscription.deleted', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_x',
      status: 'canceled',
    });
    expect((await webhookPOST(delReq)).status).toBe(200);
    sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBeNull();
    expect(await mealAccess(token)).toBe(403);
  });

  it('subscription.updated with status canceled downgrades immediately', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-cxlnow');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_cxlnow_${Date.now()}`;
    await seedActiveSub(userId, stripeSubId);

    const { req } = signedWebhook('customer.subscription.updated', {
      ...cannedSubscription({ id: stripeSubId, status: 'canceled', priceId: PRICE_DIET }),
    });
    expect((await webhookPOST(req)).status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
    expect(await mealAccess(token)).toBe(403);
  });
});

describe('renewals with the grace policy (§8.9)', () => {
  it('invoice.payment_succeeded renews: period extended, plan kept, access continues', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-renew');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_renew_${Date.now()}`;
    await seedActiveSub(userId, stripeSubId);

    const newPeriodEnd = 1924992000;
    const { calls, restore } = stubSubscriptionRetrieve(
      cannedSubscription({
        id: stripeSubId,
        status: 'active',
        priceId: PRICE_DIET,
        periodEndSecs: newPeriodEnd,
      }),
    );
    try {
      const { req } = signedWebhook(
        'invoice.payment_succeeded',
        invoiceFor(stripeSubId, 'in_renew_1'),
      );
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
      expect((await readJson(res)).received).toBe(true);
    } finally {
      restore();
    }
    expect(calls.count).toBe(1);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.status).toBe('active');
    expect(sub?.currentPeriodEnd?.getTime()).toBe(newPeriodEnd * 1000);
    expect(await mealAccess(token)).toBe(GRANTED);
  });

  it('invoice.payment_failed on an active subscription -> past_due, plan retained (grace)', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-failgrace');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_failgrace_${Date.now()}`;
    await seedActiveSub(userId, stripeSubId);

    const { req } = signedWebhook(
      'invoice.payment_failed',
      invoiceFor(stripeSubId, 'in_failgrace_1'),
    );
    expect((await webhookPOST(req)).status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.status).toBe('past_due');
    expect(sub?.planId).toBe('diet'); // grace: access continues despite arrears
    expect(await mealAccess(token)).toBe(GRANTED);
  });
});

describe('unknown / mismatched Stripe Price IDs (§8.10)', () => {
  it('checkout.session.completed whose subscription has an unknown price id grants nothing', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-unkprice');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);

    const stripeSubId = `sub_test_unkprice_${Date.now()}`;
    // V3, P2-3: the webhook binds only via the server-side session mapping
    // stored at checkout creation.
    await prisma.subscription.update({
      where: { userId },
      data: { stripeCheckoutSessionId: 'cs_test_unkprice' },
    });
    const { restore } = stubSubscriptionRetrieve(
      cannedSubscription({
        id: stripeSubId,
        status: 'active',
        priceId: 'price_unknown_xyz_not_configured',
      }),
    );
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_test_unkprice',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200); // acked — but must grant nothing
    } finally {
      restore();
    }

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).not.toBe('diet');
    expect(sub?.planId).not.toBe('diet_exercise');
    expect(await mealAccess(token)).toBe(403);
  });

  it('subscription.updated whose price id no longer matches env HOLDS the current plan (never revokes on unverifiable data)', async () => {
    // Policy (landed in the webhook route): §8.10's "no entitlement" is
    // fail-closed on the GRANT path (checkout.session.completed with an
    // unknown price -> planId 'free', covered above). For UPDATE events of an
    // already-granted subscription, an unmapped price HOLDS the current plan —
    // the route never downgrades or upgrades on data it cannot verify
    // (e.g. a price rotated in the Stripe dashboard). AMBIGUITY NOTE for the
    // coordinator: the brief's terse "unknown/mismatched price IDs -> no
    // entitlement" could also be read as "revoke on update"; this test pins
    // the implementation's documented hold-policy. If the strict reading is
    // intended, this test must be flipped.
    stripeTestEnv();
    const email = uniqueEmail('ff-whx-mismatch');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const stripeSubId = `sub_test_mismatch_${Date.now()}`;
    await seedActiveSub(userId, stripeSubId);

    const { req } = signedWebhook('customer.subscription.updated', {
      ...cannedSubscription({
        id: stripeSubId,
        status: 'active',
        priceId: 'price_rotated_not_in_env',
      }),
    });
    expect((await webhookPOST(req)).status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    // held, not revoked, not upgraded:
    expect(sub?.planId).toBe('diet');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
    expect(await mealAccess(token)).toBe(GRANTED);
  });
});
