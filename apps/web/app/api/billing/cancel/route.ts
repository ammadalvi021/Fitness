import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { billingProvider, requireStripe, BillingError } from '@/lib/billing';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Cancel the user's paid subscription.
 *
 * Design decision: in `stripe` mode this sets `cancel_at_period_end` on the
 * real Stripe subscription (via `stripe.subscriptions.update`) — the user
 * KEEPS paid access until the current period ends. The local plan is NOT
 * changed optimistically: the downgrade to `free` happens only when the
 * signature-verified webhook confirms it (`customer.subscription.deleted`,
 * or `updated` with status `canceled`). This keeps the local record and
 * Stripe in agreement even if this request succeeds but the period-end
 * event arrives later.
 *
 * In `none` / `sandbox` mode there is no remote subscription, so the local
 * plan is downgraded to `free` directly (sandbox responses are labeled
 * test-only).
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const provider = billingProvider();

  if (provider === 'stripe') {
    let stripe;
    try {
      stripe = requireStripe();
    } catch (e) {
      if (e instanceof BillingError) return apiError(e.code, e.message, e.status);
      throw e;
    }
    const local = await prisma.subscription.findUnique({
      where: { userId: s.user.id },
    });
    const stripeSubId = local?.stripeSubscriptionId;
    if (!stripeSubId) {
      return apiError(
        'no_active_stripe_subscription',
        'No active Stripe subscription found for this account.',
        409,
      );
    }
    const updated = await stripe.subscriptions.update(stripeSubId, {
      cancel_at_period_end: true,
    });
    // Stripe API (v23): period end lives on the subscription item.
    const periodEndSecs = updated.items?.data?.[0]?.current_period_end;
    const periodEnd =
      typeof periodEndSecs === 'number' ? new Date(periodEndSecs * 1000) : null;
    // Local access is deliberately NOT changed here — the webhook confirms it.
    await prisma.subscription.update({
      where: { userId: s.user.id },
      data: { currentPeriodEnd: periodEnd },
    });
    return apiOk({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: periodEnd,
      note: 'Your subscription will end at the current billing period. Paid access continues until then; the plan reverts to free automatically afterwards.',
    });
  }

  // none / sandbox: no remote subscription exists — downgrade locally.
  // SAFETY: if the record still looks like a live Stripe subscription
  // (stripeSubscriptionId linked, paid plan, entitled status — e.g. the
  // operator switched BILLING_PROVIDER away from 'stripe' mid-subscription),
  // a local-only downgrade would orphan the real subscription at Stripe,
  // which would keep billing the customer. Refuse and explain instead.
  const local = await prisma.subscription.findUnique({
    where: { userId: s.user.id },
  });
  const looksLiveStripe =
    Boolean(local?.stripeSubscriptionId) &&
    (local?.planId ?? 'free') !== 'free' &&
    ['active', 'trialing', 'past_due'].includes(local?.status ?? '');
  if (looksLiveStripe) {
    return apiError(
      'stripe_cancellation_required',
      'This account is linked to a Stripe subscription. Provider-side cancellation ' +
        'is required so Stripe stops billing you — contact support or re-enable ' +
        'Stripe billing (BILLING_PROVIDER=stripe) to cancel from the Plans page.',
      409,
    );
  }

  const subscription = await prisma.subscription.upsert({
    where: { userId: s.user.id },
    update: {
      planId: 'free',
      status: 'active',
      providerRef: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      billingPeriod: 'free',
    },
    create: { userId: s.user.id, planId: 'free', status: 'active', provider },
  });
  return apiOk({
    subscription,
    ...(provider === 'sandbox' ? { testMode: true } : {}),
    note:
      provider === 'sandbox'
        ? 'sandbox — no real charge (TEST ONLY simulated cancellation)'
        : 'Plan cancelled — reverted to the free plan. No charge occurred.',
  });
}
