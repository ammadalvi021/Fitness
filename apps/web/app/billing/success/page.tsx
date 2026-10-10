"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { branding, getPlan, type PlanId } from "@/lib/site";
import { ThemeToggle } from "@/components/ThemeToggle";

const POLL_MS = 2500;
const MAX_ATTEMPTS = 14; // ~35s of polling for the webhook to land

type Phase = "checking" | "confirmed" | "pending" | "payment_issue" | "error";

interface EntitlementState {
  entitled: boolean;
  planId: string;
  status: string;
  provider: string | null;
  pastDueGraceUntil: string | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="flex items-center justify-between px-4 py-4">
        <Link href="/" aria-label={`${branding.appName} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.logoPath} alt={branding.appName} className="h-9" />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function Spinner() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-brand dark:border-neutral-700"
    />
  );
}

function formatGraceDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

/**
 * Stripe checkout return page.
 *
 * SECURITY: this page NEVER grants access on its own. It only READS the
 * server-computed entitlement result from `GET /api/billing/status` and
 * shows what the backend reports. Paid entitlement is granted exclusively
 * by the signature-verified Stripe webhook; this page polls briefly for
 * that state to land, then settles on whatever the backend says.
 *
 * "Payment confirmed" is shown ONLY when the server reports a paid planId
 * with a confirmed status (`active` or `trialing`). A `past_due` status —
 * even inside the grace window — shows a support-needed state instead:
 * the payment did not go through.
 */
function SuccessContent() {
  // Read but never trusted for entitlement — the backend state is the source
  // of truth. (The param is only used to detect a direct visit without one.)
  const sessionId = useSearchParams().get("session_id");
  const [phase, setPhase] = useState<Phase>("checking");
  const [planName, setPlanName] = useState<string | null>(null);
  const [graceUntil, setGraceUntil] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let sawResponse = false;

    async function check() {
      attempts += 1;
      if (!cancelled) setAttempt(attempts);
      try {
        const data = await api<{
          entitlement?: EntitlementState;
        }>("/api/billing/status");
        sawResponse = true;
        const e = data.entitlement;
        if (e && !cancelled) {
          try {
            setPlanName(getPlan(e.planId as PlanId).name);
          } catch {
            setPlanName(e.planId ?? null);
          }
          setGraceUntil(formatGraceDate(e.pastDueGraceUntil));
          // Confirmed payment: paid planId with a confirmed (not past-due)
          // status. past_due is deliberately NOT "Payment confirmed" —
          // the payment failed; show the support-needed state instead.
          const confirmed =
            e.entitled &&
            e.planId !== "free" &&
            (e.status === "active" || e.status === "trialing");
          if (confirmed) {
            setPhase("confirmed");
            return;
          }
          if (e.status === "past_due") {
            setPhase("payment_issue");
            return;
          }
        }
      } catch (err) {
        // 401 -> api() redirects to /login automatically. Other failures:
        // keep polling; the outcome depends on whether we ever reached the
        // backend at all.
        if (err instanceof ApiError && err.status === 401) return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        if (!cancelled) setPhase(sawResponse ? "pending" : "error");
        return;
      }
      timer = setTimeout(check, POLL_MS);
    }

    timer = setTimeout(check, 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="text-center" aria-live="polite">
      {phase === "checking" && (
        <>
          <Spinner />
          <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Confirming your subscription…
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            We&apos;re checking your subscription with our server
            {attempt > 0 ? ` (attempt ${attempt})` : ""}. Landing on this page
            doesn&apos;t grant access by itself — only a confirmed payment does.
          </p>
        </>
      )}

      {phase === "confirmed" && (
        <>
          <p aria-hidden="true" className="mx-auto text-5xl">
            ✅
          </p>
          <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Payment confirmed
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            You&apos;re on the{" "}
            <strong className="text-neutral-900 dark:text-neutral-100">
              {planName ?? "paid"}
            </strong>{" "}
            plan. Your receipt was emailed by Stripe.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/plans"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand px-6 font-medium text-white hover:bg-brand-dark"
            >
              Go to Plans
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-neutral-300 px-6 font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Go to dashboard
            </Link>
          </div>
        </>
      )}

      {phase === "payment_issue" && (
        <>
          <p aria-hidden="true" className="mx-auto text-5xl">
            💳
          </p>
          <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Payment needs attention
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Your latest payment didn&apos;t go through, so this isn&apos;t
            confirmed as paid. Your{" "}
            <strong className="text-neutral-900 dark:text-neutral-100">
              {planName ?? "paid"}
            </strong>{" "}
            plan stays active{graceUntil ? ` until ${graceUntil}` : ""} while
            you fix it — update your payment method with Stripe to keep it.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/plans"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand px-6 font-medium text-white hover:bg-brand-dark"
            >
              Go to Plans
            </Link>
            <p className="text-xs text-neutral-500 dark:text-neutral-500">
              Need help? Contact support
              {sessionId ? " and mention your checkout session" : ""}.
            </p>
          </div>
        </>
      )}

      {phase === "pending" && (
        <>
          <p aria-hidden="true" className="mx-auto text-5xl">
            ⏳
          </p>
          <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Payment received — still activating
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Your payment went through, but the confirmation is still being
            processed. This usually takes under a minute. Check the Plans page
            shortly — if it still shows the Free plan, contact support
            {sessionId ? " and mention your checkout session" : ""}.
          </p>
          <div className="mt-6">
            <Link
              href="/plans"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand px-6 font-medium text-white hover:bg-brand-dark"
            >
              Go to Plans
            </Link>
          </div>
        </>
      )}

      {phase === "error" && (
        <>
          <p aria-hidden="true" className="mx-auto text-5xl">
            ⚠️
          </p>
          <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Couldn&apos;t confirm your subscription
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            We couldn&apos;t reach the server to verify your subscription. Your
            payment may still have gone through — check the Plans page, or try
            again.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand px-6 font-medium text-white hover:bg-brand-dark"
            >
              Try again
            </button>
            <Link
              href="/plans"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-neutral-300 px-6 font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Go to Plans
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Shell>
      <Suspense
        fallback={
          <div className="text-center" aria-busy="true" aria-label="Loading">
            <Spinner />
            <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
              Confirming your subscription…
            </p>
          </div>
        }
      >
        <SuccessContent />
      </Suspense>
    </Shell>
  );
}
