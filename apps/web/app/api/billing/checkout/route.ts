import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import {
  appUrl,
  billingStatus,
  checkExistingStripeSubscription,
  priceIdForPlan,
  requireStripe,
  BillingError,
} from '@/lib/billing';
import { getPlan } from '../../../../../../config/plans';
import type { PlanId } from '../../../../../../config/plans';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const CheckoutSchema = z.object({
  planId: z.string().min(1),
  /**
   * Optional client-generated idempotency key (e.g. a UUID minted per
   * "Subscribe" click). Passed through to the Stripe SDK so a retried POST
   * with the same key replays the SAME Checkout Session server-side
   * instead of creating a second subscription. See the duplicate-
   * subscription guard in lib/billing.ts.
   */
  idempotencyKey: z.string().min(1).max(128).optional(),
});

/**
 * In-process guard against concurrent duplicate POSTs for the same user
 * (rapid double-clicks): the second concurrent request awaits the first's
 * result and returns it instead of creating a second session. Sequential
 * retries are handled separately via the persisted pending session
 * (`stripeCheckoutSessionId`) below. The shared promise resolves to the
 * response DATA; each caller builds its own NextResponse.
 */
const inFlightCheckouts = new Map<string, Promise<{ url: string; reused?: boolean }>>();

/**
 * Create a Stripe Checkout Session for a paid plan.
 *
 * Contract: `{ planId, idempotencyKey? }` -> `{ url }` (302-style redirect target).
 * - Authenticated only. Accepts ONLY `planId`; the Price ID is resolved
 *   server-side from the env mapping (`STRIPE_PRICE_ENV`) — never from the
 *   client.
 * - `mode: 'subscription'`, `client_reference_id` = userId,
 *   `metadata` = { userId, planId }.
 * - 400 on unknown/unavailable/free plan; 503 when Stripe is not configured
 *   (fail closed — zero SDK calls, no checkout).
 *
 * The created session's id + url are persisted on the local subscription row
 * (`stripeCheckoutSessionId` / `stripeCheckoutSessionUrl`) for pending-session
 * reuse. The webhook binds a user to a subscription ONLY when the completed
 * session's id matches this server-stored value (V3, P2-3) — session metadata
 * alone is never trusted.
 *
 * DUPLICATE-SUBSCRIPTION SAFETY (see `checkExistingStripeSubscription` in
 * lib/billing.ts for the full policy):
 * 1. The user's existing Stripe subscription, if any, is verified against
 *    the Stripe API (never trusted from the local row alone). A billable
 *    subscription (active/trialing/past_due, or incomplete/paused) is
 *    answered with 409 `existing_subscription_conflict` — a second
 *    subscription is NEVER created silently. The error directs the user to
 *    manage/cancel the existing subscription first
 *    (POST /api/billing/cancel schedules end-of-period cancellation; the
 *    verified webhook then frees the account for a fresh checkout).
 * 2. Terminal remote states (canceled / incomplete_expired / unpaid) and
 *    stale linkages are synced locally (plan -> free, linkage cleared) and
 *    the request proceeds — a canceled local subscription is deliberately
 *    resumable with a fresh checkout.
 * 3. A stored pending session (`stripeCheckoutSessionId`) that is still
 *    `open` at Stripe is reused: the second of two sequential checkout
 *    clicks returns the SAME session URL instead of creating a second
 *    session (whose payment would create a second subscription).
 * 4. A client-supplied `idempotencyKey` is passed to the Stripe SDK, so
 *    retried POSTs with the same key replay one session at Stripe.
 * 5. Concurrent POSTs for the same user are collapsed by the in-flight map.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = CheckoutSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }

  let plan;
  try {
    plan = getPlan(parsed.data.planId as PlanId);
  } catch {
    return apiError('unknown_plan', `Unknown plan id: ${parsed.data.planId}`, 400);
  }
  if (!plan.available) {
    return apiError('plan_unavailable', 'This plan is not currently available', 400);
  }
  if (plan.id === 'free') {
    return apiError(
      'plan_not_billable',
      'The free plan needs no checkout — select it via POST /api/subscriptions.',
      400,
    );
  }

  let stripe;
  try {
    stripe = requireStripe();
  } catch (e) {
    if (e instanceof BillingError) return apiError(e.code, e.message, e.status);
    throw e;
  }

  // TRUSTED price id: from the server-side env mapping, never client input.
  const priceId = priceIdForPlan(plan.id);
  if (!priceId) {
    return apiError(
      'stripe_price_missing',
      `No Stripe Price ID configured for plan "${plan.id}".`,
      503,
      `Set ${billingStatus().missing.join(', ') || 'the plan price env var'}.`,
    );
  }

  // DUPLICATE-SUBSCRIPTION GUARD: verify any existing Stripe subscription
  // against the Stripe API before creating a session. 409 blocks; terminal
  // remote states are synced locally and the request proceeds.
  let existing;
  try {
    existing = await checkExistingStripeSubscription(stripe, s.user.id);
  } catch (e) {
    if (e instanceof BillingError) return apiError(e.code, e.message, e.status);
    throw e;
  }
  if (existing.outcome === 'blocked') {
    return apiError(
      'existing_subscription_conflict',
      `This account already has a Stripe subscription (${existing.stripeSubscriptionId}, status: ${existing.remoteStatus}). ` +
        'A second subscription cannot be created. Manage or cancel the existing subscription first — ' +
        'POST /api/billing/cancel schedules cancellation at the end of the current billing period — ' +
        'then start checkout again.',
      409,
      `subscription_id=${existing.stripeSubscriptionId}; status=${existing.remoteStatus}`,
    );
  }

  // Collapse concurrent POSTs for the same user (rapid double-clicks): the
  // second request awaits and returns the first's result.
  const inFlight = inFlightCheckouts.get(s.user.id);
  if (inFlight) return apiOk(await inFlight);

  const userId = s.user.id;
  const email = s.user.email;
  const name = s.user.name;
  const planId = plan.id;
  const idempotencyKey = parsed.data.idempotencyKey;

  const run = (async (): Promise<{ url: string; reused?: boolean }> => {
    // Create or reuse a Stripe Customer, persisted on the local subscription.
    let customerId: string | null = null;
    const local = await prisma.subscription.findUnique({ where: { userId } });
    if (local?.stripeCustomerId) {
      try {
        const existingCustomer = await stripe.customers.retrieve(local.stripeCustomerId);
        if (!existingCustomer.deleted) customerId = existingCustomer.id;
      } catch {
        customerId = null; // stale id — create a fresh customer below
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: name ?? undefined,
        metadata: { userId },
      });
      customerId = customer.id;
      await prisma.subscription.upsert({
        where: { userId },
        update: { stripeCustomerId: customerId },
        create: {
          userId,
          planId: 'free',
          status: 'active',
          stripeCustomerId: customerId,
        },
      });
    }

    // Pending-session reuse: a sequential retry/double-click must resolve to
    // the SAME Checkout Session while it is still open — never a second one.
    const afterCustomer = await prisma.subscription.findUnique({ where: { userId } });
    const pendingSessionId = afterCustomer?.stripeCheckoutSessionId ?? null;
    if (pendingSessionId) {
      try {
        const pending = await stripe.checkout.sessions.retrieve(pendingSessionId);
        if (pending.status === 'open' && pending.url) {
          return { url: pending.url, reused: true };
        }
      } catch {
        // Session gone at Stripe (expired/deleted) — fall through and create.
      }
    }

    const base = appUrl();
    const requestOptions = idempotencyKey ? { idempotencyKey } : undefined;
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { userId, planId },
        success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/billing/cancelled`,
      },
      requestOptions,
    );

    // Remember the pending session so a retried POST reuses it.
    await prisma.subscription.upsert({
      where: { userId },
      update: {
        stripeCheckoutSessionId: session.id,
        stripeCheckoutSessionUrl: session.url ?? null,
      },
      create: {
        userId,
        planId: 'free',
        status: 'active',
        stripeCheckoutSessionId: session.id,
        stripeCheckoutSessionUrl: session.url ?? null,
      },
    });

    return { url: session.url as string };
  })();

  inFlightCheckouts.set(userId, run);
  try {
    return apiOk(await run);
  } finally {
    inFlightCheckouts.delete(userId);
  }
}
