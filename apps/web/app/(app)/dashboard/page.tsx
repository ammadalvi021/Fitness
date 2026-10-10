"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { profileTargets, num } from "@/lib/targets";
import { api, todayString } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  ProgressRing,
  Skeleton,
} from "@/components/ui";
import { useSession } from "../layout";

/* ---------- defensive response shapes (API owned by other agents) -------- */

interface DiaryEntryLike {
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}
interface DiaryResponse {
  entries?: DiaryEntryLike[];
  totals?: DiaryEntryLike;
}
interface WaterResponse {
  ml?: number;
}
interface WeightPoint {
  recordedAt?: string;
  date?: string;
  value?: number;
}
interface ProgressResponse {
  weights?: WeightPoint[];
}
interface WorkoutPlanLike {
  weekStart?: string;
  status?: string;
  days?: unknown;
}
interface WorkoutPlansResponse {
  plans?: WorkoutPlanLike[];
  plan?: WorkoutPlanLike;
}

/* ------------------------------- helpers -------------------------------- */

function formatDateLong(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function MacroBar({
  label,
  grams,
  target,
  color,
}: {
  label: string;
  grams: number;
  target: number;
  color: string;
}) {
  const pct = target > 0 ? Math.min(grams / target, 1) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {label}
        </span>
        <span className="text-neutral-500 dark:text-neutral-400">
          {Math.round(grams)} / {Math.round(target)} g
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} ${Math.round(grams)} of ${Math.round(target)} grams`}
        aria-valuenow={Math.round(grams)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        className="mt-1 h-2.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct * 100}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export default function DashboardPage() {
  const session = useSession();
  const profile = (session.profile ?? {}) as Record<string, unknown>;
  const dateStr = todayString();

  const [diary, setDiary] = useState<DiaryResponse | null>(null);
  const [water, setWater] = useState<WaterResponse | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [workoutPlans, setWorkoutPlans] = useState<WorkoutPlansResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [waterBusy, setWaterBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      api<DiaryResponse>(`/api/diary?date=${dateStr}`),
      api<WaterResponse>(`/api/water?date=${dateStr}`),
      api<ProgressResponse>("/api/progress?days=30"),
      api<WorkoutPlansResponse>("/api/workouts/plans"),
    ]).then((results) => {
      if (cancelled) return;
      const [d, w, p, wp] = results;
      if (d.status === "fulfilled") setDiary(d.value);
      if (w.status === "fulfilled") setWater(w.value);
      if (p.status === "fulfilled") setProgress(p.value);
      if (wp.status === "fulfilled") setWorkoutPlans(wp.value);
      if (results.every((r) => r.status === "rejected")) {
        setLoadError("Couldn't load today's data. Check your connection.");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dateStr]);

  /* ---- targets derived from the profile via @fitfusion/core ------------- */
  const targets = useMemo(() => profileTargets(profile), [profile]);

  /* ---- diary totals ------------------------------------------------------ */
  const consumed = useMemo(() => {
    if (diary?.totals) {
      return {
        kcal: num(diary.totals.kcal),
        proteinG: num(diary.totals.proteinG),
        carbsG: num(diary.totals.carbsG),
        fatG: num(diary.totals.fatG),
      };
    }
    const acc = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    for (const e of diary?.entries ?? []) {
      acc.kcal += num(e.kcal);
      acc.proteinG += num(e.proteinG);
      acc.carbsG += num(e.carbsG);
      acc.fatG += num(e.fatG);
    }
    return acc;
  }, [diary]);

  /* ---- today's workout --------------------------------------------------- */
  const todaysWorkout = useMemo(() => {
    const plans = workoutPlans?.plans ?? (workoutPlans?.plan ? [workoutPlans.plan] : []);
    const plan = plans[0];
    if (!plan || !Array.isArray(plan.days)) return null;
    const start = plan.weekStart ? new Date(plan.weekStart) : null;
    if (!start || Number.isNaN(start.getTime())) {
      // Fall back: show how many training days the plan has.
      return { label: "Workout plan", detail: `${plan.days.length} training days this week` };
    }
    const diffDays = Math.floor(
      (new Date(dateStr).getTime() - start.getTime()) / 86400000
    );
    const day = diffDays >= 0 && diffDays < plan.days.length ? plan.days[diffDays] : null;
    if (!day || typeof day !== "object") {
      return { label: "Rest day", detail: "No workout scheduled for today." };
    }
    const d = day as Record<string, unknown>;
    const name = typeof d.name === "string" ? d.name : `Day ${diffDays + 1} workout`;
    const exercises = Array.isArray(d.exercises) ? d.exercises.length : Array.isArray(d.items) ? d.items.length : 0;
    return {
      label: name,
      detail: exercises > 0 ? `${exercises} exercises planned` : "Workout scheduled for today",
    };
  }, [workoutPlans, dateStr]);

  /* ---- weight trend ------------------------------------------------------ */
  const weightSeries = useMemo(() => {
    const pts = (progress?.weights ?? [])
      .filter((w) => typeof w.value === "number")
      .map((w) => ({
        date: (w.recordedAt ?? w.date ?? "").slice(0, 10),
        value: Math.round((w.value as number) * 10) / 10,
      }));
    return pts.slice(-30);
  }, [progress]);

  async function addWater(amountMl: number) {
    setWaterBusy(true);
    try {
      const current = num(water?.ml);
      const res = await api<WaterResponse>("/api/water", {
        method: "POST",
        body: { date: dateStr, ml: current + amountMl },
      });
      setWater({ ml: num(res.ml, current + amountMl) });
    } catch {
      // Keep the old value; the user can retry.
    } finally {
      setWaterBusy(false);
    }
  }

  const firstName =
    (typeof profile.displayName === "string" && profile.displayName) ||
    session.user.name ||
    "there";
  const onboardingDone = Boolean(profile.onboardingCompletedAt);

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading dashboard">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/3" />
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <EmptyState
        icon="⚠️"
        title="Couldn't load your dashboard"
        message={loadError}
        action={
          <Button onClick={() => window.location.reload()}>Retry</Button>
        }
      />
    );
  }

  // New user without enough profile data for targets: guide to onboarding.
  if (!targets) {
    return (
      <div>
        <PageHeader
          title={`Hi ${firstName} 👋`}
          subtitle={formatDateLong()}
        />
        <EmptyState
          icon="🌱"
          title="Let's set up your plan"
          message="Tell us a little about yourself and your goals so we can calculate your calorie and macro targets."
          action={
            <Link
              href="/onboarding"
              className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-dark"
            >
              Start onboarding
            </Link>
          }
        />
      </div>
    );
  }

  const waterMl = num(water?.ml);
  const waterPct = Math.min(waterMl / targets.waterMl, 1);

  return (
    <div>
      <PageHeader
        title={`Hi ${firstName} 👋`}
        subtitle={formatDateLong()}
        actions={
          !onboardingDone ? (
            <Link
              href="/onboarding"
              className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Finish setup
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {/* Calories */}
        <Card className="flex flex-col items-center gap-2">
          <h2 className="self-start text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Calories
          </h2>
          <ProgressRing
            value={consumed.kcal}
            max={targets.calorie.targetKcal}
            size={150}
            label={`${Math.round(consumed.kcal)}`}
            sublabel={`of ${targets.calorie.targetKcal} kcal`}
          />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {Math.max(targets.calorie.targetKcal - Math.round(consumed.kcal), 0)} kcal remaining
          </p>
          <Link
            href="/nutrition"
            className="mt-1 inline-flex min-h-[44px] items-center rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Log food
          </Link>
        </Card>

        {/* Macros */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Macros
          </h2>
          <div className="mt-4 space-y-4">
            <MacroBar label="Protein" grams={consumed.proteinG} target={targets.macros.proteinG} color="#16a34a" />
            <MacroBar label="Carbs" grams={consumed.carbsG} target={targets.macros.carbsG} color="#f59e0b" />
            <MacroBar label="Fat" grams={consumed.fatG} target={targets.macros.fatG} color="#3b82f6" />
          </div>
          <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
            Fiber target: {targets.macros.fiberG} g / day
          </p>
        </Card>

        {/* Water */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Water
          </h2>
          <p className="mt-3 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
            {(waterMl / 1000).toFixed(1)}{" "}
            <span className="text-base font-normal text-neutral-500">/ {(targets.waterMl / 1000).toFixed(1)} L</span>
          </p>
          <div
            role="progressbar"
            aria-label={`Water ${waterMl} of ${targets.waterMl} milliliters`}
            aria-valuenow={waterMl}
            aria-valuemin={0}
            aria-valuemax={targets.waterMl}
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
          >
            <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${waterPct * 100}%` }} />
          </div>
          <div className="mt-4 flex gap-2">
            {[250, 500].map((amt) => (
              <Button
                key={amt}
                variant="secondary"
                size="sm"
                className="flex-1 touch-target"
                disabled={waterBusy}
                onClick={() => addWater(amt)}
                aria-label={`Add ${amt} milliliters of water`}
              >
                +{amt} ml
              </Button>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Today's workout */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Today&apos;s workout
              </h2>
              {todaysWorkout ? (
                <>
                  <p className="mt-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                    {todaysWorkout.label}
                  </p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {todaysWorkout.detail}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                  No workout plan yet. Generate one to get started.
                </p>
              )}
            </div>
            <span aria-hidden="true" className="text-3xl">🏋️</span>
          </div>
          <Link
            href="/workouts"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Go to workouts
          </Link>
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            Stop exercising and seek medical attention if you feel chest pain,
            dizziness, or unusual shortness of breath.
          </p>
        </Card>

        {/* Weight trend */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Weight trend · 30 days
          </h2>
          {weightSeries.length >= 2 ? (
            <div className="mt-2 h-40" role="img" aria-label={`Weight trend chart with ${weightSeries.length} points`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weightSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                  <Tooltip formatter={(v) => [`${v} kg`, "Weight"]} labelFormatter={(d) => `Date: ${d}`} />
                  <Line type="monotone" dataKey="value" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
              Log your weight to see your trend here. Every bit of progress
              toward your goal counts.
            </p>
          )}
          <Link
            href="/progress"
            className="mt-3 inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            View progress
          </Link>
        </Card>
      </div>

      {/* Quick actions */}
      <Card className="mt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Quick actions
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { href: "/nutrition", label: "🍎 Log food" },
            { href: "/scanner", label: "📷 Scan food" },
            { href: "/workouts", label: "🏋️ Workouts" },
            { href: "/coach", label: "🤖 Ask coach" },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-neutral-100 px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {a.label}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
