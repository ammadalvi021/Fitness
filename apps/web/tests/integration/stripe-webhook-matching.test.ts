/**
 * V3 webhook subscription-matching tests (P2 + P3).
 *
 * Hardens `POST /api/billing/webhook` (`apps/web/app/api/billing/webhook/route.ts`):
 *  P2 — exact subscription-ID matching:
 *   1. Event for an OLD (previously canceled) subscription ID after a new
 *      subscription is established -> current row untouched.
 *   2. Event with an UNKNOWN subscription ID but a KNOWN customer ID -> no
 *      entitlement change, ACKed 200 (no silent customer-ID fallback).
 *   3. Duplicate `checkout.session.completed` (sequential + concurrent) ->
 *      single activation, idempotent.
 *   4. `checkout.session.completed` is bound ONLY through the server-side
 *      session mapping stored at checkout creation (`stripeCheckoutSessionId`);
 *      missing/mismatched mapping -> no binding, no entitlement.
 *  P3 — unknown/mismatched prices fail closed ("fail closed on access, hold
 *  safe on state, never upgrade on unverified data" — see the webhook
 *  route's header comment for the full policy):
 *   5. Unknown price on a new checkout -> no paid entitlement, identifiers
 *      preserved for support.
 *   6. Plan ID in metadata disagreeing with the Stripe Price ID -> price ID
 *      wins, fail closed.
 *   7. Previously valid subscription whose price changes to an unknown ID ->
 *      no unverified upgrade (plan held), identifiers preserved.
 *   8. An anomalous checkout never clobbers an existing verified paid
 *      subscription.
 *   9. Past-due grace expiry preserves `stripeSubscriptionId` (the Stripe
 *      subscription is still alive), so a later successful payment
 *      re-activates.
 *
 * MOCKED (clearly labeled — no Stripe network calls are made):
 * - Signatures are REAL HMAC signatures produced locally with
 *   `Stripe.webhooks.generateTestHeaderString` and a dummy `whsec_...`
 *   secret — signature verification itself is genuinely exercised.
 * - `stripe.subscriptions.retrieve()` (called by the checkout and invoice
 *   handlers) is stubbed on the route's own Stripe instance to return
 *   canned subscription objects. Everything else (signature check,
 *   idempotency claim, session-mapping validation, DB writes) runs for real.
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
const PRICE_UNKNOWN = 'price_test_unknown_xyz';
const EVT_PREFIX = 'evt_test_whm_';

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
 * MOCKED: stub stripe.subscriptions.retrieve on the route's Stripe instance.
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

function cannedSub(overrides: Record<string, unknown> = {}) {
  return {
    id: `sub_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    object: 'subscription',
    customer: 'cus_test_1',
    status: 'active',
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test_1',
          current_period_end: 1893456000,
          price: { id: PRICE_DIET },
        },
      ],
    },
    ...overrides,
  };
}

function priceItems(priceId: string) {
  return {
    object: 'list',
    data: [
      {
        id: 'si_test_1',
        current_period_end: 1893456000,
        price: { id: priceId },
      },
    ],
  };
}

/** Seed a paid subscription row for a fresh user. */
async function seedPaidUser(
  emailPrefix: string,
  subId: string,
  extra: Record<string, unknown> = {},
) {
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
      ...extra,
    },
    create: {
      userId,
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      stripeSubscriptionId: subId,
      stripeCustomerId: 'cus_test_1',
      ...(extra as Record<string, never>),
    },
  });
  return userId;
}

/** Seed the server-side checkout-session mapping for a user. */
async function seedSessionMapping(userId: string, sessionId: string) {
  await prisma.subscription.update({
    where: { userId },
    data: { stripeCheckoutSessionId: sessionId },
  });
}

describe('P2: exact subscription-ID matching (no customer-ID fallback)', () => {
  it('event for an OLD canceled subscription ID after a new one is established -> current row untouched', async () => {
    stripeTestEnv();
    const subNew = `sub_test_new_${Date.now()}`;
    const subOld = `sub_test_old_${Date.now()}`;
    const userId = await seedPaidUser('ff-whm-oldsub', subNew);

    // A delayed event for the OLD, canceled subscription (same customer).
    const { req } = signedWebhook('customer.subscription.updated', {
      id: subOld,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'canceled',
      cancel_at_period_end: false,
      items: priceItems(PRICE_DIET),
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200); // ACKed so Stripe does not retry pointlessly
    expect((await readJson(res)).received).toBe(true);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet'); // untouched — NOT downgraded
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBe(subNew); // still the current one
  });

  it('event with UNKNOWN subscription ID but KNOWN customer ID -> no entitlement change, ACKed', async () => {
    stripeTestEnv();
    const subKnown = `sub_test_known_${Date.now()}`;
    const subUnknown = `sub_test_unknown_${Date.now()}`;
    const userId = await seedPaidUser('ff-whm-unknsub', subKnown);

    // invoice.payment_failed for an untracked subscription of the SAME customer
    // must NOT mark the current row past_due (the old fallback did exactly that).
    const restore = stubSubscriptionRetrieve(
      cannedSub({ id: subUnknown, status: 'past_due' }),
    );
    try {
      const { req } = signedWebhook('invoice.payment_failed', {
        id: 'in_whm_unknown',
        object: 'invoice',
        customer: 'cus_test_1',
        parent: { subscription_details: { subscription: subUnknown } },
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
      expect((await readJson(res)).received).toBe(true);
    } finally {
      restore();
    }

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.status).toBe('active'); // NOT past_due
    expect(sub?.pastDueSince).toBeNull();
    expect(sub?.stripeSubscriptionId).toBe(subKnown);
  });

  it('subscription.deleted for an untracked subscription ID -> current row untouched, ACKed', async () => {
    stripeTestEnv();
    const subCurrent = `sub_test_cur_${Date.now()}`;
    const subGone = `sub_test_gone_${Date.now()}`;
    const userId = await seedPaidUser('ff-whm-gone', subCurrent);

    const { req } = signedWebhook('customer.subscription.deleted', {
      id: subGone,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'canceled',
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.stripeSubscriptionId).toBe(subCurrent);
  });
});

describe('P2: duplicate checkout.session.completed -> single activation, idempotent', () => {
  it('same event id delivered twice sequentially is processed once', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-whm-dupseq'),
    );
    const sessionId = `cs_test_dupseq_${Date.now()}`;
    const stripeSubId = `sub_test_dupseq_${Date.now()}`;
    await seedSessionMapping(userId, sessionId);

    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId }));
    let eventId: string;
    let raw: string;
    try {
      const built = signedWebhook('checkout.session.completed', {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      eventId = built.eventId;
      raw = built.raw;
      const first = await webhookPOST(built.req);
      expect(first.status).toBe(200);
      expect((await readJson(first)).received).toBe(true);

      const sig = Stripe.webhooks.generateTestHeaderString({
        payload: raw,
        secret: WEBHOOK_SECRET,
      });
      const second = await webhookPOST(
        new NextRequest('http://localhost/api/billing/webhook', {
          method: 'POST',
          headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
          body: raw,
        }),
      );
      expect(second.status).toBe(200);
      const secondBody = await readJson(second);
      expect(secondBody.received).toBe(true);
      expect(secondBody.deduped).toBe(true);
    } finally {
      restore();
    }

    const rows = await prisma.stripeWebhookEvent.findMany({ where: { eventId: eventId! } });
    expect(rows).toHaveLength(1);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
    // The consumed session mapping was cleared so it can never re-bind.
    expect(sub?.stripeCheckoutSessionId).toBeNull();
  });

  it('same event id delivered twice CONCURRENTLY is processed once', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-whm-dupconc'),
    );
    const sessionId = `cs_test_dupconc_${Date.now()}`;
    const stripeSubId = `sub_test_dupconc_${Date.now()}`;
    await seedSessionMapping(userId, sessionId);

    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId }));
    let eventId: string;
    try {
      const { req, raw } = signedWebhook('checkout.session.completed', {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
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
      // The event id is embedded in the signed payload; recover it.
      eventId = (JSON.parse(raw) as { id: string }).id;

      const [r1, r2] = await Promise.all([webhookPOST(req), webhookPOST(req2)]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    } finally {
      restore();
    }

    const rows = await prisma.stripeWebhookEvent.findMany({ where: { eventId: eventId! } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processedAt).toBeInstanceOf(Date);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
  });
});

describe('P2: checkout binds ONLY via the server-side session mapping', () => {
  it('checkout.session.completed WITHOUT a stored session mapping -> no binding, no entitlement', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-whm-nomap'),
    );
    const sessionId = `cs_test_nomap_${Date.now()}`;
    const stripeSubId = `sub_test_nomap_${Date.now()}`;
    // NOTE: no seedSessionMapping — nothing stored at "checkout creation".
    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId }));
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200); // ACKed — must not 500/retry forever
    } finally {
      restore();
    }
    // No binding happened: nothing may reference the Stripe subscription.
    const row = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubId },
    });
    expect(row).toBeNull();
    const mine = await prisma.subscription.findUnique({ where: { userId } });
    expect(mine?.planId).toBe('free');
  });

  it('checkout.session.completed with a session id that does NOT match the stored mapping -> no binding', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-whm-badmap'),
    );
    const realSessionId = `cs_test_real_${Date.now()}`;
    const stripeSubId = `sub_test_badmap_${Date.now()}`;
    await seedSessionMapping(userId, `cs_test_other_${Date.now()}`); // different session
    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId }));
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: realSessionId,
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
    const row = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubId },
    });
    expect(row).toBeNull();
    const mine = await prisma.subscription.findUnique({ where: { userId } });
    expect(mine?.planId).toBe('free');
  });
});

describe('P3: unknown/mismatched prices fail closed', () => {
  it('unknown price on a new checkout -> no paid entitlement, identifiers preserved for support', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-whm-unkprice'),
    );
    const sessionId = `cs_test_unkprice_${Date.now()}`;
    const stripeSubId = `sub_test_unkprice_${Date.now()}`;
    await seedSessionMapping(userId, sessionId);
    const restore = stubSubscriptionRetrieve(
      cannedSub({ id: stripeSubId, items: priceItems(PRICE_UNKNOWN) }),
    );
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: stripeSubId,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200); // ACKed so Stripe does not retry pointlessly
    } finally {
      restore();
    }
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free'); // NO paid entitlement
    expect(sub?.status).toBe('active');
    // Identifiers preserved for support/reconciliation (P3-2).
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
    expect(sub?.stripeCustomerId).toBe('cus_test_1');
  });

  it('plan ID in metadata disagreeing with the Stripe Price ID -> price ID wins, fail closed', async () => {
    stripeTestEnv();
    const { userId } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-whm-mismatch'),
    );
    const sessionId = `cs_test_mismatch_${Date.now()}`;
    const stripeSubId = `sub_test_mismatch_${Date.now()}`;
    await seedSessionMapping(userId, sessionId);
    // Price maps to diet_exercise, metadata claims diet -> mismatch.
    const restore = stubSubscriptionRetrieve(
      cannedSub({ id: stripeSubId, items: priceItems(PRICE_DIET_EXERCISE) }),
    );
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: sessionId,
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
    // The metadata planId was NOT granted, and the mismatch did not grant
    // the price's plan either — fail closed.
    expect(sub?.planId).toBe('free');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
    expect(sub?.stripeCustomerId).toBe('cus_test_1');
  });

  it('previously valid subscription whose price changes to an unknown ID -> plan held (no unverified upgrade), identifiers preserved', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_pricechg_${Date.now()}`;
    const userId = await seedPaidUser('ff-whm-pricechg', stripeSubId);

    const { req } = signedWebhook('customer.subscription.updated', {
      id: stripeSubId,
      object: 'subscription',
      customer: 'cus_test_1',
      status: 'active',
      cancel_at_period_end: false,
      items: priceItems(PRICE_UNKNOWN),
    });
    const res = await webhookPOST(req);
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet'); // held safe — never upgraded/downgraded on unverified data
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
    expect(sub?.stripeCustomerId).toBe('cus_test_1');
  });

  it('unknown price on invoice.payment_succeeded -> no unverified upgrade, identifiers preserved', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_test_invunk_${Date.now()}`;
    const userId = await seedPaidUser('ff-whm-invunk', stripeSubId);

    const restore = stubSubscriptionRetrieve(
      cannedSub({ id: stripeSubId, items: priceItems(PRICE_UNKNOWN) }),
    );
    try {
      const { req } = signedWebhook('invoice.payment_succeeded', {
        id: 'in_whm_unk',
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
    expect(sub?.planId).toBe('diet'); // held — no unverified upgrade
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBe(stripeSubId);
  });

  it('anomalous checkout never clobbers an existing verified paid subscription', async () => {
    stripeTestEnv();
    const subCurrent = `sub_test_cur2_${Date.now()}`;
    const subNew = `sub_test_new2_${Date.now()}`;
    const userId = await seedPaidUser('ff-whm-clobber', subCurrent);
    const sessionId = `cs_test_clobber_${Date.now()}`;
    await seedSessionMapping(userId, sessionId);

    // New checkout for a DIFFERENT subscription with an UNKNOWN price.
    const restore = stubSubscriptionRetrieve(
      cannedSub({ id: subNew, items: priceItems(PRICE_UNKNOWN) }),
    );
    try {
      const { req } = signedWebhook('checkout.session.completed', {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: userId,
        metadata: { userId, planId: 'diet' },
        subscription: subNew,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
    } finally {
      restore();
    }

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('diet'); // verified entitlement untouched
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBe(subCurrent); // NOT overwritten
  });
});

describe('P3: identifiers survive revocation paths that must keep working', () => {
  it('past_due grace expiry preserves stripeSubscriptionId; a later successful payment re-activates', async () => {
    stripeTestEnv();
    pushEnv({ PAST_DUE_GRACE_DAYS: '7' });
    const stripeSubId = `sub_test_graceid_${Date.now()}`;
    const userId = await seedPaidUser('ff-whm-graceid', stripeSubId);
    // Simulate a past_due subscription whose grace window expired 8 days ago.
    await prisma.subscription.update({
      where: { userId },
      data: { status: 'past_due', pastDueSince: new Date(Date.now() - 8 * 86400_000) },
    });

    // Any subsequent event triggers grace enforcement -> downgrade to free,
    // but the (still alive at Stripe) subscription id must be preserved.
    const { req } = signedWebhook('invoice.payment_failed', {
      id: 'in_whm_graceid',
      object: 'invoice',
      customer: 'cus_test_1',
      parent: { subscription_details: { subscription: stripeSubId } },
    });
    expect((await webhookPOST(req)).status).toBe(200);
    const afterDowngrade = await prisma.subscription.findUnique({ where: { userId } });
    expect(afterDowngrade?.planId).toBe('free');
    expect(afterDowngrade?.stripeSubscriptionId).toBe(stripeSubId); // preserved (P3-2)
    expect(afterDowngrade?.stripeCustomerId).toBe('cus_test_1');

    // The customer then pays: the same subscription id still reconciles and
    // re-activates the plan.
    const restore = stubSubscriptionRetrieve(cannedSub({ id: stripeSubId }));
    try {
      const { req: payReq } = signedWebhook('invoice.payment_succeeded', {
        id: 'in_whm_graceid_pay',
        object: 'invoice',
        customer: 'cus_test_1',
        parent: { subscription_details: { subscription: stripeSubId } },
      });
      expect((await webhookPOST(payReq)).status).toBe(200);
    } finally {
      restore();
    }
    const reactivated = await prisma.subscription.findUnique({ where: { userId } });
    expect(reactivated?.planId).toBe('diet');
    expect(reactivated?.status).toBe('active');
    expect(reactivated?.pastDueSince).toBeNull();
  });
});
