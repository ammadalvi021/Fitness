"use client";

import Link from "next/link";
import { branding } from "@/lib/site";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Stripe checkout cancellation return page.
 *
 * Deliberately changes NOTHING: no API calls, no state writes. The user's
 * plan is exactly what it was before checkout — no charge was made.
 */
export default function BillingCancelledPage() {
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
        <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:p-8">
          <p aria-hidden="true" className="mx-auto text-5xl">
            ↩️
          </p>
          <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Checkout cancelled
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            No charge was made and your plan hasn&apos;t changed. You can try
            again whenever you&apos;re ready.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/plans"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand px-6 font-medium text-white hover:bg-brand-dark"
            >
              Return to Plans
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-neutral-300 px-6 font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
