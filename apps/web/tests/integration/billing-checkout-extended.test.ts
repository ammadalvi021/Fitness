/**
 * Phase 5 (V2 hardening) tests: checkout flow + cancellation/downgrade safety.
 *
 * Covers §8 items:
 *  1. Plans checkout: redirect-on-success shape and error paths for
 *     POST /api/billing/checkout. The Stripe SDK network calls are MOCKED
 *     (stubbed on the route's own Stripe instance — customers.retrieve /
 *     customers.create / checkout.sessions.create never hit the network);
 *     signature of the created session (mode, price, metadata) is captured
 *     and asserted. A real end-to-end Stripe test-mode checkout (real
 *     Checkout Session + real webhook delivery) is BLOCKED: it needs live
 *     STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / price IDs, which are not
 *     available in this environment.
 *  2. No paid access in `none` mode: paid selection rejected (402) and paid
 *     features gated (403) — combined contract in one flow.
 *  8. Legacy POST /api/subscriptions/cancel and direct free-plan downgrade
 *     cannot orphan an active Stripe subscription.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { getStripe } from '@/lib/billing';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as checkoutPOST } from '@/app/api/billing/checkout/route';
import { POST as subscriptionsPOST } from '@/app/api/subscriptions/route';
import { POST as legacyCancelPOST } from '@/app/api/subscriptions/cancel/route';
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
const MOCK_SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_mock_checkout_1';

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
 * MOCKED: stub the Stripe SDK methods the checkout route calls so the
 * session-creation contract is exercised without network. Captures the
 * params passed to checkout.sessions.create. Returns {captured, restore}.
 */
function stubCheckoutSdk() {
  const stripe = getStripe();
  if (!stripe) throw new Error('expected configured Stripe client in test');
  const captured: { params: Record<string, unknown> | null } = { params: null };
  const customers = stripe.customers as unknown as Record<string, unknown>;
  const sessions = (
    stripe.checkout as unknown as Record<string, Record<string, unknown>>
  ).sessions;
  const origRetrieve = customers.retrieve;
  const origCreateCustomer = customers.create;
  const origCreateSession = sessions.create;
  customers.retrieve = async () => ({ id: 'cus_old_mock', deleted: true });
  customers.create = async (params: Record<string, unknown>) => ({
    id: 'cus_mock_new_1',
    object: 'customer',
    email: (params as { email?: string }).email ?? null,
  });
  sessions.create = async (params: Record<string, unknown>) => {
    captured.params = params;
    return { id: 'cs_mock_checkout_1', object: 'checkout.session', url: MOCK_SESSION_URL };
  };
  return {
    captured,
    restore() {
      customers.retrieve = origRetrieve;
      customers.create = origCreateCustomer;
      sessions.create = origCreateSession;
    },
  };
}

describe('POST /api/billing/checkout — success path (SDK mocked)', () => {
  it('valid request returns the Stripe Checkout URL (redirect target) with correct session shape', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-co-ok');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const { captured, restore } = stubCheckoutSdk();
    try {
      const res = await checkoutPOST(
        authed(
          jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'diet' }),
          token,
        ),
      );
      expect(res.status).toBe(200);
      const body = await readJson(res);
      // Contract: { planId } -> { url } — the client redirects to this URL.
      expect(body.url).toBe(MOCK_SESSION_URL);
      expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

      // The session must be a real subscription-mode session for THIS user/plan.
      const p = captured.params!;
      expect(p.mode).toBe('subscription');
      expect(p.customer).toBe('cus_mock_new_1');
      expect(p.client_reference_id).toBe(userId);
      const items = p.line_items as Array<{ price: string; quantity: number }>;
      expect(items).toHaveLength(1);
      expect(items[0].price).toBe(PRICE_DIET); // server-side env mapping, never client input
      expect(items[0].quantity).toBe(1);
      const meta = p.metadata as { userId: string; planId: string };
      expect(meta.userId).toBe(userId);
      expect(meta.planId).toBe('diet');
      expect(String(p.success_url)).toContain('/billing/success');
      expect(String(p.cancel_url)).toContain('/billing/cancelled');
    } finally {
      restore();
    }

    // The created Stripe customer id is persisted on the local subscription.
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.stripeCustomerId).toBe('cus_mock_new_1');
    // ...but the plan is NOT granted by checkout creation — only the webhook grants.
    expect(sub?.planId).toBe('free');
  });

  it('401 when unauthenticated', async () => {
    stripeTestEnv();
    const res = await checkoutPOST(
      jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'diet' }),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/billing/checkout — error paths (never a fake URL)', () => {
  it('none mode -> 503 stripe_not_configured (honest, no redirect URL)', async () => {
    noneEnv();
    const email = uniqueEmail('ff-co-none');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await checkoutPOST(
      authed(
        jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'diet' }),
        token,
      ),
    );
    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body.error.code).toBe('stripe_not_configured');
    expect(body.url).toBeUndefined(); // never a fabricated checkout URL
  });

  it('stripe mode with a missing price env var -> 503, no redirect URL', async () => {
    stripeTestEnv();
    pushEnv({ STRIPE_PRICE_DIET: undefined }); // partial config
    const email = uniqueEmail('ff-co-price');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await checkoutPOST(
      authed(
        jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'diet' }),
        token,
      ),
    );
    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body.error.code).toBe('stripe_not_configured');
    expect(body.error.message).toContain('STRIPE_PRICE_DIET');
    expect(body.url).toBeUndefined();
  });

  it('free plan -> 400 plan_not_billable', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-co-free');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await checkoutPOST(
      authed(
        jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'free' }),
        token,
      ),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('plan_not_billable');
  });

  it('unknown plan -> 400 unknown_plan', async () => {
    stripeTestEnv();
    const email = uniqueEmail('ff-co-unknown');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await checkoutPOST(
      authed(
        jsonRequest('http://localhost/api/billing/checkout', 'POST', { planId: 'nope' }),
        token,
      ),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('unknown_plan');
  });
});

describe('no paid access in none mode (§8.2 combined contract)', () => {
  it('paid selection is rejected with 402 AND paid features stay gated (403)', async () => {
    noneEnv();
    const email = uniqueEmail('ff-noneflow');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);

    // 1. Plan selection: rejected.
    const sel = await subscriptionsPOST(
      authed(jsonRequest('http://localhost/api/subscriptions', 'POST', { planId: 'diet' }), token),
    );
    expect(sel.status).toBe(402);
    expect((await readJson(sel)).error.code).toBe('payment_required');

    // 2. Gating: a paid feature is denied for the still-free user.
    const gen = await mealGeneratePOST(
      authed(jsonRequest('http://localhost/api/meals/plans/generate', 'POST', {}), token),
    );
    expect(gen.status).toBe(403);
    expect((await readJson(gen)).error.code).toBe('plan_required');

    // 3. Nothing was persisted: still free.
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.planId).toBe('free');
    expect(sub?.status).toBe('active');
  });
});

describe('cancellation / downgrade cannot orphan an active Stripe subscription (§8.8)', () => {
  async function userWithActiveStripeSub(prefix: string) {
    const email = uniqueEmail(prefix);
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    // stripeSubscriptionId is @unique — one distinct id per test user.
    const stripeSubId = `sub_test_noorphan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await prisma.subscription.upsert({
      where: { userId },
      update: {
        planId: 'diet',
        status: 'active',
        provider: 'stripe',
        providerRef: stripeSubId,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_noorphan',
      },
      create: {
        userId,
        planId: 'diet',
        status: 'active',
        provider: 'stripe',
        providerRef: stripeSubId,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: 'cus_test_noorphan',
      },
    });
    return { userId, token, stripeSubId };
  }

  it('legacy POST /api/subscriptions/cancel keeps the Stripe subscription tracked', async () => {
    noneEnv();
    const { userId, token } = await userWithActiveStripeSub('ff-legacy-cancel');
    const before = await prisma.subscription.findUnique({ where: { userId } });

    const res = await legacyCancelPOST(
      authed(new NextRequest('http://localhost/api/subscriptions/cancel', { method: 'POST' }), token),
    );
    const after = await prisma.subscription.findUnique({ where: { userId } });

    if (res.status >= 400) {
      // Rejected: the local row must be untouched (no silent downgrade).
      expect(after?.planId).toBe(before?.planId);
      expect(after?.stripeSubscriptionId).toBe(before?.stripeSubscriptionId);
    } else {
      // Accepted: the Stripe subscription id must still be tracked — never orphaned.
      expect(after?.stripeSubscriptionId).toBe(before?.stripeSubscriptionId);
    }
  });

  it('direct free-plan downgrade with an active Stripe sub cannot orphan it', async () => {
    noneEnv();
    const { userId, token } = await userWithActiveStripeSub('ff-free-downgrade');
    const before = await prisma.subscription.findUnique({ where: { userId } });

    const res = await subscriptionsPOST(
      authed(jsonRequest('http://localhost/api/subscriptions', 'POST', { planId: 'free' }), token),
    );
    const after = await prisma.subscription.findUnique({ where: { userId } });

    if (res.status >= 400) {
      // Rejected: the local row must be untouched.
      expect(after?.planId).toBe(before?.planId);
      expect(after?.stripeSubscriptionId).toBe(before?.stripeSubscriptionId);
    } else {
      // Accepted: the active Stripe subscription must remain tracked.
      expect(after?.stripeSubscriptionId).toBe(before?.stripeSubscriptionId);
    }
  });
});
