"use client";

/**
 * /dashboard — daily overview.
 *
 * Each data section (diary, water, weight progress, workout plans) loads and
 * fails independently: a failed request renders an honest error state with a
 * retry for that section only, and never implies zero calories consumed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Camera,
  Check,
  ChefHat,
  Circle,
  ClipboardCheck,
  Droplets,
  Dumbbell,
  Flame,
  Info,
  Scale,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";
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
import { Skeleton } from "@/components/ui";
import {
  EmptyStateLux,
  ErrorStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
  MediaPanelLux,
  MetricCard,
  ProgressBar,
  ProgressRing,
  Tooltip as LuxTooltip,
} from "@/components/luxury";
import { ExerciseAnimation, hasExerciseAnimation } from "@/components/ExerciseAnimation";
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

/* ---------------------- per-section load status ------------------------- */

type SectionStatus = "loading" | "ok" | "empty" | "error";

interface TodaysWorkout {
  kind: "plan" | "rest" | "workout";
  label: string;
  detail: string;
  exerciseCount: number;
  durationMin: number | null;
  firstSlug: string | null;
}

/* ------------------------------- helpers -------------------------------- */

function formatDateLong(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function dayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const GOAL_LABELS: Record<string, string> = {
  lose: "Lose weight",
  maintain: "Maintain weight",
  gain: "Gain weight",
  improve_fitness: "Improve fitness",
  eat_healthier: "Eat healthier",
};

function SectionSkeleton({ className = "h-56" }: { className?: string }) {
  return <Skeleton className={className} />;
}

/* --------------------------------- page --------------------------------- */

export default function DashboardPage() {
  const router = useRouter();
  const go = useCallback((href: string) => () => router.push(href), [router]);
  const session = useSession();
  const profile = (session.profile ?? {}) as Record<string, unknown>;
  const dateStr = todayString();

  /* ---- per-section data + status (independent; never imply zeros) ------- */
  const [diary, setDiary] = useState<DiaryResponse | null>(null);
  const [diaryStatus, setDiaryStatus] = useState<SectionStatus>("loading");
  const [water, setWater] = useState<WaterResponse | null>(null);
  const [waterStatus, setWaterStatus] = useState<SectionStatus>("loading");
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [progressStatus, setProgressStatus] = useState<SectionStatus>("loading");
  const [workoutPlans, setWorkoutPlans] = useState<WorkoutPlansResponse | null>(null);
  const [workoutPlansStatus, setWorkoutPlansStatus] = useState<SectionStatus>("loading");
  const [waterBusy, setWaterBusy] = useState(false);

  const loadDiary = useCallback(async () => {
    setDiaryStatus("loading");
    try {
      const res = await api<DiaryResponse>(`/api/diary?date=${dateStr}`);
      setDiary(res);
      const entries = res.entries ?? [];
      const hasData = entries.length > 0 || num(res.totals?.kcal) > 0;
      setDiaryStatus(hasData ? "ok" : "empty");
    } catch {
      setDiaryStatus("error");
    }
  }, [dateStr]);

  const loadWater = useCallback(async () => {
    setWaterStatus("loading");
    try {
      const res = await api<WaterResponse>(`/api/water?date=${dateStr}`);
      setWater(res);
      setWaterStatus(num(res.ml) > 0 ? "ok" : "empty");
    } catch {
      setWaterStatus("error");
    }
  }, [dateStr]);

  const loadProgress = useCallback(async () => {
    setProgressStatus("loading");
    try {
      const res = await api<ProgressResponse>("/api/progress?days=30");
      setProgress(res);
      const hasWeights = (res.weights ?? []).some((w) => typeof w.value === "number");
      setProgressStatus(hasWeights ? "ok" : "empty");
    } catch {
      setProgressStatus("error");
    }
  }, []);

  const loadWorkoutPlans = useCallback(async () => {
    setWorkoutPlansStatus("loading");
    try {
      const res = await api<WorkoutPlansResponse>("/api/workouts/plans");
      setWorkoutPlans(res);
      const plans = res.plans ?? (res.plan ? [res.plan] : []);
      setWorkoutPlansStatus(plans.length > 0 ? "ok" : "empty");
    } catch {
      setWorkoutPlansStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadDiary();
    void loadWater();
    void loadProgress();
    void loadWorkoutPlans();
  }, [loadDiary, loadWater, loadProgress, loadWorkoutPlans]);

  /* ---- targets derived from the profile via @fitfusion/core ------------- */
  const targets = useMemo(() => profileTargets(profile), [profile]);

  /* ---- diary totals (only meaningful when diary loaded) ------------------ */
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

  /* ---- today's workout (defensive: plan shape owned elsewhere) ----------- */
  const todaysWorkout = useMemo<TodaysWorkout | null>(() => {
    const plans = workoutPlans?.plans ?? (workoutPlans?.plan ? [workoutPlans.plan] : []);
    const plan = plans[0];
    if (!plan || !Array.isArray(plan.days)) return null;
    const start = plan.weekStart ? new Date(plan.weekStart) : null;
    if (!start || Number.isNaN(start.getTime())) {
      // Fall back: show how many training days the plan has.
      return {
        kind: "plan",
        label: "Workout plan",
        detail: `${plan.days.length} training days this week`,
        exerciseCount: 0,
        durationMin: null,
        firstSlug: null,
      };
    }
    const diffDays = Math.floor(
      (new Date(dateStr).getTime() - start.getTime()) / 86400000
    );
    const day = diffDays >= 0 && diffDays < plan.days.length ? plan.days[diffDays] : null;
    if (!day || typeof day !== "object") {
      return {
        kind: "rest",
        label: "Rest day",
        detail: "No workout scheduled for today.",
        exerciseCount: 0,
        durationMin: null,
        firstSlug: null,
      };
    }
    const d = day as Record<string, unknown>;
    const name = typeof d.name === "string" ? d.name : `Day ${diffDays + 1} workout`;
    const exercisesRaw = Array.isArray(d.exercises)
      ? d.exercises
      : Array.isArray(d.items)
        ? d.items
        : [];
    const first = exercisesRaw[0];
    const firstSlug =
      first && typeof first === "object" && typeof (first as Record<string, unknown>).slug === "string"
        ? ((first as Record<string, unknown>).slug as string)
        : null;
    const durationRaw = num(d.durationMin ?? d.durationMinutes);
    return {
      kind: "workout",
      label: name,
      detail:
        exercisesRaw.length > 0
          ? `${exercisesRaw.length} exercise${exercisesRaw.length === 1 ? "" : "s"} planned`
          : "Workout scheduled for today",
      exerciseCount: exercisesRaw.length,
      durationMin: durationRaw > 0 ? Math.round(durationRaw) : null,
      firstSlug,
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

  const latestWeight = weightSeries.length ? weightSeries[weightSeries.length - 1] : null;
  const weightDelta =
    weightSeries.length > 1
      ? weightSeries[weightSeries.length - 1].value - weightSeries[0].value
      : null;
  const weighedInThisWeek = latestWeight
    ? Date.now() - new Date(`${latestWeight.date}T12:00:00`).getTime() < 7 * 86400000
    : false;

  /* ---- recent activity (today's diary entries — no new endpoints) -------- */
  const recentEntries = useMemo(() => {
    const list = diary?.entries ?? [];
    return list.slice(-4).reverse();
  }, [diary]);

  async function addWater(amountMl: number) {
    setWaterBusy(true);
    try {
      const current = num(water?.ml);
      const res = await api<WaterResponse>("/api/water", {
        method: "POST",
        body: { date: dateStr, ml: current + amountMl },
      });
      const next = num(res.ml, current + amountMl);
      setWater({ ml: next });
      setWaterStatus(next > 0 ? "ok" : "empty");
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
  const goalKey = typeof profile.goal === "string" ? profile.goal : "";
  const goalLabel = GOAL_LABELS[goalKey] ?? (goalKey ? goalKey : null);

  /* ---- one next action, derived from what actually loaded ---------------- */
  const nextAction: { label: string; href?: string; onClick?: () => void } = useMemo(() => {
    if (!onboardingDone) return { label: "Finish setup", href: "/onboarding" };
    if (diaryStatus === "error")
      return { label: "Retry today's data", onClick: () => void loadDiary() };
    if (diaryStatus === "empty")
      return { label: "Log your first meal", href: "/nutrition" };
    if (waterStatus === "ok" && targets && num(water?.ml) < targets.waterMl)
      return { label: "Top up your water", href: "/nutrition" };
    if (todaysWorkout?.kind === "workout")
      return { label: "View today's workout", href: "/workouts" };
    return { label: "Review your progress", href: "/progress" };
  }, [onboardingDone, diaryStatus, waterStatus, water, targets, todaysWorkout, loadDiary]);

  /* ---- habit checklist (derived only from loaded data) ------------------- */
  const habits = useMemo(
    () =>
      targets
        ? [
            {
              label: "Log today's meals",
              done: diaryStatus === "ok",
              hint: diaryStatus === "error" ? "couldn't load" : undefined,
            },
            {
              label: "Reach your water goal",
              done: waterStatus === "ok" && num(water?.ml) >= targets.waterMl,
              hint: waterStatus === "error" ? "couldn't load" : undefined,
            },
            {
              label: "Move today",
              done: todaysWorkout?.kind === "workout",
              hint:
                workoutPlansStatus === "error"
                  ? "couldn't load"
                  : todaysWorkout?.kind === "rest"
                    ? "rest day"
                    : undefined,
            },
            {
              label: "Weigh in this week",
              done: weighedInThisWeek,
              hint: progressStatus === "error" ? "couldn't load" : undefined,
            },
          ]
        : [],
    [targets, diaryStatus, waterStatus, water, todaysWorkout, workoutPlansStatus, weighedInThisWeek, progressStatus]
  );

  /* ---- targets gate (unchanged semantics) -------------------------------- */
  if (!targets) {
    const started = Boolean(profile.onboardingCompletedAt);
    return (
      <div className="anim-page-enter">
        <header className="mb-6">
          <p className="t-greeting">
            {dayGreeting()}, {firstName}
          </p>
          <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
            {formatDateLong()}
          </p>
        </header>
        <EmptyStateLux
          icon={<Flame size={22} aria-hidden="true" />}
          title={started ? "Almost there — a few details missing" : "Let's set up your plan"}
          message={
            started
              ? "Your height, weight, or date of birth is missing, so your calorie and macro targets can't be calculated yet. Add them to unlock your plan."
              : "Tell us a little about yourself and your goals so we can calculate your calorie and macro targets."
          }
          action={
            <LuxButton onClick={go("/onboarding")}>
              {started ? "Complete your profile" : "Start onboarding"}
            </LuxButton>
          }
        />
      </div>
    );
  }

  const targetKcal = targets.calorie.targetKcal;
  const waterMl = num(water?.ml);
  const waterPct = Math.min((waterMl / targets.waterMl) * 100, 100);
  const caloriePct = Math.min((consumed.kcal / targetKcal) * 100, 100);
  const remaining = targetKcal - Math.round(consumed.kcal);
  const showAnimation =
    todaysWorkout?.firstSlug != null && hasExerciseAnimation(todaysWorkout.firstSlug);

  return (
    <div className="anim-page-enter">
      {/* ------------------------- welcome header ------------------------- */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="t-greeting">
            {dayGreeting()}, {firstName}
          </p>
          <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
            {formatDateLong()}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {goalLabel && <LuxBadge tone="accent">{goalLabel}</LuxBadge>}
            {!onboardingDone && <LuxBadge tone="warning">Setup incomplete</LuxBadge>}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className="t-meta">Next up</span>
          <LuxButton
            variant="secondary"
            onClick={nextAction.href ? go(nextAction.href) : nextAction.onClick}
          >
            {nextAction.label}
          </LuxButton>
        </div>
      </header>

      {/* ---------------------- daily progress area ----------------------- */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Calories */}
        <GlassPanel className="flex flex-col items-center gap-2 p-6">
          <h2 className="t-meta self-start">Calories</h2>
          {diaryStatus === "loading" ? (
            <SectionSkeleton className="h-44 w-44 rounded-full" />
          ) : diaryStatus === "error" ? (
            <ErrorStateLux
              title="Couldn't load today's diary"
              message="Your calorie count is unavailable right now — we're not assuming zero."
              onRetry={() => void loadDiary()}
              retryLabel="Retry"
              className="mt-2"
            />
          ) : (
            <>
              <div className="relative">
                <ProgressRing value={caloriePct} size={150} showValue={false} label="Calories consumed vs target" />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="t-numeral text-3xl">{Math.round(consumed.kcal)}</span>
                  <span className="t-meta mt-1 flex items-center gap-1">
                    of {targetKcal} kcal target
                    <LuxTooltip tip="Estimated with the Mifflin-St Jeor equation from your age, sex, height and weight, adjusted for your activity level and goal.">
                      <Info size={13} aria-hidden="true" className="cursor-help" style={{ color: "var(--text-secondary)" }} />
                    </LuxTooltip>
                  </span>
                </div>
              </div>
              {diaryStatus === "empty" ? (
                <p className="t-body text-center" style={{ color: "var(--text-secondary)" }}>
                  Nothing logged yet — {targetKcal.toLocaleString()} kcal available today.
                </p>
              ) : remaining >= 0 ? (
                <p className="t-body text-center" style={{ color: "var(--text-secondary)" }}>
                  <span className="t-numeral">{remaining.toLocaleString()}</span> kcal remaining
                </p>
              ) : (
                <p className="t-body text-center" style={{ color: "var(--text-secondary)" }}>
                  <span className="t-numeral">+{Math.abs(remaining).toLocaleString()}</span> over target
                </p>
              )}
              <LuxButton className="mt-1" onClick={go("/nutrition")}>
                Log food
              </LuxButton>
            </>
          )}
        </GlassPanel>

        {/* Macros */}
        <GlassPanel className="p-6">
          <h2 className="t-meta">Macros</h2>
          {diaryStatus === "loading" ? (
            <div className="mt-4 space-y-4">
              <SectionSkeleton className="h-10" />
              <SectionSkeleton className="h-10" />
              <SectionSkeleton className="h-10" />
            </div>
          ) : diaryStatus === "error" ? (
            <ErrorStateLux
              title="Couldn't load macros"
              message="Macro totals are unavailable right now."
              onRetry={() => void loadDiary()}
              retryLabel="Retry"
              className="mt-2"
            />
          ) : (
            <div className="mt-4 space-y-4">
              {[
                { label: "Protein", grams: consumed.proteinG, target: targets.macros.proteinG },
                { label: "Carbs", grams: consumed.carbsG, target: targets.macros.carbsG },
                { label: "Fat", grams: consumed.fatG, target: targets.macros.fatG },
              ].map((m) => (
                <div key={m.label}>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="t-body font-medium">{m.label}</span>
                    <span className="t-meta" aria-live="polite">
                      <span className="t-numeral">{Math.round(m.grams)}</span> /{" "}
                      <span className="t-numeral">{Math.round(m.target)}</span> g
                    </span>
                  </div>
                  <ProgressBar
                    value={m.grams}
                    max={m.target}
                    label={`${m.label} ${Math.round(m.grams)} of ${Math.round(m.target)} grams`}
                  />
                </div>
              ))}
              <p className="t-meta">
                Fiber target: <span className="t-numeral">{targets.macros.fiberG}</span> g / day
              </p>
              {diaryStatus === "empty" && (
                <p className="t-body" style={{ color: "var(--text-secondary)" }}>
                  Nothing logged yet — your macros will fill in as you log meals.
                </p>
              )}
            </div>
          )}
        </GlassPanel>

        {/* Water */}
        <GlassPanel className="flex flex-col items-center gap-2 p-6">
          <h2 className="t-meta self-start">Hydration</h2>
          {waterStatus === "loading" ? (
            <SectionSkeleton className="h-44 w-44 rounded-full" />
          ) : waterStatus === "error" ? (
            <ErrorStateLux
              title="Couldn't load water intake"
              message="Your water log is unavailable right now — we're not assuming zero."
              onRetry={() => void loadWater()}
              retryLabel="Retry"
              className="mt-2"
            />
          ) : (
            <>
              <div className="relative">
                <ProgressRing value={waterPct} size={150} showValue={false} label="Water intake vs goal" />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="t-numeral text-3xl">{(waterMl / 1000).toFixed(1)}</span>
                  <span className="t-meta mt-1">
                    of <span className="t-numeral">{(targets.waterMl / 1000).toFixed(1)}</span> L
                  </span>
                </div>
              </div>
              {waterStatus === "empty" ? (
                <p className="t-body text-center" style={{ color: "var(--text-secondary)" }}>
                  No water logged yet today.
                </p>
              ) : (
                <p className="t-body text-center" style={{ color: "var(--text-secondary)" }} aria-live="polite">
                  <span className="t-numeral">{waterMl.toLocaleString()}</span> ml of{" "}
                  <span className="t-numeral">{targets.waterMl.toLocaleString()}</span> ml
                </p>
              )}
              <div
                className="mt-1 flex w-full gap-2"
                role="progressbar"
                aria-label={`Water ${waterMl} of ${targets.waterMl} milliliters`}
                aria-valuenow={waterMl}
                aria-valuemin={0}
                aria-valuemax={targets.waterMl}
              >
                {[250, 500].map((amt) => (
                  <LuxButton
                    key={amt}
                    variant="secondary"
                    className="flex-1 px-3"
                    disabled={waterBusy}
                    onClick={() => void addWater(amt)}
                    aria-label={`Add ${amt} milliliters of water`}
                  >
                    +{amt} ml
                  </LuxButton>
                ))}
              </div>
            </>
          )}
        </GlassPanel>
      </div>

      {/* ---------------------- coordinated metrics ----------------------- */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Water today"
          value={
            waterStatus === "loading" ? (
              <Skeleton className="h-8 w-24" />
            ) : waterStatus === "error" ? (
              <span className="text-xl" style={{ color: "var(--text-secondary)" }}>
                Unavailable
              </span>
            ) : (
              <span className="t-numeral">{(waterMl / 1000).toFixed(1)} L</span>
            )
          }
          subtext={
            waterStatus === "error"
              ? "Couldn't load — retry in the hydration card"
              : `of ${(targets.waterMl / 1000).toFixed(1)} L goal`
          }
          icon={<Droplets size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Weight · 30 days"
          value={
            progressStatus === "loading" ? (
              <Skeleton className="h-8 w-24" />
            ) : latestWeight ? (
              <span className="t-numeral">{latestWeight.value.toFixed(1)} kg</span>
            ) : (
              <span className="text-xl" style={{ color: "var(--text-secondary)" }}>
                —
              </span>
            )
          }
          delta={
            weightDelta != null
              ? `${weightDelta > 0 ? "+" : ""}${weightDelta.toFixed(1)} kg`
              : undefined
          }
          deltaTone="neutral"
          subtext={
            progressStatus === "error"
              ? "Couldn't load — see the trend card to retry"
              : progressStatus === "empty"
                ? "No weigh-ins yet"
                : "neutral trend info, not a verdict"
          }
          icon={<Scale size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Today's training"
          value={
            workoutPlansStatus === "loading" ? (
              <Skeleton className="h-8 w-24" />
            ) : todaysWorkout ? (
              <span className="text-xl font-semibold">{todaysWorkout.label}</span>
            ) : (
              <span className="text-xl" style={{ color: "var(--text-secondary)" }}>
                No plan
              </span>
            )
          }
          subtext={
            workoutPlansStatus === "error"
              ? "Couldn't load plans"
              : (todaysWorkout?.detail ?? "Generate a plan to get started")
          }
          icon={<Dumbbell size={18} aria-hidden="true" />}
        />
      </div>

      {/* ----------------- workout + weight trend ------------------------- */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GlassPanel className="p-6">
          <h2 className="t-meta">Today&apos;s workout</h2>
          {workoutPlansStatus === "loading" ? (
            <SectionSkeleton className="mt-3 h-40" />
          ) : workoutPlansStatus === "error" ? (
            <div className="mt-3">
              <ErrorStateLux
                title="Couldn't load workout plans"
                message="Your training plan is unavailable right now."
                onRetry={() => void loadWorkoutPlans()}
                retryLabel="Retry"
                className="mt-2"
              />
            </div>
          ) : todaysWorkout ? (
            <div className="mt-3">
              {showAnimation && todaysWorkout.firstSlug && (
                <MediaPanelLux label={todaysWorkout.label} className="mb-4">
                  <ExerciseAnimation slug={todaysWorkout.firstSlug} label={todaysWorkout.label} />
                </MediaPanelLux>
              )}
              <p className="t-card-heading">{todaysWorkout.label}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {todaysWorkout.exerciseCount > 0 && (
                  <LuxBadge tone="accent">
                    <span className="t-numeral">{todaysWorkout.exerciseCount}</span>&nbsp;exercises
                  </LuxBadge>
                )}
                {todaysWorkout.durationMin != null && (
                  <LuxBadge>
                    <span className="t-numeral">{todaysWorkout.durationMin}</span>&nbsp;min
                  </LuxBadge>
                )}
                {todaysWorkout.kind === "rest" && <LuxBadge>Rest day</LuxBadge>}
              </div>
              <p className="t-body mt-2" style={{ color: "var(--text-secondary)" }}>
                {todaysWorkout.detail}
              </p>
            </div>
          ) : (
            <p className="t-body mt-3" style={{ color: "var(--text-secondary)" }}>
              No workout plan yet. Generate one to get started.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <LuxButton variant="secondary" onClick={go("/workouts")}>
              Go to workouts
            </LuxButton>
          </div>
          <p className="t-meta mt-4">
            Stop exercising and seek medical attention if you feel chest pain, dizziness, or
            unusual shortness of breath.
          </p>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h2 className="t-meta">Weight trend · 30 days</h2>
          {progressStatus === "loading" ? (
            <SectionSkeleton className="mt-3 h-44" />
          ) : progressStatus === "error" ? (
            <div className="mt-3">
              <ErrorStateLux
                title="Couldn't load your progress"
                message="Your weight history is unavailable right now."
                onRetry={() => void loadProgress()}
                retryLabel="Retry"
                className="mt-2"
              />
            </div>
          ) : weightSeries.length >= 2 ? (
            <div className="mt-2 h-44" role="img" aria-label={`Weight trend chart with ${weightSeries.length} points`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weightSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} interval="preserveStartEnd" stroke="var(--text-secondary)" />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} stroke="var(--text-secondary)" />
                  <Tooltip formatter={(v) => [`${v} kg`, "Weight"]} labelFormatter={(d) => `Date: ${d}`} />
                  <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyStateLux
              className="mt-3 border-0 bg-transparent p-6 shadow-none"
              icon={<Scale size={22} aria-hidden="true" />}
              title="No weight history yet"
              message="Log your weight to see your trend here. Every bit of progress toward your goal counts."
            />
          )}
          <div className="mt-4">
            <LuxButton variant="secondary" onClick={go("/progress")}>
              View progress
            </LuxButton>
          </div>
        </GlassPanel>
      </div>

      {/* ------------------------- quick actions -------------------------- */}
      <GlassPanel className="mt-4 p-6">
        <h2 className="t-meta">Quick actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { href: "/scanner", label: "Scan Food", icon: <Camera size={18} aria-hidden="true" /> },
            { href: "/nutrition", label: "Log Meal", icon: <UtensilsCrossed size={18} aria-hidden="true" /> },
            { href: "/workouts", label: "Start Workout", icon: <Dumbbell size={18} aria-hidden="true" /> },
            { href: "/coach", label: "Ask AI Coach", icon: <Sparkles size={18} aria-hidden="true" /> },
          ].map((a) => (
            <LuxButton key={a.href} className="w-full" onClick={go(a.href)}>
              {a.icon}
              {a.label}
            </LuxButton>
          ))}
        </div>
      </GlassPanel>

      {/* ------------- habits + recent activity + recipe picks ------------ */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-6">
          <h2 className="flex items-center gap-2 t-card-heading">
            <ClipboardCheck size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
            Today&apos;s habits
          </h2>
          <ul className="mt-4 space-y-3">
            {habits.map((h) => (
              <li key={h.label} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{
                    color: h.done ? "var(--accent)" : "var(--text-secondary)",
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {h.done ? <Check size={16} /> : <Circle size={16} />}
                </span>
                <div className="min-w-0">
                  <p className="t-body font-medium">{h.label}</p>
                  {h.hint && <p className="t-meta">{h.hint}</p>}
                </div>
              </li>
            ))}
          </ul>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h2 className="flex items-center gap-2 t-card-heading">
            <Activity size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
            Recently logged
          </h2>
          {diaryStatus === "loading" ? (
            <div className="mt-4 space-y-2">
              <SectionSkeleton className="h-10" />
              <SectionSkeleton className="h-10" />
            </div>
          ) : diaryStatus === "error" ? (
            <p className="t-body mt-4" style={{ color: "var(--text-secondary)" }}>
              Today&apos;s activity is unavailable — retry in the calories card above.
            </p>
          ) : recentEntries.length === 0 ? (
            <p className="t-body mt-4" style={{ color: "var(--text-secondary)" }}>
              Nothing logged today yet — your meals will appear here as you log them.
            </p>
          ) : (
            <ul className="mt-4 divide-y" style={{ borderColor: "var(--border)" }}>
              {recentEntries.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="t-body truncate">
                    {typeof (e as { customName?: unknown }).customName === "string"
                      ? ((e as { customName?: string }).customName as string)
                      : "Logged food"}
                  </span>
                  <span className="t-meta shrink-0">
                    <span className="t-numeral">{Math.round(num(e.kcal))}</span> kcal
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <LuxButton variant="ghost" className="px-0" onClick={go("/nutrition")}>
              Open food diary
            </LuxButton>
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="anim-hover-lift mt-4 flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{
              color: "var(--accent)",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            <ChefHat size={22} />
          </span>
          <div>
            <h2 className="t-card-heading">Recipe picks</h2>
            <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
              Browse the recipe collection for ideas that fit your targets.
            </p>
          </div>
        </div>
        <LuxButton variant="secondary" onClick={go("/recipes")}>
          Browse recipes
        </LuxButton>
      </GlassPanel>
    </div>
  );
}
