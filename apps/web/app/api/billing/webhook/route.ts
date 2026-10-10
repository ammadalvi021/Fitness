import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@fitfusion/db';
import { getPlan } from '../../../../../../config/plans';
import type { PlanId } from '../../../../../../config/plans';
import {
  billingProvider,
  getStripe,
  isEligibleSubscriptionStatus,
  planIdForPriceId,
  subscriptionGrantsPaidAccess,
} from '@/lib/billing';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook receiver. UNAUTHENTICATED — authenticity comes solely from
 * the Stripe signature header verified against STRIPE_WEBHOOK_SECRET.
 *
 * Safety properties:
 * - The RAW body (`await req.text()`) is verified BEFORE any parsing.
 * - A valid HMAC signature is MANDATORY on every call: invalid/missing
 *   signature -> 400, nothing is processed. There is no test-mode skip and
 *   no bypass path. When `BILLING_PROVIDER` is not `stripe` (e.g. `none`),
 *   events are never processed (503) — fake events cannot activate plans.
 * - Idempotent: every Stripe event id is claimed in `StripeWebhookEvent`
 *   before handling; duplicates, retries, delayed and out-of-order
 *   deliveries are skipped. A crash between claim and completion releases
 *   the claim so Stripe's retry redelivers.
 * - Paid entitlement is granted ONLY here — never by frontend claims.
 *
 * PRICE-MISMATCH POLICY (V3) — "fail closed on access, hold safe on state,
 * never upgrade on unverified data." ONE policy, applied by every handler:
 *  1. The ONLY trusted price→plan mapping is the server-side env-configured
 *     one (`STRIPE_PRICE_ENV` via `planIdForPriceId`). Client input and
 *     Stripe metadata never define it.
 *  2. An unknown or mismatched Stripe Price ID NEVER grants paid
 *     entitlement: it never writes a planId of higher rank than currently
 *     stored — no activation, no upgrade.
 *  3. It also never silently downgrades an already-tracked subscription: on
 *     `invoice.payment_succeeded` / `customer.subscription.updated` for a
 *     subscription whose Stripe status is `active`/`trialing`/`past_due`,
 *     the stored planId is HELD (logged with event ID + price ID). A
 *     non-eligible status (`canceled`, `incomplete_expired`, `unpaid`, …)
 *     still revokes access — status is a Stripe fact, independent of the
 *     price mapping.
 *  4. `checkout.session.completed` binds a NEW subscription (no prior
 *     verified state for it), so an unknown/mismatched price there records
 *     the binding with planId `free` — no entitlement. If the account
 *     already holds a verified paid entitlement on a DIFFERENT
 *     subscription, the anomalous checkout does not touch it (logged,
 *     ACKed).
 *  5. On every mismatch: all Stripe identifiers (`stripeCustomerId`,
 *     `stripeSubscriptionId`) are PRESERVED, and the raw price ID + event
 *     ID are logged server-side for reconciliation/support. Mismatches are
 *     ACKed (200) so Stripe does not retry pointlessly.
 *
 * STATUS ALLOWLIST: a paid planId is written ONLY when the Stripe
 * subscription status is `active` or `trialing`. In particular the webhook
 * does NOT activate on `checkout.session.completed` alone while the
 * subscription is `incomplete` — it records the Stripe binding with planId
 * `free` and waits for the async `invoice.payment_succeeded` event.
 *
 * PAST-DUE GRACE POLICY (finite, enforced): `invoice.payment_failed` marks
 * the subscription `past_due` but KEEPS the paid planId, starting the arrears
 * clock (`pastDueSince`). Access continues for PAST_DUE_GRACE_DAYS
 * (default 7, configurable) from that first failure; later failures do not
 * reset the clock. After the window expires the subscription is downgraded
 * to free. Enforcement happens on every subsequent webhook event for the
 * user (`enforcePastDueGrace`) and via `scripts/enforce-past-due-grace.ts`
 * (intended for a cron); see `subscriptionGrantsPaidAccess` in lib/billing
 * for the access-time decision.
 *
 * SUBSCRIPTION MATCHING (exact-match, V3): when an event carries a
 * subscription ID, the local row is located by EXACT match on the stored
 * `stripeSubscriptionId` — an unknown subscription ID NEVER falls back to a
 * customer-ID match (that fallback previously let events for an OLD,
 * CANCELED, or otherwise untracked subscription of the same Stripe customer
 * resolve to — and overwrite — the user's CURRENT row). An event whose
 * subscription ID matches nothing is non-entitling: the event ID is logged
 * server-side, the webhook is ACKed (200) so Stripe does not retry
 * pointlessly (a retry cannot change the outcome — we still would not track
 * that subscription), and nothing is changed. Customer-ID matching is used
 * ONLY when the event carries no subscription ID at all, and is logged as
 * ambiguous whenever it resolves.
 *
 * USER BINDING: `checkout.session.completed` validates that
 * `client_reference_id`/`metadata.userId` refers to a REAL user row, that
 * the two binding sources agree when both are present, and — the decisive
 * check — that the completed session's id equals the `stripeCheckoutSessionId`
 * this server stored on the user's row when POST /api/billing/checkout
 * created the session (V3, P2-3). Without that server-side mapping there is
 * no binding and no entitlement. The Stripe subscription is then retrieved
 * server-side and its price must map (via the env mapping) to the checkout
 * plan. All other event types locate the local row via the exact-match
 * lookup above, never via metadata.
 *
 * Dashboard setup: register `{APP_URL}/api/billing/webhook` as the endpoint
 * URL in the Stripe dashboard (test mode) and subscribe it to:
 * checkout.session.completed, invoice.payment_succeeded,
 * invoice.payment_failed, customer.subscription.updated,
 * customer.subscription.deleted.
 */

function unixToDate(secs: number | null | undefined): Date | null {
  return typeof secs === 'number' ? new Date(secs * 1000) : null;
}

/**
 * Stripe API (v23): the subscription-level `current_period_end` moved to the
 * subscription item. Single-price subscriptions have exactly one item.
 */
function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  return unixToDate(sub.items?.data?.[0]?.current_period_end);
}

/** Stripe API (v23): invoice -> subscription id via `parent.subscription_details`. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const s = invoice.parent?.subscription_details?.subscription;
  if (!s) return null;
  return typeof s === 'string' ? s : s.id;
}

function stripeStatusToLocal(status: Stripe.Subscription.Status): string {
  if (status === 'trialing' || status === 'active') return 'active';
  if (status === 'past_due') return 'past_due';
  return status; // 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused' | 'canceled'
}

/**
 * Map a Stripe subscription's first-item price to a paid plan using ONLY the
 * env-configured price IDs. Returns null when the price is unknown — unknown
 * prices NEVER map to a plan (fail-closed; see the PRICE-MISMATCH POLICY in
 * the header).
 */
function mappedPlanId(sub: Stripe.Subscription): PlanId | null {
  const priceId = sub.items.data[0]?.price?.id;
  return priceId ? planIdForPriceId(priceId) : null;
}

/**
 * Decide the planId to persist from a Stripe subscription.
 *
 * Implements the PRICE-MISMATCH POLICY (V3) "fail closed on access, hold
 * safe on state, never upgrade on unverified data":
 * - Status `active`/`trialing` (eligible) or `past_due`: the env-mapped
 *   price wins; an UNKNOWN price HOLDS `holdPlanId` — it never upgrades
 *   and never downgrades on data we cannot verify.
 * - Any other status: no paid access -> 'free' (status is a Stripe fact,
 *   independent of the price mapping).
 */
function resolvePlanId(
  sub: Stripe.Subscription,
  holdPlanId: string,
): { planId: string; mapped: PlanId | null } {
  const mapped = mappedPlanId(sub);
  if (isEligibleSubscriptionStatus(sub.status) || sub.status === 'past_due') {
    return { planId: mapped ?? holdPlanId, mapped };
  }
  return { planId: 'free', mapped };
}

async function upsertFromStripeSubscription(
  sub: Stripe.Subscription,
  userId: string,
  planId: string,
) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const status = stripeStatusToLocal(sub.status);
  const plan = planId === 'free' ? getPlan('free') : getPlan(planId as PlanId);
  const data = {
    planId,
    status,
    billingPeriod: plan.billingPeriod,
    provider: 'stripe',
    providerRef: sub.id,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    // Leaving arrears clears the clock; entering keeps whatever is set
    // (callers set it explicitly on first failure).
    pastDueSince: status === 'past_due' ? undefined : null,
    // The checkout-session mapping has served its purpose once the webhook
    // binds the subscription — clear it so a stale session id can never
    // re-bind later (V3, P2-3).
    stripeCheckoutSessionId: null,
    stripeCheckoutSessionUrl: null,
  };
  return prisma.subscription.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

/**
 * Downgrade a user to the free plan.
 *
 * IDENTIFIER SAFETY (V3, P3-2): `stripeCustomerId` is NEVER cleared here —
 * it is needed for support reconciliation. `stripeSubscriptionId` is cleared
 * only when the subscription is dead at Stripe (canceled / deleted /
 * incomplete_expired). When the subscription may still be alive (past_due
 * grace expiry — Stripe can still collect), callers pass
 * `preserveStripeSubscriptionId: true` so future events for that
 * subscription still reconcile (e.g. a later successful payment
 * re-activates) and the app's own cancel path keeps working.
 */
async function downgradeToFree(
  userId: string,
  reason: string,
  opts: { preserveStripeSubscriptionId?: boolean } = {},
) {
  console.log(`[billing webhook] downgrading user ${userId} to free (${reason})`);
  return prisma.subscription.upsert({
    where: { userId },
    update: {
      planId: 'free',
      status: 'active',
      billingPeriod: 'free',
      provider: 'stripe',
      providerRef: null,
      stripeSubscriptionId: opts.preserveStripeSubscriptionId ? undefined : null,
      currentPeriodEnd: null,
      pastDueSince: null,
    },
    create: { userId, planId: 'free', status: 'active', provider: 'stripe' },
  });
}

type SubscriptionRow = Awaited<
  ReturnType<typeof prisma.subscription.findFirst>
>;

type LocalLookup =
  /** The event's subscription ID matched the stored one exactly. */
  | { kind: 'match'; row: SubscriptionRow }
  /** The event carried a subscription ID we do not track. Non-entitling. */
  | { kind: 'unknown-subscription'; row: null }
  /**
   * The event carried NO subscription ID; matched by customer ID only.
   * Logged as ambiguous whenever it resolves — never used silently.
   */
  | { kind: 'customer-fallback'; row: SubscriptionRow }
  | { kind: 'no-ids'; row: null };

/**
 * Locate the local subscription for a Stripe subscription/customer id.
 *
 * EXACT-MATCH (V3, P2-1/P2-2): when the event carries a subscription ID, the
 * row must match `stripeSubscriptionId` EXACTLY. An unknown subscription ID
 * NEVER falls back to matching by Stripe customer ID — that fallback let an
 * OLD, CANCELED, or otherwise untracked subscription (same customer)
 * resolve to the user's CURRENT row and overwrite it. Customer-ID matching
 * is used ONLY when the event carries no subscription ID at all, and is
 * logged as ambiguous whenever it resolves.
 */
async function findLocal(
  subscriptionId: string | null,
  customerId: string | null,
): Promise<LocalLookup> {
  if (subscriptionId) {
    const bySub = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (bySub) return { kind: 'match', row: bySub };
    return { kind: 'unknown-subscription', row: null };
  }
  if (customerId) {
    const byCust = await prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (byCust) {
      console.warn(
        '[billing webhook] resolved row by customer ID only — no subscription ID in event (ambiguous)',
        { customerId, localUserId: byCust.userId },
      );
    }
    return { kind: 'customer-fallback', row: byCust };
  }
  return { kind: 'no-ids', row: null };
}

/**
 * Shared non-entitling outcome for events we cannot attribute to a tracked
 * subscription (unknown subscription ID, missing server-side session
 * mapping, unverifiable price on an already-entitled account, …).
 *
 * Logs the event ID server-side (never to the client) and returns null so
 * the caller ACKs 200: retrying cannot change the outcome — we still would
 * not track that subscription — so a 200 stops Stripe retrying pointlessly
 * instead of burning retries / paging on-call.
 */
function logUnmatchedEvent(
  event: Stripe.Event,
  reason: string,
  detail: Record<string, unknown>,
): null {
  console.warn(`[billing webhook] ${reason} — ACKed, no state change`, {
    eventId: event.id,
    type: event.type,
    ...detail,
  });
  return null;
}

/**
 * Revoke access when a past_due subscription's finite grace window has
 * expired. Called on every subsequent webhook event for the user (plus the
 * standalone sweeper script for time-based cutoff).
 */
async function enforcePastDueGrace(userId: string): Promise<void> {
  const local = await prisma.subscription.findUnique({ where: { userId } });
  if (!local || local.status !== 'past_due' || local.planId === 'free') return;
  if (!subscriptionGrantsPaidAccess(local)) {
    // Preserve the subscription id: the Stripe subscription is past_due,
    // not dead — it can still be paid or canceled, and future events for
    // it must still reconcile (V3, P3-2).
    await downgradeToFree(userId, 'past_due grace window expired', {
      preserveStripeSubscriptionId: true,
    });
  }
}

/**
 * Handle one verified Stripe event. Returns the affected local userId
 * (or null) so the caller can run grace enforcement afterwards.
 */
async function handleEvent(stripe: Stripe, event: Stripe.Event): Promise<string | null> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId =
        session.client_reference_id || session.metadata?.userId || null;
      const metaPlanId = session.metadata?.planId || null;
      if (!userId || !metaPlanId) {
        console.warn('[billing webhook] checkout.session.completed missing userId/planId metadata', {
          eventId: event.id,
        });
        return null;
      }
      // The two server-set binding sources must agree when both present.
      if (
        session.client_reference_id &&
        session.metadata?.userId &&
        session.client_reference_id !== session.metadata.userId
      ) {
        console.warn('[billing webhook] checkout user binding mismatch — no entitlement', {
          eventId: event.id,
        });
        return null;
      }
      let metaPlan;
      try {
        metaPlan = getPlan(metaPlanId as PlanId);
      } catch {
        console.warn('[billing webhook] unknown planId in metadata', { eventId: event.id, metaPlanId });
        return null;
      }
      if (metaPlan.id === 'free' || !metaPlan.available) {
        console.warn('[billing webhook] non-billable plan in checkout metadata', {
          eventId: event.id,
          metaPlanId,
        });
        return null;
      }
      // The event's user binding must match a REAL user — never grant
      // entitlements from metadata alone.
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        console.warn('[billing webhook] checkout for unknown user — no entitlement', {
          eventId: event.id,
          userId,
        });
        return null;
      }
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
      if (!subscriptionId) {
        console.warn('[billing webhook] checkout.session.completed without subscription', {
          eventId: event.id,
        });
        return null;
      }
      // V3, P2-3: the completed session must be one THIS server created for
      // this user — verified against the server-side mapping stored at
      // checkout creation (`stripeCheckoutSessionId`). Session metadata
      // alone is never trusted.
      const local = await prisma.subscription.findUnique({ where: { userId } });
      if (!local || local.stripeCheckoutSessionId !== session.id) {
        return logUnmatchedEvent(
          event,
          'checkout without server-side session mapping — no binding, no entitlement',
          {
            sessionId: session.id,
            userId,
            storedSessionId: local?.stripeCheckoutSessionId ?? null,
          },
        );
      }
      // Server-side retrieval: the subscription (and its price) is trusted,
      // the metadata planId is only a cross-check.
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const mapped = mappedPlanId(sub);
      const priceId = sub.items.data[0]?.price?.id ?? null;

      // V3, P3: an anomalous checkout (unknown price, price/plan mismatch,
      // or not-yet-payable subscription) must never destroy a VERIFIED paid
      // entitlement the account already holds on a DIFFERENT subscription.
      // Fail closed: keep the current row untouched, log, ACK.
      const verifiedEntitlement =
        mapped !== null &&
        mapped === metaPlan.id &&
        isEligibleSubscriptionStatus(sub.status);
      const holdsVerifiedPaidAccess =
        local.planId !== 'free' &&
        local.stripeSubscriptionId !== null &&
        local.stripeSubscriptionId !== sub.id &&
        subscriptionGrantsPaidAccess({
          planId: local.planId,
          status: local.status,
          pastDueSince: local.pastDueSince,
        });
      if (!verifiedEntitlement && holdsVerifiedPaidAccess) {
        return logUnmatchedEvent(
          event,
          'anomalous checkout would clobber verified paid subscription — keeping current row',
          {
            sessionId: session.id,
            userId,
            subscriptionId: sub.id,
            priceId,
            mappedPlan: mapped,
            metadataPlan: metaPlan.id,
            stripeStatus: sub.status,
            currentSubscriptionId: local.stripeSubscriptionId,
            currentPlanId: local.planId,
          },
        );
      }

      if (!mapped) {
        // Unknown price -> NO entitlement (PRICE-MISMATCH POLICY rule 4).
        // Record the Stripe binding with planId 'free' — identifiers
        // (stripeCustomerId/stripeSubscriptionId) are preserved for
        // support/reconciliation — and ACK (200) so Stripe does not retry
        // pointlessly.
        console.warn('[billing webhook] subscription price not in env mapping — no entitlement', {
          eventId: event.id,
          subscriptionId,
          priceId,
        });
        await upsertFromStripeSubscription(sub, userId, 'free');
        return userId;
      }
      if (mapped !== metaPlan.id) {
        // Price/plan mismatch between Stripe and the checkout metadata ->
        // the price's mapping governs (metadata never upgrades): hold safe
        // with planId 'free', identifiers preserved, no entitlement.
        console.warn('[billing webhook] price/plan mismatch — no entitlement', {
          eventId: event.id,
          subscriptionId,
          priceId,
          mappedPlan: mapped,
          metadataPlan: metaPlan.id,
        });
        await upsertFromStripeSubscription(sub, userId, 'free');
        return userId;
      }
      if (!isEligibleSubscriptionStatus(sub.status)) {
        // e.g. `incomplete` (payment still pending, incl. delayed methods):
        // record the Stripe binding but keep planId 'free' — activation waits
        // for the async invoice.payment_succeeded event.
        console.log('[billing webhook] checkout subscription not yet payable — holding activation', {
          eventId: event.id,
          subscriptionId,
          status: sub.status,
        });
        await upsertFromStripeSubscription(sub, userId, 'free');
        return userId;
      }
      await upsertFromStripeSubscription(sub, userId, mapped);
      console.log('[billing webhook] activated paid plan', { userId, planId: mapped });
      return userId;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) return null; // not a subscription invoice — nothing to sync
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const lookup = await findLocal(subscriptionId, customerId);
      if (lookup.kind !== 'match' || !lookup.row) {
        return logUnmatchedEvent(
          event,
          `invoice.payment_succeeded for untracked subscription (lookup: ${lookup.kind})`,
          { subscriptionId, customerId },
        );
      }
      const local = lookup.row;
      const { planId, mapped } = resolvePlanId(sub, local.planId);
      if (!mapped && (isEligibleSubscriptionStatus(sub.status) || sub.status === 'past_due')) {
        console.warn('[billing webhook] payment_succeeded with unknown price — holding current plan', {
          eventId: event.id,
          subscriptionId,
          priceId: sub.items.data[0]?.price?.id ?? null,
        });
      }
      await prisma.subscription.update({
        where: { userId: local.userId },
        data: {
          planId,
          status: stripeStatusToLocal(sub.status),
          billingPeriod: planId === 'free' ? 'free' : getPlan(planId as PlanId).billingPeriod,
          currentPeriodEnd: subscriptionPeriodEnd(sub),
          // Recovery from arrears clears the grace clock.
          pastDueSince: null,
        },
      });
      return local.userId;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) return null;
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
      const lookup = await findLocal(subscriptionId, customerId);
      if (lookup.kind !== 'match' || !lookup.row) {
        return logUnmatchedEvent(
          event,
          `invoice.payment_failed for untracked subscription (lookup: ${lookup.kind})`,
          { subscriptionId, customerId },
        );
      }
      const local = lookup.row;
      // Grace: keep the paid planId (access continues inside the finite
      // window); the arrears clock starts on the FIRST failure and is NOT
      // reset by later failures.
      await prisma.subscription.update({
        where: { userId: local.userId },
        data: {
          status: 'past_due',
          ...(local.pastDueSince ? {} : { pastDueSince: new Date() }),
        },
      });
      console.log('[billing webhook] payment failed -> past_due (finite grace, plan kept)', {
        userId: local.userId,
      });
      return local.userId;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const lookup = await findLocal(sub.id, customerId);
      if (lookup.kind !== 'match' || !lookup.row) {
        return logUnmatchedEvent(
          event,
          `subscription.updated for untracked subscription (lookup: ${lookup.kind})`,
          { subscriptionId: sub.id, customerId },
        );
      }
      const local = lookup.row;
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        await downgradeToFree(local.userId, `subscription ${sub.status}`);
        return local.userId;
      }
      const { planId, mapped } = resolvePlanId(sub, local.planId);
      if (!mapped && (isEligibleSubscriptionStatus(sub.status) || sub.status === 'past_due')) {
        console.warn('[billing webhook] subscription.updated with unknown price — holding current plan', {
          eventId: event.id,
          subscriptionId: sub.id,
          priceId: sub.items.data[0]?.price?.id ?? null,
        });
      }
      if (sub.cancel_at_period_end && isEligibleSubscriptionStatus(sub.status)) {
        console.log('[billing webhook] cancel scheduled at period end — access kept until then', {
          userId: local.userId,
          subscriptionId: sub.id,
        });
      }
      const status = stripeStatusToLocal(sub.status);
      await prisma.subscription.update({
        where: { userId: local.userId },
        data: {
          planId,
          status,
          billingPeriod: planId === 'free' ? 'free' : getPlan(planId as PlanId).billingPeriod,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: subscriptionPeriodEnd(sub),
          pastDueSince: status === 'past_due' ? (local.pastDueSince ?? new Date()) : null,
        },
      });
      return local.userId;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const lookup = await findLocal(sub.id, customerId);
      if (lookup.kind !== 'match' || !lookup.row) {
        return logUnmatchedEvent(
          event,
          `subscription.deleted for untracked subscription (lookup: ${lookup.kind})`,
          { subscriptionId: sub.id, customerId },
        );
      }
      const local = lookup.row;
      await downgradeToFree(local.userId, 'subscription deleted');
      return local.userId;
    }

    default:
      // Unhandled event type — acknowledge so Stripe stops retrying.
      console.log('[billing webhook] ignoring event type', event.type);
      return null;
  }
}

export async function POST(req: NextRequest) {
  // 1. Read the RAW body — never req.json() before verification.
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  // A valid HMAC signature is MANDATORY on every call. No bypass paths, no
  // test-mode skip: without it nothing is processed.
  if (!sig || !webhookSecret) {
    return apiError('invalid_signature', 'Missing Stripe signature', 400);
  }

  // 2. Verify the signature (local HMAC — needs no API key).
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch {
    return apiError('invalid_signature', 'Invalid Stripe webhook signature', 400);
  }

  // 3. The webhook only ever processes events when BILLING_PROVIDER=stripe.
  //    In `none` (or `sandbox`) mode fake events are never processed.
  if (billingProvider() !== 'stripe') {
    console.warn('[billing webhook] event received while billing provider is not stripe — ignored', {
      eventId: event.id,
      provider: billingProvider(),
    });
    return apiError('billing_provider_not_stripe', 'Webhook only processes events when BILLING_PROVIDER=stripe', 503);
  }

  // 4. Full Stripe config is required to process events; otherwise 503 so
  //    Stripe retries the delivery instead of silently dropping it.
  const stripe = getStripe();
  if (!stripe) {
    console.error('[billing webhook] received event but Stripe is not fully configured');
    return apiError('stripe_not_configured', 'Stripe billing is not fully configured', 503);
  }

  // 5. Idempotency: claim the event id before handling.
  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: { eventId: event.id },
  });
  if (existing?.processedAt) {
    return apiOk({ received: true, deduped: true });
  }
  if (!existing) {
    try {
      await prisma.stripeWebhookEvent.create({
        data: { eventId: event.id, type: event.type },
      });
    } catch (e: unknown) {
      // Lost a race with a concurrent delivery of the same event.
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code: string }).code === 'P2002'
      ) {
        return apiOk({ received: true, deduped: true });
      }
      throw e;
    }
  }
  // (existing && !processedAt) => a previous attempt crashed mid-handling;
  // reprocess it now.

  try {
    const userId = await handleEvent(stripe, event);
    if (userId) await enforcePastDueGrace(userId);
    await prisma.stripeWebhookEvent.update({
      where: { eventId: event.id },
      data: { processedAt: new Date() },
    });
  } catch (e) {
    // Release the claim so Stripe's retry redelivers the event.
    await prisma.stripeWebhookEvent.delete({ where: { eventId: event.id } }).catch(() => {});
    console.error('[billing webhook] handler failed, claim released', {
      eventId: event.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return apiError('webhook_handler_failed', 'Webhook handler failed', 500);
  }

  return apiOk({ received: true });
}
