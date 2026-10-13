"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Flame } from "lucide-react";
import { GlassPanel, LuxBadge } from "@/components/luxury";
import { Skeleton } from "@/components/ui";
import { api, todayString } from "@/lib/api";

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastLoggedDate: string | null;
  todayLogged: boolean;
  milestone: number | null;
}

/**
 * Presentational widget: renders a resolved streak. Exported so the
 * temporary screenshot fixture can render it with synthetic data.
 */
export function StreakWidgetLoaded({
  data,
  className = "",
  onLogNow,
}: {
  data: StreakData;
  className?: string;
  onLogNow?: () => void;
}) {
  const { currentStreak, todayLogged, milestone, longestStreak } = data;
  return (
    <GlassPanel className={`p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="t-meta mb-2">Logging streak</p>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                color: "var(--accent)",
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              <Flame size={20} />
            </span>
            <div>
              <p className="t-numeral text-2xl leading-none">
                {currentStreak}
                <span className="t-meta ml-1.5 font-normal">
                  day{currentStreak === 1 ? "" : "s"}
                </span>
              </p>
              <p className="t-meta mt-1" style={{ color: "var(--text-secondary)" }}>
                {currentStreak === 0
                  ? "Log today to start a streak"
                  : todayLogged
                    ? "Logged today — nice!"
                    : `Log today to keep your ${currentStreak}-day streak`}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {milestone !== null && (
              <LuxBadge tone="accent">
                <span className="inline-flex items-center gap-1">
                  <Flame size={12} aria-hidden="true" />
                  {milestone}-day streak
                </span>
              </LuxBadge>
            )}
            {longestStreak > currentStreak && (
              <span className="t-meta" style={{ color: "var(--text-secondary)" }}>
                Best: {longestStreak} days
              </span>
            )}
          </div>
        </div>
        {!todayLogged && onLogNow && (
          <button
            type="button"
            onClick={onLogNow}
            className="t-meta shrink-0 rounded-lg px-3 py-2 font-medium"
            style={{
              color: "var(--accent)",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            Log now
          </button>
        )}
      </div>
    </GlassPanel>
  );
}

/**
 * V20 Feature 2 — logging streak widget for the dashboard.
 * Data comes from GET /api/insights/streak (derived from real diary entries).
 * The user's local date is passed so the streak is anchored to their timezone.
 */
export function StreakWidget({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<StreakData>(
      `/api/insights/streak?today=${encodeURIComponent(todayString())}`
    )
      .then((res) => {
        if (!cancelled) setStreak(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;
  if (!streak) {
    return (
      <GlassPanel className={`p-5 ${className}`}>
        <p className="t-meta mb-2">Logging streak</p>
        <Skeleton className="h-10 w-24 rounded-lg" />
      </GlassPanel>
    );
  }
  return (
    <StreakWidgetLoaded
      data={streak}
      className={className}
      onLogNow={() => router.push("/log")}
    />
  );
}
