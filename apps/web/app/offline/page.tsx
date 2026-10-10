import Link from "next/link";
import { branding } from "@/lib/site";

export const metadata = {
  title: "Offline",
  description: "You are currently offline.",
};

/**
 * Offline fallback page served by the service worker when a navigation
 * fails without connectivity.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-6 text-center dark:bg-neutral-950">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={branding.logoPath} alt={branding.appName} className="h-16" />
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        You&apos;re offline
      </h1>
      <p className="max-w-sm text-sm text-neutral-600 dark:text-neutral-400">
        FitFusion AI needs an internet connection to load your data. Check your
        connection and try again.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 font-medium text-white hover:bg-brand-dark"
      >
        Try again
      </Link>
    </main>
  );
}
