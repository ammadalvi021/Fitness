/**
 * Past-due grace sweeper.
 *
 * Revokes paid access for every subscription whose finite past_due grace
 * window (PAST_DUE_GRACE_DAYS, default 7) has expired: downgrades them to
 * the free plan.
 *
 * Intended to run on a schedule (cron), e.g. daily:
 *   npx tsx scripts/enforce-past-due-grace.ts
 *
 * The same check also runs inside the Stripe webhook on every event for a
 * user (`enforcePastDueGrace` in apps/web/app/api/billing/webhook/route.ts);
 * this script is the time-based backstop for users Stripe never sends
 * another event about.
 *
 * Idempotent: rows already free / not past_due / still inside the window
 * are left untouched. Safe to re-run.
 */
import { prisma } from '@fitfusion/db';
import { subscriptionGrantsPaidAccess } from '../apps/web/lib/billing';

async function main(): Promise<void> {
  const candidates = await prisma.subscription.findMany({
    where: { status: 'past_due', NOT: { planId: 'free' } },
    select: { userId: true, planId: true, status: true, pastDueSince: true },
  });

  let revoked = 0;
  let kept = 0;
  for (const sub of candidates) {
    if (subscriptionGrantsPaidAccess(sub)) {
      kept += 1;
      continue;
    }
    await prisma.subscription.update({
      where: { userId: sub.userId },
      data: {
        planId: 'free',
        status: 'active',
        billingPeriod: 'free',
        providerRef: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        pastDueSince: null,
      },
    });
    revoked += 1;
    console.log(
      `[grace-sweep] revoked expired past_due access: userId=${sub.userId} planId=${sub.planId} pastDueSince=${sub.pastDueSince?.toISOString() ?? 'null'}`,
    );
  }

  console.log(
    `[grace-sweep] done: checked=${candidates.length} kept_in_grace=${kept} revoked=${revoked}`,
  );
}

main()
  .catch((e) => {
    console.error('[grace-sweep] failed', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
