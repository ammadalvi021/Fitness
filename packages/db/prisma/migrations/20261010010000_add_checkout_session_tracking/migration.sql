-- Track the latest pending Stripe Checkout Session per subscription so
-- retried / double-POST checkout requests resolve to the SAME session
-- instead of silently creating a second one (duplicate-subscription guard).
ALTER TABLE "Subscription" ADD COLUMN "stripeCheckoutSessionId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "stripeCheckoutSessionUrl" TEXT;
