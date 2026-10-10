import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import {
  billingStatus,
  pastDueGraceDays,
  subscriptionGrantsPaidAccess,
} from '@/lib/billing';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/status
 *
 * Server-computed paid-entitlement result for the current user.
 *
 * Contract: `{ billing, entitlement: { entitled, planId, status, provider,
 * pastDueGraceUntil } }`.
 *
 * - `entitled` is computed server-side with `subscriptionGrantsPaidAccess()`,
 *   applying the configured past-due grace policy
 *   (`PAST_DUE_GRACE_DAYS`, default 7).
 * - `pastDueGraceUntil` is the ISO end of the grace window when
 *   `status === 'past_due'` (and a grace clock is running); `null` otherwise.
 * - This endpoint never grants or revokes anything — it only READS.
 *   Paid entitlement is granted exclusively by the signature-verified
 *   Stripe webhook.
 */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const subscription =
    s.subscription ??
    (await prisma.subscription.upsert({
      where: { userId: s.user.id },
      update: {},
      create: { userId: s.user.id, planId: 'free', status: 'active' },
    }));

  const accessState = {
    planId: subscription.planId,
    status: subscription.status,
    pastDueSince: subscription.pastDueSince ?? null,
  };
  const entitled = subscriptionGrantsPaidAccess(accessState);

  const pastDueGraceUntil =
    subscription.status === 'past_due' && subscription.pastDueSince
      ? new Date(
          subscription.pastDueSince.getTime() +
            pastDueGraceDays() * 24 * 60 * 60 * 1000,
        ).toISOString()
      : null;

  return apiOk({
    billing: billingStatus(),
    entitlement: {
      entitled,
      planId: subscription.planId,
      status: subscription.status,
      provider: subscription.provider ?? null,
      pastDueGraceUntil,
    },
  });
}
