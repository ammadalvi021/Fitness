import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { billingStatus } from '@/lib/billing';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Legacy cancellation endpoint (kept for backwards compatibility).
 *
 * SAFETY: this route NEVER locally downgrades an account that is linked to
 * a live-looking Stripe subscription (stripeSubscriptionId present, paid
 * planId, entitled status). A local-only downgrade there would desync the
 * app from Stripe — Stripe would keep billing while the app shows Free,
 * orphaning the remote subscription. Cancellation MUST go provider-side
 * via POST /api/billing/cancel; the signature-verified webhook then
 * synchronizes the local state when the billing period actually ends.
 *
 * Accounts with NO live Stripe subscription (none/sandbox mode, or a stale
 * record with no provider subscription id) keep the old behavior: a local
 * downgrade to the free plan. Stripe customer/subscription identifiers are
 * never cleared here, so a future checkout can reuse the Stripe customer.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const subscription = await prisma.subscription.findUnique({
    where: { userId: s.user.id },
  });

  const hasLiveStripeSubscription =
    Boolean(subscription?.stripeSubscriptionId) &&
    (subscription?.planId ?? 'free') !== 'free' &&
    ['active', 'trialing', 'past_due'].includes(subscription?.status ?? '');

  if (hasLiveStripeSubscription) {
    const status = billingStatus();
    const stripeMisconfigured =
      status.provider === 'stripe' && !status.configured;
    return apiError(
      'stripe_cancellation_required',
      'This account has an active Stripe subscription. Cancel it provider-side ' +
        'with POST /api/billing/cancel so Stripe stops billing you and the plan ' +
        'reverts automatically when the billing period ends — cancelling here ' +
        'alone would leave the Stripe subscription active.' +
        (stripeMisconfigured
          ? ' Note: Stripe billing is not fully configured on this server right ' +
            'now, so provider-side cancellation cannot complete — please contact support.'
          : ''),
      409,
    );
  }

  const downgraded = await prisma.subscription.upsert({
    where: { userId: s.user.id },
    update: {
      planId: 'free',
      status: 'active',
      billingPeriod: 'free',
      providerRef: null,
      currentPeriodEnd: null,
    },
    create: { userId: s.user.id, planId: 'free', status: 'active' },
  });
  return apiOk({
    subscription: downgraded,
    note: 'Plan cancelled — reverted to the free plan. No charge occurred.',
  });
}
