"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Sidebar, BottomNav } from "@/components/Nav";
import { Skeleton } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Shape of GET /api/auth/me (user, profile, subscription). */
export interface SessionData {
  user: {
    id: string;
    email: string;
    name?: string | null;
    emailVerifiedAt?: string | null;
  };
  profile: Record<string, unknown> | null;
  subscription: { planId: string; status: string } | null;
}

const SessionContext = createContext<SessionData | null>(null);

/** Access the current session (user/profile/subscription) in app pages. */
export function useSession(): SessionData {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside the app shell");
  return ctx;
}

/**
 * Authenticated shell: verifies the session, then renders the sidebar
 * (desktop), bottom nav (mobile), and page content.
 * A 401 from /api/auth/me is handled by api() -> redirect to /login.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<SessionData>("/api/auth/me")
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch(() => {
        // 401s are redirected to /login by api(); anything else is a
        // genuine load failure we surface.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed && !session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Couldn&apos;t load your account
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-6 font-medium text-white hover:bg-brand-dark"
        >
          Retry
        </button>
      </main>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen" aria-busy="true" aria-label="Loading">
        <div className="hidden w-60 shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-800 md:block">
          <Skeleton className="h-10 w-3/4" />
          <div className="mt-6 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-950">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden">
            <span className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              FitFusion AI
            </span>
            <ThemeToggle />
          </header>
          <main id="main-content" className="flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-6">
            <div className="mx-auto max-w-5xl">{children}</div>
          </main>
        </div>
        <BottomNav />
      </div>
    </SessionContext.Provider>
  );
}
