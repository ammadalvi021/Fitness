"use client";

/**
 * Session context — extracted from app/(app)/layout.tsx (V18 fix).
 *
 * Next.js 14.2's build-time layout validation rejects non-standard exports
 * from layout files ("useSession is not a valid Layout export field"),
 * which broke `next build`. The session context now lives here; the layout
 * imports it without re-exporting.
 */
import { createContext, useContext } from "react";

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

export const SessionContext = createContext<SessionData | null>(null);

/** Access the current session (user/profile/subscription) in app pages. */
export function useSession(): SessionData {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside the app shell");
  return ctx;
}
