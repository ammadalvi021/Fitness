"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PLANS, getPlan, type PlanDefinition, type PlanId } from "@/lib/site";
import { Badge, Button, Skeleton } from "@/components/ui";
import { GlassPanel, LuxBadge, PlanCard } from "@/components/luxury";
import { useSession } from "../layout";

type BillingProvider = "none" | "sandbox" | "stripe";

interface BillingShape {
  provider: BillingProvider;
  configured: boolean;
  missing: string[];
}

interface SubscriptionShape {
  planId?: string;
  status?: string;
  billingPeriod?: string | null;
  provider?: string | null;
  currentPeriodEnd?: string | null;
}

interface SubscriptionsResponse {
  subscription?: SubscriptionShape;
  billing?: BillingShape;
}

interface SelectPlanResponse {
  subscription: SubscriptionShape;
  charged: boolean;
  testMode: boolean;
  note?: string;
}

interface BillingCancelResponse {
  subscription?: SubscriptionShape;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
  testMode?: boolean;
  note?: string;
}

function limitLabel(value: number, unit: string): string {
  return value < 0 ? `Unlimited ${unit}` : `${value} ${unit}`;
}

export default function PlansPage() {
  const session = useSession();
  const [sub, setSub] = useState<SubscriptionShape | null>(null);
  const [billing, setBilling] = useState<BillingShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<PlanId | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sessionPlanId =
    (session.subscription?.planId as PlanId | undefined) ?? "free";

  useEffect(() => {
    let cancelled = false;
    api<SubscriptionsResponse>("/api/subscriptions")
      .then((data) => {
        if (cancelled) return;
        setSub(data.subscription ?? null);
        setBilling(data.billing ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentPlanId = (sub?.planId as PlanId | undefined) ?? sessionPlanId;
  // Fail closed: if the billing status couldn't be determined, treat paid
  // plans as unavailable rather than unlocking anything.
  const provider: BillingProvider = billing?.provider ?? "none";
  const stripeMisconfigured = provider === "stripe" && !billing?.configured;

  /**
   * Paid plans are NEVER activated by selection alone. In `stripe` mode the
   * button starts a real Stripe Checkout session (the server maps planId ->
   * Price ID; the client never sees a price or a secret). In `sandbox` mode
   * the server records a clearly-labeled TEST-ONLY upgrade. In `none` mode
   * (or when Stripe is misconfigured) paid checkout is unavailable and the
   * click surfaces an actionable error instead of unlocking access.
   */
  async function selectPlan(planId: PlanId) {
    setError(null);
    setNotice(null);
    const plan = getPlan(planId);

    if (plan.id !== "free") {
      if (provider === "stripe") {
        await startCheckout(planId);
        return;
      }
      if (provider !== "sandbox") {
        setError(
          `The "${plan.name}" plan requires paid checkout, but no billing provider is configured. ` +
            "Paid plans can't be activated and you won't be charged. " +
            "Ask the app administrator to configure Stripe billing to enable paid upgrades."
        );
        return;
      }
      // sandbox: fall through to the test-only upgrade below.
    }

    setBusy(planId);
    try {
      const res = await api<SelectPlanResponse>("/api/subscriptions", {
        method: "POST",
        body: { planId },
      });
      setSub({ ...sub, ...res.subscription });
      if (res.testMode) {
        setNotice(
          `TEST-ONLY sandbox upgrade: you're now on the ${plan.name} plan. ` +
            "No real charge was made — this is a simulated upgrade."
        );
      } else {
        setNotice(res.note ?? `You're now on the ${plan.name} plan.`);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't change your plan."
      );
    } finally {
      setBusy(null);
    }
  }

  async function startCheckout(planId: PlanId) {
    const plan = getPlan(planId);
    setBusy(planId);
    try {
      const res = await api<{ url?: string }>("/api/billing/checkout", {
        method: "POST",
        body: { planId },
      });
      if (!res.url) {
        throw new Error("Checkout did not return a redirect URL.");
      }
      setNotice(`Opening secure Stripe checkout for the ${plan.name} plan…`);
      window.location.href = res.url;
    } catch (err) {
      if (err instanceof ApiError) {
        if (
          err.code === "stripe_not_configured" ||
          err.code === "stripe_price_missing"
        ) {
          setError(
            `Paid checkout isn't available yet. ${err.message} ` +
              "Ask the app administrator to finish Stripe billing setup."
          );
        } else {
          setError(err.message || "Couldn't start checkout. Please try again.");
        }
      } else if (err instanceof TypeError) {
        setError(
          "Couldn't reach the server. Check your connection and try again."
        );
      } else {
        setError(
          err instanceof Error ? err.message : "Couldn't start checkout."
        );
      }
    } finally {
      setBusy(null);
    }
  }

  /**
   * Cancellation always goes through POST /api/billing/cancel, which cancels
   * provider-side in `stripe` mode (paid access continues until the billing
   * period ends; the verified webhook reverts the plan afterwards) and
   * downgrades locally in `none`/`sandbox` mode.
   */
  async function cancel() {
    setError(null);
    setNotice(null);
    setBusy("cancel");
    try {
      const res = await api<BillingCancelResponse>("/api/billing/cancel", {
        method: "POST",
      });
      if (res.subscription) {
        setSub({ ...sub, ...res.subscription });
        setNotice(
          res.testMode
            ? `TEST-ONLY sandbox cancellation: ${res.note ?? "You're back on the Free plan. No real charge was made."}`
            : (res.note ?? "Your plan was cancelled. You're now on the Free plan.")
        );
      } else if (res.cancelAtPeriodEnd) {
        setSub({
          ...sub,
          currentPeriodEnd: res.currentPeriodEnd ?? sub?.currentPeriodEnd ?? null,
        });
        setNotice(
          res.note ??
            "Your Stripe subscription will end at the current billing period. Paid access continues until then."
        );
      } else {
        setNotice(res.note ?? "Your plan was cancelled.");
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't cancel your plan."
      );
    } finally {
      setBusy(null);
    }
  }

  function providerLine(): string {
    if (sub?.provider === "stripe") {
      return (
        "Billed via Stripe" +
        (sub.currentPeriodEnd
          ? ` · paid access until ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`
          : "")
      );
    }
    if (stripeMisconfigured) {
      return "Stripe billing is selected but not fully configured — paid checkout is unavailable until setup is complete.";
    }
    if (provider === "sandbox") {
      return "Sandbox billing (test only) — paid selections are simulated upgrades. No real charge.";
    }
    return "No payment provider connected — paid plans can't be activated and you are not being charged.";
  }

  function actionLabel(plan: PlanDefinition, isUpgrade: boolean): string {
    if (busy === plan.id) {
      return provider === "stripe" && plan.id !== "free"
        ? "Opening checkout…"
        : "Working…";
    }
    return `${isUpgrade ? "Upgrade to" : "Downgrade to"} ${plan.name}`;
  }

  const plans = PLANS.filter((p) => p.available);

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading plans">
        <Skeleton className="h-9 w-1/3" />
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  return (
    <div className="anim-page-enter">
      <h1 className="t-greeting">Plans</h1>
      <p className="t-body mt-1 text-[var(--text-secondary)]">
        Choose the plan that fits your journey. Paid plans activate through
        secure Stripe checkout — selecting a plan here never charges you.
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 mt-6 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--error)",
            backgroundColor:
              "color-mix(in srgb, var(--error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)",
          }}
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mb-4 mt-6 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--success)",
            backgroundColor:
              "color-mix(in srgb, var(--success) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--success) 38%, transparent)",
          }}
        >
          {notice}
        </p>
      )}

      {provider === "sandbox" && (
        <p
          role="status"
          className="mb-4 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--warning)",
            backgroundColor:
              "color-mix(in srgb, var(--warning) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--warning) 38%, transparent)",
          }}
        >
          Sandbox billing is active — paid plan buttons create{" "}
          <strong>test-only</strong> simulated upgrades. No real charge is ever
          made.
        </p>
      )}
      {stripeMisconfigured && (
        <p
          role="alert"
          className="mb-4 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--warning)",
            backgroundColor:
              "color-mix(in srgb, var(--warning) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--warning) 38%, transparent)",
          }}
        >
          Stripe billing is selected but not fully configured — paid checkout is
          unavailable until the administrator completes setup.
        </p>
      )}

      {/* Billing status */}
      <GlassPanel className="mb-4 mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="t-meta">Current plan</h2>
            <p className="mt-1 flex items-center gap-2 text-lg font-bold text-[var(--text)]">
              {getPlan(currentPlanId).name}{" "}
              {sub?.status && sub.status !== "active" && (
                <Badge tone="amber">{sub.status}</Badge>
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {providerLine()}
            </p>
          </div>
          {currentPlanId !== "free" && (
            <Button
              variant="secondary"
              onClick={cancel}
              disabled={busy !== null}
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel plan"}
            </Button>
          )}
        </div>
      </GlassPanel>

      <div className="grid gap-5 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const isUpgrade = plan.rank > getPlan(currentPlanId).rank;
          const showTestOnly = provider === "sandbox" && plan.id !== "free";
          return (
            <PlanCard
              key={plan.id}
              name={plan.name}
              price={`$${plan.price.toFixed(2)}`}
              period={
                plan.billingPeriod === "free"
                  ? "forever"
                  : `/ ${plan.billingPeriod.replace("ly", "")}`
              }
              features={plan.features}
              highlighted={isCurrent}
              badge={isCurrent ? "Current" : undefined}
              cta={
                <>
                  {showTestOnly && (
                    <div className="mb-3">
                      <LuxBadge tone="warning">Test only</LuxBadge>
                    </div>
                  )}
                  <p className="t-meta mb-2">Usage limits</p>
                  <p className="mb-4 text-xs text-[var(--text-secondary)]">
                    {limitLabel(plan.limits.aiScansPerMonth, "AI scans/mo")} ·{" "}
                    {limitLabel(plan.limits.aiCoachMessagesPerDay, "coach msgs/day")}
                  </p>
                  {isCurrent ? (
                    <p
                      className="rounded-xl px-4 py-3 text-center text-sm font-medium"
                      style={{
                        color: "var(--success)",
                        backgroundColor:
                          "color-mix(in srgb, var(--success) 12%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--success) 38%, transparent)",
                      }}
                    >
                      This is your current plan
                    </p>
                  ) : (
                    <Button
                      variant={isUpgrade ? "primary" : "secondary"}
                      className="w-full"
                      disabled={busy !== null}
                      onClick={() => selectPlan(plan.id)}
                    >
                      {actionLabel(plan, isUpgrade)}
                    </Button>
                  )}
                </>
              }
            />
          );
        })}
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-[var(--text-secondary)]">
        Paid plans are activated only after payment through a configured provider
        (Stripe) — plan selection here never charges you. Free-plan changes apply
        immediately.
      </p>
    </div>
  );
}
