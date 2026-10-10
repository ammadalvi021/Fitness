-- Add pastDueSince to Subscription: records when a Stripe subscription first
-- entered past_due, so the finite grace window (PAST_DUE_GRACE_DAYS) can be
-- enforced. NULL = not in arrears (or legacy row — treated fail-closed).
ALTER TABLE "Subscription" ADD COLUMN "pastDueSince" TIMESTAMP(3);
