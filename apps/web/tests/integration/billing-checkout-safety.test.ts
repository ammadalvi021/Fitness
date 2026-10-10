/**
 * V3 checkout-safety tests (Priority 1): duplicate Stripe subscriptions must
 * never be created.
 *
 * All Stripe SDK calls are MOCKED (stubbed on the route's own Stripe
 * instance — customers.retrieve / customers.create /
 * checkout.sessions.create+retrieve / subscriptions.retrieve never touch
 * the network). Mock tests verify the ROUTE's logic (conflict detection,
 * session reuse, idempotency-key passthrough); they do NOT prove the real
 * Stripe integration end-to-end — that still requires live test-mode keys.
 *
 * Coverage:
 *  1. Repeated checkout clicks (same user, same plan, twice) -> exactly ONE
 *     Stripe session/subscription creation attempt; the second request
 *     resolves to the existing (still-open) session.
 *  2. Plan change while a billable subscription exists -> 409
 *     `existing_subscription_conflict`; never a second subscription.
 *  3. Retried request with the same idempotency key -> single creation;
 *     the key is passed through to the Stripe SDK.
 *  4. Canceled (terminal) remote subscription -> local linkage synced and a
 *     fresh checkout is allowed (deliberate, documented).
 *  5. BILLING_PROVIDER=none -> 503 `stripe_not_configured`, zero SDK calls.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { getStripe } from '@/lib/billing';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as checkoutPOST } from '@/app/api/billing/checkout/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

const PRICE_DIET = 'price_test_diet';
const PRICE_DIET_EXERCISE = 'price_test_diet_exercise';
const MOCK_SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_mock_safety_1';

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
    STRIPE_WEBHOOK_SECRET: 'whsec_test_dummy_123',
    STRIPE_PRICE_DIET: PRICE_DIET,
    STRIPE_PRICE_DIET_EXERCISE: PRICE_DIET_EXERCISE,
  });
}
function noneEnv() {
  pushEnv({
    BILLING_PROVIDER: undefined,
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    STRIPE_PRICE_DIET: undefined,
    STRIPE_PRICE_DIET_EXERCISE: undefined,
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
afterAll(cleanupUsers);

/**
 * MOCKED Stripe SDK for the checkout route. Counts real "creation"
 * attempts on `checkout.sessions.create`, simulates Stripe's server-side
 * idempotency-key replay, and serves `subscriptions.retrieve` /
 * `checkout.sessions.retrieve` from caller-controlled fixtures.
 *
 * Fixtures:
 *   remoteSubscriptions: Map<stripeSubId, {id, status, customer}>
 *   openSessions: Map<sessionId, {id, url, status}>
 */
function stubSafetySdk() {
  const stripe = getStripe();
  if (!stripe) throw new Error('expected configured Stripe client in test');
  const state = {
    sessionCreations: 0, // new sessions actually created (not idempotent replays)
    subscriptionRetrievals: 0,
    customerCreations: 0,
    lastRequestOptions: null as Record<string, unknown> | null,
    createdParams: [] as Array<Record<string, unknown>>,
    remoteSubscriptions: new Map<string, { id: string; status: string; customer: string }>(),
    openSessions: new Map<string, { id: string; url: string; status: string }>(),
    idempotencyReplay: new Map<string, { id: string; url: string }>(),
    sessionSeq: 0,
  };
  const customers = stripe.customers as unknown as Record<string, unknown>;
  const sessions = (
    stripe.checkout as unknown as Record<string, Record<string, unknown>>
  ).sessions;
  const subscriptions = stripe.subscriptions as unknown as Record<string, unknown>;
  const orig = {
    retrieveCustomer: customers.retrieve,
    createCustomer: customers.create,
    createSession: sessions.create,
    retrieveSession: sessions.retrieve,
    retrieveSubscription: subscriptions.retrieve,
  };
  customers.retrieve = async () => ({ id: 'cus_safety_mock', deleted: false });
  customers.create = async (params: Record<string, unknown>) => {
    state.customerCreations += 1;
    return { id: `cus_safety_new_${state.customerCreations}`, object: 'customer', email: (params as { email?: string }).email ?? null };
  };
  sessions.create = async (
    params: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => {
    state.createdParams.push(params);
    state.lastRequestOptions = options ?? null;
    const key = (options as { idempotencyKey?: string } | undefined)?.idempotencyKey;
    if (key && state.idempotencyReplay.has(key)) {
      // Stripe server-side idempotent replay: same session, no new creation.
      const replay = state.idempotencyReplay.get(key)!;
      return { id: replay.id, object: 'checkout.session', url: replay.url };
    }
    state.sessionCreations += 1;
    state.sessionSeq += 1;
    const id = `cs_safety_${state.sessionSeq}`;
    const url = `${MOCK_SESSION_URL}_${state.sessionSeq}`;
    const session = { id, object: 'checkout.session', url, status: 'open' };
    state.openSessions.set(id, { id, url, status: 'open' });
    if (key) state.idempotencyReplay.set(key, { id, url });
    return session;
  };
  sessions.retrieve = async (id: string) => {
    const s = state.openSessions.get(id);
    if (!s) {
      const err = new Error(`No such checkout.session: ${id}`) as Error & {
        code: string;
        statusCode: number;
      };
      err.code = 'resource_missing';
      err.statusCode = 404;
      throw err;
    }
    return { id: s.id, object: 'checkout.session', url: s.url, status: s.status };
  };
  subscriptions.retrieve = async (id: string) => {
    state.subscriptionRetrievals += 1;
    const s = state.remoteSubscriptions.get(id);
    if (!s) {
      const err = new Error(`No such subscription: ${id}`) as Error & {
        code: string;
        statusCode: number;
      };
      err.code = 'resource_missing';
      err.statusCode = 404;
      throw err;
    }
    return {
      id: s.id,
      object: 'subscription',
      status: s.status,
      customer: s.customer,
      items: { data: [] },
    };
  };
  return {
    state,
    restore() {
      customers.retrieve = orig.retrieveCustomer;
      customers.create = orig.createCustomer;
      sessions.create = orig.createSession;
      sessions.retrieve = orig.retrieveSession;
      subscriptions.retrieve = orig.retrieveSubscription;
    },
  };
}

function checkoutReq(token: string, body: unknown) {
  return authed(
    jsonRequest('http://localhost/api/billing/checkout', 'POST', body),
    token,
  );
}

async function userWithLocalSub(prefix: string, data: Record<string, unknown>) {
  const email = uniqueEmail(prefix);
  const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
  await prisma.subscription.upsert({
    where: { userId },
    update: data,
    create: { userId, planId: 'free', status: 'active', ...data },
  });
  return { userId, token };
}

describe('repeated checkout clicks -> exactly ONE session, second resolves to the existing one', () => {
  it('second POST returns the same checkout URL; sessions.create ran once', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-safe-dbl');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const { state, restore } = stubSafetySdk();
    try {
      const first = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
      expect(first.status).toBe(200);
      const firstBody = await readJson(first);
      expect(firstBody.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

      const second = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
      expect(second.status).toBe(200);
      const secondBody = await readJson(second);

      // Same session resolved — never a second one.
      expect(secondBody.url).toBe(firstBody.url);
      expect(secondBody.reused).toBe(true);
      expect(state.sessionCreations).toBe(1);
    } finally {
      restore();
    }
    // The pending session is tracked on the local row (no plan granted).
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.stripeCheckoutSessionId).toMatch(/^cs_safety_/);
    expect(sub?.planId).toBe('free');
  });

  it('concurrent double POSTs collapse to one creation (in-flight guard)', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-safe-conc');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const { state, restore } = stubSafetySdk();
    try {
      const [a, b] = await Promise.all([
        checkoutPOST(checkoutReq(token, { planId: 'diet' })),
        checkoutPOST(checkoutReq(token, { planId: 'diet' })),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect((await readJson(a)).url).toBe((await readJson(b)).url);
      expect(state.sessionCreations).toBe(1);
    } finally {
      restore();
    }
  });
});

describe('existing billable subscription -> 409, never a second subscription', () => {
  it('plan change with remote status active -> 409 existing_subscription_conflict', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_safe_active_${Date.now()}`;
    const { userId, token } = await userWithLocalSub('ff-safe-act', {
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      providerRef: stripeSubId,
      stripeCustomerId: 'cus_safe_active',
      stripeSubscriptionId: stripeSubId,
    });
    const { state, restore } = stubSafetySdk();
    try {
      state.remoteSubscriptions.set(stripeSubId, {
        id: stripeSubId,
        status: 'active',
        customer: 'cus_safe_active',
      });
      const res = await checkoutPOST(checkoutReq(token, { planId: 'diet_exercise' }));
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body.error.code).toBe('existing_subscription_conflict');
      expect(body.error.message).toContain(stripeSubId);
      // Never created a second session/subscription.
      expect(state.sessionCreations).toBe(0);
      expect(state.createdParams).toHaveLength(0);
      // Local row untouched — no silent change.
      const row = await prisma.subscription.findUnique({ where: { userId } });
      expect(row?.stripeSubscriptionId).toBe(stripeSubId);
      expect(row?.planId).toBe('diet');
    } finally {
      restore();
    }
  });

  it('remote incomplete subscription also blocks (409) — no piling up incomplete subs', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_safe_inc_${Date.now()}`;
    const { token } = await userWithLocalSub('ff-safe-inc', {
      planId: 'free',
      status: 'incomplete',
      provider: 'stripe',
      providerRef: stripeSubId,
      stripeCustomerId: 'cus_safe_inc',
      stripeSubscriptionId: stripeSubId,
    });
    const { state, restore } = stubSafetySdk();
    try {
      state.remoteSubscriptions.set(stripeSubId, {
        id: stripeSubId,
        status: 'incomplete',
        customer: 'cus_safe_inc',
      });
      const res = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
      expect(res.status).toBe(409);
      expect((await readJson(res)).error.code).toBe('existing_subscription_conflict');
      expect(state.sessionCreations).toBe(0);
    } finally {
      restore();
    }
  });

  it('expired pending session -> fresh session is created (no stale reuse)', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-safe-exp');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const { state, restore } = stubSafetySdk();
    try {
      const first = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
      expect(first.status).toBe(200);
      const firstBody = await readJson(first);
      // The session expired at Stripe since the first click.
      const stored = (await prisma.subscription.findUnique({ where: { userId } }))!;
      state.openSessions.set(stored.stripeCheckoutSessionId!, {
        id: stored.stripeCheckoutSessionId!,
        url: stored.stripeCheckoutSessionUrl!,
        status: 'expired',
      });
      const second = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
      expect(second.status).toBe(200);
      const secondBody = await readJson(second);
      expect(secondBody.reused).toBeUndefined();
      expect(state.sessionCreations).toBe(2);
      expect(secondBody.url).not.toBe(firstBody.url);
    } finally {
      restore();
    }
  });
});

describe('retried request with the same idempotency key -> single creation', () => {
  it('same idempotency key twice -> one creation, key passed to the SDK', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-safe-idem');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const { state, restore } = stubSafetySdk();
    try {
      const key = `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Simulate the retry path: the pending-session store is bypassed by
      // marking the created session expired so the idempotency replay is the
      // mechanism under test.
      const first = await checkoutPOST(checkoutReq(token, { planId: 'diet', idempotencyKey: key }));
      expect(first.status).toBe(200);
      const firstUrl = (await readJson(first)).url;
      state.openSessions.clear(); // session unknown locally -> replay via key

      const second = await checkoutPOST(checkoutReq(token, { planId: 'diet', idempotencyKey: key }));
      expect(second.status).toBe(200);
      expect((await readJson(second)).url).toBe(firstUrl);
      expect(state.sessionCreations).toBe(1);
      // The key reached the Stripe SDK on both attempts.
      expect(state.lastRequestOptions).toMatchObject({ idempotencyKey: key });
    } finally {
      restore();
    }
  });
});

describe('terminal / stale remote state -> synced locally, fresh checkout allowed', () => {
  it('remote canceled subscription -> local linkage synced, checkout proceeds (200)', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_safe_cxl_${Date.now()}`;
    const { userId, token } = await userWithLocalSub('ff-safe-cxl', {
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      providerRef: stripeSubId,
      stripeCustomerId: 'cus_safe_cxl',
      stripeSubscriptionId: stripeSubId,
    });
    const { state, restore } = stubSafetySdk();
    try {
      state.remoteSubscriptions.set(stripeSubId, {
        id: stripeSubId,
        status: 'canceled',
        customer: 'cus_safe_cxl',
      });
      const res = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      expect(state.sessionCreations).toBe(1);
      // Local linkage synced to free (mirrors the webhook downgrade).
      const row = await prisma.subscription.findUnique({ where: { userId } });
      expect(row?.stripeSubscriptionId).toBeNull();
      expect(row?.providerRef).toBeNull();
      expect(row?.planId).toBe('free');
      expect(row?.stripeCheckoutSessionId).toMatch(/^cs_safety_/);
    } finally {
      restore();
    }
  });

  it('stale stripeSubscriptionId (remote 404) -> linkage cleared, checkout proceeds', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_safe_stale_${Date.now()}`;
    const { userId, token } = await userWithLocalSub('ff-safe-stale', {
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      providerRef: stripeSubId,
      stripeCustomerId: 'cus_safe_stale',
      stripeSubscriptionId: stripeSubId,
    });
    const { state, restore } = stubSafetySdk();
    try {
      // Not added to remoteSubscriptions -> retrieve throws resource_missing.
      const res = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
      expect(res.status).toBe(200);
      expect(state.sessionCreations).toBe(1);
      const row = await prisma.subscription.findUnique({ where: { userId } });
      expect(row?.stripeSubscriptionId).toBeNull();
    } finally {
      restore();
    }
  });

  it('remote lookup transport failure -> 503 stripe_lookup_failed (fail closed)', async () => {
    stripeTestEnv();
    const stripeSubId = `sub_safe_err_${Date.now()}`;
    const { userId, token } = await userWithLocalSub('ff-safe-err', {
      planId: 'diet',
      status: 'active',
      provider: 'stripe',
      providerRef: stripeSubId,
      stripeCustomerId: 'cus_safe_err',
      stripeSubscriptionId: stripeSubId,
    });
    const stripe = getStripe()!;
    const subs = stripe.subscriptions as unknown as Record<string, unknown>;
    const orig = subs.retrieve;
    subs.retrieve = async () => {
      const err = new Error('boom') as Error & { statusCode: number };
      err.statusCode = 500;
      throw err;
    };
    try {
      const res = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
      expect(res.status).toBe(503);
      expect((await readJson(res)).error.code).toBe('stripe_lookup_failed');
      // Local row left untouched — never sync on an ambiguous failure.
      const row = await prisma.subscription.findUnique({ where: { userId } });
      expect(row?.stripeSubscriptionId).toBe(stripeSubId);
    } finally {
      subs.retrieve = orig;
    }
  });
});

describe('BILLING_PROVIDER=none -> 503, zero SDK calls', () => {
  it('stripe_not_configured, no subscription lookup or session creation attempted', async () => {
    noneEnv();
    const email = uniqueEmail('ff-safe-none');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    // No SDK stub installed on purpose: requireStripe() must throw before any
    // Stripe call is possible. getStripe() returns null in none mode.
    expect(getStripe()).toBeNull();
    const res = await checkoutPOST(checkoutReq(token, { planId: 'diet' }));
    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body.error.code).toBe('stripe_not_configured');
    expect(body.url).toBeUndefined();
    // Nothing persisted server-side either.
    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.stripeCheckoutSessionId).toBeNull();
  });
});
