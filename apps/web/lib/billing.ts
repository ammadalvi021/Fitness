/**
 * Billing / plan-selection helpers.
 *
 * SECURITY MODEL (hardened):
 * - A paid plan can NEVER be activated by a frontend claim or a manual
 *   `selectPlan()` call. In `none` and `stripe` modes, selecting a paid
 *   planId is REJECTED with `payment_required` (HTTP 402).
 * - In `sandbox` mode a paid selection records a clearly-labeled TEST-ONLY
 *   upgrade (`testMode: true`, `charged: false`, "no real charge").
 * - In `stripe` mode, paid entitlement is granted EXCLUSIVELY by the
 *   signature-verified Stripe webhook (`POST /api/billing/webhook`).
 * - Downgrading to `free` is always allowed, anytime, in every mode.
 * - `BILLING_PROVIDER=none|sandbox|stripe` (default `none`).
 */
import Stripe from 'stripe';
import { prisma } from '@fitfusion/db';
import { getPlan, STRIPE_PRICE_ENV } from '../../../config/plans';
import type { PlanId } from '../../../config/plans';

export type BillingProvider = 'none' | 'sandbox' | 'stripe';

// ---------------------------------------------------------------------------
// Webhook entitlement gating (used by POST /api/billing/webhook).
//
// STATUS ALLOWLIST: a paid planId may be written/granted ONLY when the Stripe
// subscription status is `active` or `trialing`. `incomplete`,
// `incomplete_expired`, `unpaid`, `canceled` (and any unknown future status)
// NEVER grant paid access — in particular the webhook must NOT activate on
// `checkout.session.completed` alone while the subscription is `incomplete`;
// it waits for the async `invoice.payment_succeeded` event.
//
// PAST-DUE GRACE POLICY (finite): `invoice.payment_failed` moves the local
// subscription to `past_due` but KEEPS the paid planId, so access continues
// for PAST_DUE_GRACE_DAYS (env, default 7) counted from `pastDueSince`
// (the first failure timestamp; the clock is NOT reset by later failures).
// After the grace window expires, access is revoked (downgrade to free).
// Revocation is enforced (a) on every subsequent webhook event for the user
// and (b) by the `scripts/enforce-past-due-grace.ts` sweeper (run it on a
// cron). Access-time enforcement point: `requirePlan` in lib/auth.ts must
// additionally consult `subscriptionGrantsPaidAccess()` — see the precise
// one-line change documented in the webhook hardener's report / HANDOVER.
// ---------------------------------------------------------------------------

/** Stripe subscription statuses that may hold a PAID planId. */
export const ELIGIBLE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;

/** True only for statuses on the paid-entitlement allowlist. */
export function isEligibleSubscriptionStatus(status: string): boolean {
  return (ELIGIBLE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Finite past-due grace window, in whole days.
 * Env `PAST_DUE_GRACE_DAYS`; documented default 7. Non-numeric or negative
 * values fall back to the default (fail-safe, never infinite, never NaN).
 */
export function pastDueGraceDays(): number {
  const raw = Number(process.env.PAST_DUE_GRACE_DAYS);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return 7;
}

/** Minimal shape of a Subscription row needed for the access decision. */
export interface SubscriptionAccessState {
  planId: string;
  status: string;
  pastDueSince: Date | null;
}

/**
 * Whether a subscription row still grants paid access.
 * - planId 'free' -> false (nothing to grant)
 * - status on the allowlist (active|trialing) -> true
 * - status 'past_due' -> true ONLY within PAST_DUE_GRACE_DAYS of pastDueSince;
 *   a past_due row with NO pastDueSince is treated as expired (fail-closed)
 * - every other status -> false
 */
export function subscriptionGrantsPaidAccess(sub: SubscriptionAccessState): boolean {
  if (sub.planId === 'free') return false;
  if (isEligibleSubscriptionStatus(sub.status)) return true;
  if (sub.status === 'past_due') {
    if (!sub.pastDueSince) return false;
    const graceMs = pastDueGraceDays() * 24 * 60 * 60 * 1000;
    return Date.now() - sub.pastDueSince.getTime() <= graceMs;
  }
  return false;
}

export interface BillingStatus {
  provider: BillingProvider;
  /** In `stripe` mode: true ONLY when every Stripe credential is present. */
  configured: boolean;
  /** Names of the env vars still missing when configured === false. */
  missing: string[];
}

/** Error thrown by billing helpers; carries a machine-readable `code`. */
export class BillingError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.status = status;
  }
}

export function billingProvider(): BillingProvider {
  const raw = (process.env.BILLING_PROVIDER || 'none').toLowerCase().trim();
  return raw === 'stripe' || raw === 'sandbox' ? raw : 'none';
}

/** Env var names required for `stripe` mode to count as configured. */
export function requiredStripeEnv(): string[] {
  return [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    ...Object.values(STRIPE_PRICE_ENV),
  ];
}

export function billingStatus(): BillingStatus {
  const provider = billingProvider();
  if (provider !== 'stripe') {
    return { provider, configured: provider === 'sandbox', missing: [] };
  }
  // An API key alone is NOT enough — every credential + price ID is required.
  const missing = requiredStripeEnv().filter((k) => !process.env[k]);
  return { provider, configured: missing.length === 0, missing };
}

/** Stripe Price ID (from env) for a paid plan, or null when unset/unknown. */
export function priceIdForPlan(planId: string): string | null {
  const envName = (STRIPE_PRICE_ENV as Record<string, string>)[planId];
  if (!envName) return null;
  return process.env[envName] || null;
}

/** Reverse lookup: Stripe Price ID -> paid PlanId (for webhook sync). */
export function planIdForPriceId(priceId: string): PlanId | null {
  for (const [planId, envName] of Object.entries(STRIPE_PRICE_ENV)) {
    if (process.env[envName] && process.env[envName] === priceId) {
      return planId as PlanId;
    }
  }
  return null;
}

let stripeClient: Stripe | null = null;

/** Returns a Stripe client when fully configured, else null. */
export function getStripe(): Stripe | null {
  if (!billingStatus().configured) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY as string);
  }
  return stripeClient;
}

/** Returns a Stripe client or throws BillingError('stripe_not_configured', 503). */
export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) {
    const { missing } = billingStatus();
    throw new BillingError(
      'stripe_not_configured',
      `Stripe billing is not configured. Missing: ${missing.join(', ') || 'BILLING_PROVIDER=stripe'}.`,
      503,
    );
  }
  return stripe;
}

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// DUPLICATE-SUBSCRIPTION GUARD (used by POST /api/billing/checkout).
//
// Policy: before a Stripe Checkout Session is created, the user's EXISTING
// Stripe subscription (if any) is resolved server-side and verified against
// the STRIPE API — the local row is never trusted alone. The chosen safe
// behavior is HTTP 409 `existing_subscription_conflict` (NOT a silent
// in-place upgrade): an in-place plan change via `subscriptions.update`
// would apply proration and billing changes without an explicit user
// confirmation surface (no customer portal exists in-app), so the route
// refuses and directs the user to manage/cancel the existing subscription
// first (POST /api/billing/cancel schedules end-of-period cancellation;
// the verified webhook then frees the account for a fresh checkout).
//
// What each remote/local state means for checkout eligibility:
// - NO linked stripeSubscriptionId (incl. a local row that is merely
//   `canceled` or `free`): checkout allowed — a fresh subscription may be
//   created. A canceled local subscription is deliberately resumable.
// - remote `active` / `trialing`: BILLABLE -> 409. Never a second subscription.
// - remote `past_due`: live subscription in arrears -> 409. The customer
//   must settle via the portal or cancel; a second subscription would not
//   clear the arrears and would double the billing.
// - remote `incomplete`: payment never completed -> 409. Creating another
//   session would pile up incomplete subscriptions; the stale one must be
//   canceled first, then checkout retried.
// - remote `paused`: conservatively 409. A paused subscription still
//   exists; reactivating/updating it via the API could unpause billing
//   unexpectedly.
// - remote `incomplete_expired` / `canceled` / `unpaid`: TERMINAL -> the
//   local linkage is synced (plan -> free, linkage cleared, mirroring the
//   webhook's downgradeToFree) and checkout is allowed to create a fresh one.
// - remote lookup returns resource_missing (404): STALE linkage -> cleared
//   locally, checkout allowed.
// - remote lookup fails any other way (network/API error): FAIL CLOSED —
//   503 `stripe_lookup_failed`, no checkout. We must not create a session
//   when we cannot confirm the account has no billable subscription.
// - Stripe not configured at all (BILLING_PROVIDER=none, missing keys):
//   fail closed earlier — requireStripe() throws 503
//   `stripe_not_configured` before this check ever runs, with zero SDK calls.
// ---------------------------------------------------------------------------

/** Remote Stripe subscription statuses that BLOCK a new Checkout Session. */
export const CHECKOUT_BLOCKING_REMOTE_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'incomplete',
  'paused',
] as const;

/** Remote Stripe subscription statuses that are over: fresh checkout allowed. */
export const CHECKOUT_TERMINAL_REMOTE_STATUSES = [
  'canceled',
  'incomplete_expired',
  'unpaid',
] as const;

export interface ExistingSubscriptionCheck {
  /** 'clear' — no linked subscription, checkout may proceed. */
  outcome: 'clear' | 'blocked' | 'synced';
  /** Remote subscription id the caller must not duplicate (outcome=blocked). */
  stripeSubscriptionId?: string;
  /** Remote Stripe status observed, when known. */
  remoteStatus?: string;
  /** True when the local row was synced (terminal remote state / stale id). */
  localSynced?: boolean;
}

/**
 * Verify the user's existing Stripe subscription against the Stripe API and
 * decide checkout eligibility. `stripe` must be a configured client
 * (requireStripe() upstream — when Stripe is not configured the caller must
 * 503 first and never call this).
 *
 * On terminal remote states and stale linkages the local row is synced so
 * it can never permanently wedge the account; sync failures are never
 * fatal to the eligibility decision itself.
 */
export async function checkExistingStripeSubscription(
  stripe: Stripe,
  userId: string,
): Promise<ExistingSubscriptionCheck> {
  const local = await prisma.subscription.findUnique({ where: { userId } });
  const subId = local?.stripeSubscriptionId;
  if (!subId) return { outcome: 'clear' }; // incl. canceled local rows

  let remote: Stripe.Subscription;
  try {
    remote = await stripe.subscriptions.retrieve(subId);
  } catch (e: unknown) {
    const code =
      typeof e === 'object' && e !== null
        ? ((e as { code?: unknown }).code ?? (e as { statusCode?: unknown }).statusCode)
        : undefined;
    if (code === 'resource_missing' || code === 404) {
      // Stale linkage: the subscription no longer exists at Stripe.
      await prisma.subscription
        .update({
          where: { userId },
          data: { stripeSubscriptionId: null, providerRef: null },
        })
        .catch(() => {});
      return { outcome: 'synced', remoteStatus: 'deleted', localSynced: true };
    }
    // Anything else: we cannot confirm the account is subscription-free —
    // fail closed, no checkout.
    throw new BillingError(
      'stripe_lookup_failed',
      'Could not verify the existing subscription state with Stripe. Checkout was refused to avoid creating a duplicate subscription.',
      503,
    );
  }

  const status = remote.status;
  if (
    (CHECKOUT_TERMINAL_REMOTE_STATUSES as readonly string[]).includes(status)
  ) {
    // Terminal at Stripe: sync the local row (mirror the webhook's
    // downgradeToFree) so the account is free to start a fresh subscription.
    await prisma.subscription
      .update({
        where: { userId },
        data: {
          planId: 'free',
          status: 'active',
          billingPeriod: 'free',
          providerRef: null,
          stripeSubscriptionId: null,
          stripeCheckoutSessionId: null,
          stripeCheckoutSessionUrl: null,
          currentPeriodEnd: null,
          pastDueSince: null,
        },
      })
      .catch(() => {});
    return { outcome: 'synced', remoteStatus: status, localSynced: true };
  }

  // Everything else (active/trialing/past_due/incomplete/paused or an
  // unknown future status): block — fail closed against duplicates.
  return {
    outcome: 'blocked',
    stripeSubscriptionId: remote.id,
    remoteStatus: status,
  };
}

export interface SelectPlanResult {
  subscription: {
    id: string;
    userId: string;
    planId: string;
    status: string;
  };
  /** Always false here — charging happens only via a real provider flow. */
  charged: boolean;
  /** True only for sandbox test-mode simulated upgrades. */
  testMode: boolean;
  note: string;
}

function toResult(sub: {
  id: string;
  userId: string;
  planId: string;
  status: string;
}): SelectPlanResult['subscription'] {
  return { id: sub.id, userId: sub.userId, planId: sub.planId, status: sub.status };
}

/**
 * Record a plan selection.
 *
 * - `free`: always allowed (downgrade anytime, every mode).
 * - paid planIds (`diet`, `diet_exercise`):
 *   - `none` / `stripe` mode: REJECTED — throws
 *     BillingError('payment_required', ..., 402). In `stripe` mode paid
 *     access is granted only by the verified Stripe webhook.
 *   - `sandbox` mode: allowed as a clearly-labeled TEST-ONLY simulated
 *     upgrade (`testMode: true`, `charged: false`).
 *
 * Throws BillingError('unknown_plan' | 'plan_unavailable', 400) for bad ids.
 */
export async function selectPlan(
  userId: string,
  planId: string,
): Promise<SelectPlanResult> {
  let plan;
  try {
    plan = getPlan(planId as PlanId);
  } catch {
    throw new BillingError('unknown_plan', `Unknown plan id: ${planId}`, 400);
  }
  if (!plan.available) {
    throw new BillingError('plan_unavailable', 'This plan is not currently available', 400);
  }

  const provider = billingProvider();
  const isPaid = plan.id !== 'free';

  if (isPaid && provider !== 'sandbox') {
    throw new BillingError(
      'payment_required',
      provider === 'stripe'
        ? `The "${plan.name}" plan requires completing Stripe checkout — paid access is granted only after the payment webhook confirms it.`
        : `The "${plan.name}" plan requires completing Stripe checkout. No billing provider is configured (BILLING_PROVIDER=none), so no paid plan can be activated.`,
      402,
    );
  }

  // SAFETY (defect #12): never orphan a live Stripe subscription through a
  // local downgrade. If the account links a live-looking Stripe subscription
  // (id + paid planId + entitled status), refuse with 409 and direct to
  // provider-side cancellation; the verified webhook clears the linkage when
  // the subscription actually ends.
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  const hasLiveStripeSubscription =
    Boolean(existing?.stripeSubscriptionId) &&
    (existing?.planId ?? 'free') !== 'free' &&
    ['active', 'trialing', 'past_due'].includes(existing?.status ?? '');

  if (!isPaid && hasLiveStripeSubscription) {
    throw new BillingError(
      'stripe_cancellation_required',
      'This account has an active Stripe subscription. Cancel it provider-side with POST /api/billing/cancel so Stripe stops billing and the plan reverts automatically when the billing period ends.',
      409,
    );
  }

  const subscription = await prisma.subscription.upsert({
    where: { userId },
    update: {
      planId: plan.id,
      status: 'active',
      provider,
      billingPeriod: plan.billingPeriod,
      // Stripe linkage (stripeSubscriptionId/stripeCustomerId) is NEVER
      // cleared here — only the signature-verified webhook may clear it
      // (see downgradeToFree). Clearing it locally would orphan the remote
      // subscription so webhooks could never reconcile it.
      ...(isPaid ? {} : { providerRef: null, currentPeriodEnd: null }),
    },
    create: {
      userId,
      planId: plan.id,
      status: 'active',
      provider,
      billingPeriod: plan.billingPeriod,
    },
  });

  if (!isPaid) {
    return {
      subscription: toResult(subscription),
      charged: false,
      testMode: false,
      note: 'Downgraded to the free plan — no charge.',
    };
  }

  // Sandbox only: a simulated, clearly-labeled TEST upgrade. No real charge.
  return {
    subscription: toResult(subscription),
    charged: false,
    testMode: true,
    note: 'sandbox — no real charge (TEST ONLY simulated upgrade)',
  };
}
