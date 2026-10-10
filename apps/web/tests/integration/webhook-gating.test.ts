/**
 * Webhook/gating hardening tests (webhook hardener scope).
 *
 * MOCKED (clearly labeled — no Stripe network calls are made):
 * - Signatures are REAL HMAC signatures produced locally with
 *   `Stripe.webhooks.generateTestHeaderString` and a dummy `whsec_...`
 *   secret — signature verification itself is genuinely exercised.
 * - `stripe.subscriptions.retrieve()` (called by the checkout and
 *   invoice handlers) is stubbed on the route's own Stripe instance to
 *   return canned subscription objects. Everything else (signature check,
 *   idempotency claim, DB writes, grace logic) runs for real.
 *
 * Covered:
 *  1. Signature mandatory; BILLING_PROVIDER=none never processes events.
 *  2. Price-ID trust: unknown/mismatched prices -> no entitlement, acked 200.
 *  3. Status allowlist: incomplete checkout does NOT activate; unpaid /
 *     incomplete_expired never grant paid access.
 *  4. Finite past_due grace: clock starts on first failure, is not reset,
 *     and expires -> downgrade to free.
 *  5. Concurrent duplicate delivery -> processed exactly once.
 *  6. Lifecycle: renewal, failed renewal, cancel_at_period_end, immediate
 *     cancel, plan change via subscription.updated.
 *  7. User binding: checkout for an unknown user or mismatched binding
 *     sources grants nothing.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@fitfusion/db';
import {
  getStripe,
  isEligibleSubscriptionStatus,
  pastDueGraceDays,
  subscriptionGrantsPaidAccess,
} from '@/lib/billing';
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
const PRICE_UNKNOWN = 'price_test_unknown_xyz';
const EVT_PREFIX = 'evt_test_gate_';

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

/** Build a signed webhook request. */
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

/** MOCKED: stub stripe.subscriptions.retrieve; returns a restore function. */
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

function cannedSub(overrides: Record<string, unknown> = {}) {
  return {
    id: `sub_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    object: 'subscription',
    customer: 'cus_test_1',
    status: 'active',
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [{ id: 'si_test_1', current_period_end: 1893456000, price: { id: PRICE_DIET } }],
    },
    ...overrides,
  };
}

async function seedPaidUser(emailPrefix: string, subId: string) {
  const { userId } = await registerAndLogin(
    registerPOST,
    loginPOST,
    uniqueEmail(emailPrefix),
  );
  await prisma.subscription.upsert({
    where: { userId },
    update: {
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      stripeSubscriptionId: subId,
      stripeCustomerId: 'cus_test_1',
    },
    create: {
      userId,
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      stripeSubscriptionId: subId,
      stripeCustomerId: 'cus_test_1',
    },
  });
  return userId;
}

describe('gating unit logic (lib/billing)', () => {
  it('status allowlist: only active/trialing are eligible', () => {
    expect(isEligibleSubscriptionStatus('active')).toBe(true);
    expect(isEligibleSubscriptionStatus('trialing')).toBe(true);
    for (const s of ['incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'canceled', 'paused', 'bogus']) {
      expect(isEligibleSubscriptionStatus(s)).toBe(false);
    }
  });

  it('pastDueGraceDays: env override, invalid -> default 7', () => {
    pushEnv({ PAST_DUE_GRACE_DAYS: '14' });
    expect(pastDueGraceDays()).toBe(14);
    pushEnv({ PAST_DUE_GRACE_DAYS: 'not-a-number' });
    expect(pastDueGraceDays()).toBe(7);
    pushEnv({ PAST_DUE_GRACE_DAYS: '-3' });
    expect(pastDueGraceDays()).toBe(7);
    pushEnv({ PAST_DUE_GRACE_DAYS: undefined });
    expect(pastDueGraceDays()).toBe(7);
  });

  it('subscriptionGrantsPaidAccess: allowlist, grace window, fail-closed', () => {
    pushEnv({ PAST_DUE_GRACE_DAYS: '7' });
    const base = { planId: 'diet', pastDueSince: null as Date | null };
    expect(subscriptionGrantsPaidAccess({ ...base, status: 'active' })).toBe(true);
    expect(subscriptionGrantsPaidAccess({ ...base, status: 'trialing' })).toBe(true);
    expect(subscriptionGrantsPaidAccess({ ...base, status: 'incomplete' })).toBe(false);
    expect(subscriptionGrantsPaidAccess({ ...base, status: 'unpaid' })).toBe(false);
    expect(subscriptionGrantsPaidAccess({ ...base, status: 'canceled' })).toBe(false);
    expect(subscriptionGrantsPaidAccess({ planId: 'free', status: 'active', pastDueSince: null })).toBe(false);
    // past_due inside the window -> access; past_due outside -> revoked
    expect(
      subscriptionGrantsPaidAccess({
        ...base,
        status: 'past_due',
        pastDueSince: new Date(Date.now() - 3 * 86400_000),
      }),
    ).toBe(true);
    expect(
      subscriptionGrantsPaidAccess({
        ...base,
        status: 'past_due',
        pastDueSince: new Date(Date.now() - 8 * 86400_000),
      }),
    ).toBe(false);
    // past_due with no recorded clock start -> fail-closed
    expect(subscriptionGrantsPaidAccess({ ...base, status: 'past_due' })).toBe(false);
  });
});

describe('signature/provider gating', () => {
  it('BILLING_PROVIDER=none never processes events even with a valid signature', async () => {
    pushEnv({
      BILLING_PROVIDER: 'none',
      STRIPE_SECRET_KEY: 'sk_test_dummy_123',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_PRICE_DIET: PRICE_DIET,
      STRIPE_PRICE_DIET_EXERCISE: PRICE_DIET_EXERCISE,
    });
    const { req, eventId } = signedWebhook('invoice.payment_failed', {
      id: 'in_none',
      object: 'invoice',
      customer: 'cus_test_1',
      parent: { subscription_details: { subscription: 'sub_none' } },
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(503);
    expect((await readJson(res)).error.code).toBe('billing_provider_not_stripe');
    // nothing claimed, nothing processed
    const claimed = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } });
    expect(claimed).toBeNull();
  });

  it('wrong-secret signature -> 400', async () => {
    stripeTestEnv();
    const raw = JSON.stringify({ id: nextEventId(), object: 'event', type: 'ping' });
    const badSig = Stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret: 'whsec_wrong_secret',
    });
    const res = await webhookPOST(
      new NextRequest('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': badSig, 'content-type': 'application/json' },
        body: raw,
      }),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('invalid_signature');
  });
});

describe('price-ID trust', () => {
  it('checkout with unknown price -> 200 ACK but NO entitlement (plan stays free)', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-gate-unkprice'));
    const stripeSubId = `sub_test_unkprice_${Date.now()}`;
    // V3, P2-3: the webhook binds only via the server-side session mapping
    // stored at checkout creation.
    await prisma.subscription.update({
      where: { userId },
      data: { stripeCheckoutSessionId: 'cs_unkprice' },
    });
    const restore = stubSubscriptionRetrieve(
      cannedSub({
        id: stripeSubId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ id: 'si_x', current_period_end: 1893456000, price: { id: PRICE_UNKNOWN } }],
        },
      }),
    );
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_unkprice',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200); // acked so Stripe does not retry pointlessly
    } finally {
      restore();
    }
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free'); // NO entitlement
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId); // binding recorded
  });

  it('checkout with price/plan mismatch (price=diet_exercise, metadata=diet) -> no entitlement', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-gate-mismatch'));
    const stripeSubId = `sub_test_mismatch_${Date.now()}`;
    // V3, P2-3: the webhook binds only via the server-side session mapping
    // stored at checkout creation.
    await prisma.subscription.update({
      where: { userId },
      data: { stripeCheckoutSessionId: 'cs_mismatch' },
    });
    const restore = stubSubscriptionRetrieve(
      cannedSub({
        id: stripeSubId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ id: 'si_x', current_period_end: 1893456000, price: { id: PRICE_DIET_EXERCISE } }],
        },
      }),
    );
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_mismatch',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
    } finally {
      restore();
    }
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free'); // mismatch -> hold safe
  });
});

describe('status allowlist', () => {
  it('checkout.session.completed with INCOMPLETE subscription does NOT activate (waits for payment)', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-gate-incomplete'));
    const stripeSubId = `sub_test_incomplete_${Date.now()}`;
    // V3, P2-3: the webhook binds only via the server-side session mapping
    // stored at checkout creation.
    await prisma.subscription.update({
      where: { userId },
      data: { stripeCheckoutSessionId: 'cs_incomplete' },
    });
    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId, status: 'incomplete' }));
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_incomplete',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
    } finally {
      restore();
    }
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free'); // NOT activated on incomplete
    expect(sub?.status).toBe('incomplete');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
  });

  it('invoice.payment_succeeded after incomplete checkout activates the plan', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-gate-latepay'));
    const stripeSubId = `sub_test_latepay_${Date.now()}`;
    await prisma.subscription.upsert({
      where: { userId },
      update: {
        planId: 'free',
        status: 'incomplete',
        provider: 'stripe',
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_1',
      },
      create: {
        userId,
        planId: 'free',
        status: 'incomplete',
        provider: 'stripe',
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_1',
      },
    });
    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId, status: 'active' }));
    try {
      const { req } = signedWebhook('invoice.payment_succeeded', {
        id: 'in_latepay',
        object: 'invoice',
        customer: 'cus_test_1',
        parent: { subscription_details: { subscription: stripeSubId } },
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
    } finally {
      restore();
    }
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.status).toBe('active');
  });

  it('subscription.updated with status unpaid NEVER grants paid access', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_unpaid_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-unpaid', stripeSubId);
    const { req } = signedWebhook('customer.subscription.updated', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'unpaid',
      cancel_at_period_end: false,
      items: {
        object: 'list',
        data: [{ id: 'si_x', current_period_end: 1893456000, price: { id: PRICE_DIET } }],
      },
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
  });

  it('subscription.updated with status incomplete_expired downgrades to free', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_incexp_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-incexp', stripeSubId);
    const { req } = signedWebhook('customer.subscription.updated', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'incomplete_expired',
      cancel_at_period_end: false,
      items: {
        object: 'list',
        data: [{ id: 'si_x', current_period_end: 1893456000, price: { id: PRICE_DIET } }],
      },
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
    expect(sub?.stripeSubscriptionId).toBeNull();
  });
});

describe('past_due finite grace', () => {
  it('first failure starts the clock; later failures do not reset it', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_clock_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-clock', stripeSubId);

    const failInvoice = () =>
      signedWebhook('invoice.payment_failed', {
        id: `in_clock_${Math.random().toString(36).slice(2, 8)}`,
        object: 'invoice',
        customer: 'cus_test_1',
        parent: { subscription_details: { subscription: stripeSubId } },
      });

    const first = failInvoice();
    await webhookPOST(first.req);
    const afterFirst = await prisma.subscription.findUnique({ where: { userId } });
    expect(afterFirst?.status).toBe('past_due');
    expect(afterFirst?.planId).toBe('diet'); // grace: access kept
    expect(afterFirst?.pastDueSince).toBeInstanceOf(Date);
    const clockStart = afterFirst!.pastDueSince!.getTime();

    const second = failInvoice();
    await webhookPOST(second.req);
    const afterSecond = await prisma.subscription.findUnique({ where: { userId } });
    expect(afterSecond?.pastDueSince?.getTime()).toBe(clockStart); // NOT reset
  });

  it('after the grace window expires, the next webhook event revokes access', async () => {
    stripeTestEnv();
    pushEnv({ PAST_DUE_GRACE_DAYS: '7' });
    const stripeSubId = `sub_test_expire_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-expire', stripeSubId);
    // Simulate a past_due subscription whose grace window expired 8 days ago.
    await prisma.subscription.update({
      where: { userId },
      data: { status: 'past_due', pastDueSince: new Date(Date.now() - 8 * 86400_000) },
    });

    const { req } = signedWebhook('invoice.payment_failed', {
      id: 'in_expire',
      object: 'invoice',
      customer: 'cus_test_1',
      parent: { subscription_details: { subscription: stripeSubId } },
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free'); // grace expired -> revoked
    expect(sub?.status).toBe('active');
    expect(sub?.pastDueSince).toBeNull();
  });

  it('successful renewal clears the arrears clock', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_renew_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-renew', stripeSubId);
    await prisma.subscription.update({
      where: { userId },
      data: { status: 'past_due', pastDueSince: new Date(Date.now() - 2 * 86400_000) },
    });
    const restore = stubSubscriptionRetrieve(
      cannedSub({ id: stripeSubId, status: 'active' }),
    );
    try {
      const { req } = signedWebhook('invoice.payment_succeeded', {
        id: 'in_renew',
        object: 'invoice',
        customer: 'cus_test_1',
        parent: { subscription_details: { subscription: stripeSubId } },
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
    } finally {
      restore();
    }
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.status).toBe('active');
    expect(sub?.pastDueSince).toBeNull();
    expect(sub?.currentPeriodEnd).toBeInstanceOf(Date);
  });
});

describe('concurrent duplicate delivery', () => {
  it('same event id fired twice concurrently is processed exactly once', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_conc_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-conc', stripeSubId);

    const { req, raw, eventId } = signedWebhook('invoice.payment_failed', {
      id: 'in_conc',
      object: 'invoice',
      customer: 'cus_test_1',
      parent: { subscription_details: { subscription: stripeSubId } },
    });
    const sig = Stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret: WEBHOOK_SECRET,
    });
    const req2 = new NextRequest('http://localhost/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      body: raw,
    });

    const [r1, r2] = await Promise.all([webhookPOST(req), webhookPOST(req2)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const rows = await prisma.stripeWebhookEvent.findMany({ where: { eventId } });
    expect(rows.length).toBe(1);
    expect(rows[0]?.processedAt).toBeInstanceOf(Date);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.status).toBe('past_due');
    expect(sub?.planId).toBe('diet');
    expect(sub?.pastDueSince).toBeInstanceOf(Date);
  });
});

describe('lifecycle correctness', () => {
  it('cancel_at_period_end keeps access; the later deleted event revokes it', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_cancend_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-cancend', stripeSubId);

    const { req: updReq } = signedWebhook('customer.subscription.updated', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'active',
      cancel_at_period_end: true,
      items: {
        object: 'list',
        data: [{ id: 'si_x', current_period_end: 1893456000, price: { id: PRICE_DIET } }],
      },
    });
    expect((await webhookPOST(updReq)).status).toBe(200);
    const mid = await prisma.subscription.findUnique({ where: { userId } });
    expect(mid?.planId).toBe('diet'); // access kept until period end
    expect(mid?.status).toBe('active');

    const { req: delReq } = signedWebhook('customer.subscription.deleted', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'canceled',
    });
    expect((await webhookPOST(delReq)).status).toBe(200);
    const end = await prisma.subscription.findUnique({ where: { userId } });
    expect(end?.planId).toBe('free');
  });

  it('subscription.updated with a new KNOWN price remaps the plan', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_planchange_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-planchange', stripeSubId);

    const { req } = signedWebhook('customer.subscription.updated', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'active',
      cancel_at_period_end: false,
      items: {
        object: 'list',
        data: [{ id: 'si_x', current_period_end: 1893456000, price: { id: PRICE_DIET_EXERCISE } }],
      },
    });
    expect((await webhookPOST(req)).status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet_exercise');
    expect(sub?.status).toBe('active');
  });

  it('subscription.updated with an UNKNOWN price holds the current plan (no downgrade, no upgrade)', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_unkupd_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-unkupd', stripeSubId);

    const { req } = signedWebhook('customer.subscription.updated', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'active',
      cancel_at_period_end: false,
      items: {
        object: 'list',
        data: [{ id: 'si_x', current_period_end: 1893456000, price: { id: PRICE_UNKNOWN } }],
      },
    });
    expect((await webhookPOST(req)).status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet'); // held safe
    expect(sub?.status).toBe('active');
  });

  it('subscription.updated with status canceled downgrades immediately', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_imcancel_${Date.now()}`;
    const userId = await seedPaidUser('ff-gate-imcancel', stripeSubId);
    const { req } = signedWebhook('customer.subscription.updated', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'canceled',
      cancel_at_period_end: false,
      items: {
        object: 'list',
        data: [{ id: 'si_x', current_period_end: 1893456000, price: { id: PRICE_DIET } }],
      },
    });
    expect((await webhookPOST(req)).status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
  });
});

describe('user binding', () => {
  it('checkout for a NONEXISTENT user grants nothing (acked, no crash)', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_nouser_${Date.now()}`;
    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId, status: 'active' }));
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_nouser',
        object: 'checkout.session',
        client_reference_id: 'user_does_not_exist_123',
        metadata: { userId: 'user_does_not_exist_123', planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200); // acked — must not 500/retry forever
    } finally {
      restore();
    }
    const sub = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubId },
    });
    expect(sub).toBeNull(); // nothing created for a fake user
  });

  it('checkout with mismatched binding sources (client_reference_id != metadata.userId) grants nothing', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-gate-bindmis'));
    const { userId: otherId } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-gate-bindmis2'));
    const stripeSubId = `sub_test_bindmis_${Date.now()}`;
    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId, status: 'active' }));
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: 'cs_bindmis',
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId: otherId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
    } finally {
      restore();
    }
    for (const id of [userId, otherId]) {
      const sub = await prisma.subscription.findUnique({ where: { userId: id } });
      expect(sub?.planId).toBe('free');
    }
  });
});
