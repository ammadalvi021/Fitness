"use client";

/**
 * /workouts — weekly workout schedule.
 *
 * - Loads the latest plan from GET /api/workouts/plans
 * - Generates a plan via POST /api/workouts/plans/generate (403 plan_required -> upgrade gate)
 * - Shows profile exerciseRestrictions in the plan header + safety copy
 * - Per workout day: "Start session" creates POST /api/workouts/sessions and
 *   hands the day snapshot to the session player via sessionStorage
 * - Reschedule-missed affordance for past workout days
 * - Recent workout history (from GET /api/progress)
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import {
  NormalizedPlanDay,
  SessionSnapshot,
  WORKOUT_SAFETY_COPY,
  WorkoutPlanShape,
  asStringArray,
  formatShortDate,
  normalizePlanDays,
  pickArray,
  pickObject,
  sessionStorageKey,
  toNumber,
  toString,
} from "./_shared";

interface ProfileShape {
  fitnessExperience?: string | null;
  workoutLocation?: string | null;
  workoutDays?: string[] | null;
  workoutMinutesPerDay?: number | null;
  equipment?: string[] | null;
  exerciseRestrictions?: string | null;
  goal?: string | null;
}

interface HistoryEntry {
  date: string;
  name: string;
  detail?: string;
}

function normalizeHistory(data: unknown): HistoryEntry[] {
  return pickArray<Record<string, unknown>>(data, "workouts").map((w) => {
    const date =
      toString(w.date) ?? toString(w.startedAt) ?? toString(w.day) ?? "";
    const name = toString(w.name) ?? toString(w.title) ?? "Workout";
    const bits: string[] = [];
    const sets = toNumber(w.sets) ?? toNumber(w.totalSets);
    const mins = toNumber(w.durationMin) ?? toNumber(w.durationMinutes);
    const vol = toNumber(w.volumeKg) ?? toNumber(w.volume);
    if (sets != null) bits.push(`${sets} sets`);
    if (mins != null) bits.push(`${Math.round(mins)} min`);
    if (vol != null) bits.push(`${Math.round(vol)} kg volume`);
    return { date, name, detail: bits.length ? bits.join(" · ") : undefined };
  });
}

export default function WorkoutsPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<WorkoutPlanShape[]>([]);
  const [profile, setProfile] = useState<ProfileShape | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [gated, setGated] = useState(false);
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plansRes, profileRes, progressRes] = await Promise.all([
        api<unknown>("/api/workouts/plans").catch(() => null),
        api<unknown>("/api/profile").catch(() => null),
        api<unknown>("/api/progress?days=30").catch(() => null),
      ]);
      const list = pickArray<WorkoutPlanShape>(plansRes, "plans");
      list.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
      setPlans(list);
      setProfile(pickObject<ProfileShape>(profileRes, "profile"));
      setHistory(normalizeHistory(progressRes));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your workouts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plan = plans[0] ?? null;
  const days: NormalizedPlanDay[] = plan ? normalizePlanDays(plan.days) : [];

  async function handleGenerate() {
    setGenerating(true);
    setGated(false);
    setError(null);
    try {
      await api("/api/workouts/plans/generate", { method: "POST", body: {} });
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && e.code === "plan_required") {
        setGated(true);
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't generate a plan. Please try again.");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function startSession(day: NormalizedPlanDay, rescheduled: boolean) {
    const label = rescheduled ? `${day.label}'s workout (rescheduled)` : `${day.label} workout`;
    setStartingKey(`${day.dayIndex}-${rescheduled ? "r" : "s"}`);
    try {
      const res = await api<unknown>("/api/workouts/sessions", {
        method: "POST",
        body: { name: label, workoutPlanId: plan?.id },
      });
      const session = pickObject<{ id: string; name?: string; startedAt?: string }>(res, "session") ?? {
        id: "",
        name: label,
        startedAt: new Date().toISOString(),
      };
      if (!session.id) throw new Error("The server didn't return a session id.");
      const snapshot: SessionSnapshot = {
        sessionId: session.id,
        sessionName: session.name ?? label,
        startedAt: session.startedAt ?? new Date().toISOString(),
        planId: plan?.id,
        dayLabel: day.label,
        exercises: day.exercises,
      };
      sessionStorage.setItem(sessionStorageKey(session.id), JSON.stringify(snapshot));
      router.push(`/workouts/session/${session.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start the session. Please try again.");
      setStartingKey(null);
    }
  }

  // Monday-first index of today, to match DAY_NAMES.
  const todayIdx = (new Date().getDay() + 6) % 7;

  const prefs: string[] = [];
  if (profile?.workoutDays?.length) prefs.push(`${profile.workoutDays.length} days/week`);
  if (profile?.workoutMinutesPerDay) prefs.push(`${profile.workoutMinutesPerDay} min/session`);
  if (profile?.workoutLocation) prefs.push(profile.workoutLocation);
  if (profile?.equipment?.length) prefs.push(asStringArray(profile.equipment).slice(0, 4).join(", "));
  if (profile?.fitnessExperience) prefs.push(profile.fitnessExperience);

  return (
    <div>
      <PageHeader
        title="Workouts"
        subtitle="Your weekly training schedule, exercise library, and live sessions."
        actions={
          <>
            <Link href="/workouts/library">
              <Button variant="secondary">Exercise library</Button>
            </Link>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? "Generating…" : plan ? "Regenerate plan" : "Generate plan"}
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="space-y-3" aria-label="Loading workouts">
          <Skeleton className="h-24" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {error ? (
            <Card className="mb-4 border-red-200 dark:border-red-900">
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
              <Button variant="secondary" className="mt-3" onClick={() => void load()}>
                Try again
              </Button>
            </Card>
          ) : null}

          {gated ? (
            <Card className="mb-4 border-amber-300 dark:border-amber-800">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Workout plans need the Diet + Exercise plan
              </h2>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Your current plan doesn&apos;t include generated workout plans. Upgrade to
                unlock personalized weekly training built around your goals, equipment,
                and schedule.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/plans">
                  <Button>View plans</Button>
                </Link>
                <Button variant="secondary" onClick={() => setGated(false)}>
                  Dismiss
                </Button>
              </div>
            </Card>
          ) : null}

          {/* Plan header: preferences + restrictions + safety */}
          {plan ? (
            <Card className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Week of {plan.weekStart ? formatShortDate(String(plan.weekStart)) : "your plan"}
                </h2>
                {plan.generatedBy ? <Badge tone="blue">{plan.generatedBy}</Badge> : null}
              </div>
              {prefs.length ? (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Built for: {prefs.join(" · ")}
                </p>
              ) : null}
              {profile?.exerciseRestrictions ? (
                <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                  <strong>Your noted restrictions:</strong> {profile.exerciseRestrictions}. This
                  plan was generated with them in mind — skip anything that doesn&apos;t feel
                  right and talk to a qualified professional about alternatives.
                </p>
              ) : null}
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{WORKOUT_SAFETY_COPY}</p>
            </Card>
          ) : null}

          {!plan && !gated ? (
            <EmptyState
              title="No workout plan yet"
              message="Generate a weekly plan tailored to your goal, experience, equipment, and available days. It takes a few seconds."
              action={<Button onClick={handleGenerate} disabled={generating}>{generating ? "Generating…" : "Generate my plan"}</Button>}
            />
          ) : null}

          {profile?.fitnessExperience === "beginner" && plan ? (
            <Card className="mb-4 border-sky-200 dark:border-sky-900">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                <strong>New to training?</strong> Every exercise page includes an easier
                variation — start there and build up gradually.{" "}
                <Link href="/workouts/library" className="font-semibold text-brand underline">
                  Browse the exercise library
                </Link>
              </p>
            </Card>
          ) : null}

          {/* Weekly schedule */}
          {plan && days.length ? (
            <section aria-label="Weekly schedule" className="mt-2">
              <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                This week
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {days.map((day) => {
                  const missed = !day.isRest && day.dayIndex < todayIdx;
                  const startKey = `${day.dayIndex}-s`;
                  const reschedKey = `${day.dayIndex}-r`;
                  return (
                    <Card
                      key={day.dayIndex}
                      className={day.dayIndex === todayIdx ? "ring-2 ring-brand" : ""}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                            {day.label}
                          </h3>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">{day.title}</p>
                        </div>
                        <div className="flex gap-1.5">
                          {day.dayIndex === todayIdx ? <Badge tone="blue">Today</Badge> : null}
                          {day.isRest ? <Badge>Rest</Badge> : null}
                          {missed ? <Badge tone="amber">Missed</Badge> : null}
                        </div>
                      </div>

                      {!day.isRest && day.exercises.length ? (
                        <ul className="mt-3 space-y-2">
                          {day.exercises.map((ex) => (
                            <li
                              key={ex.key}
                              className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60"
                            >
                              <div className="min-w-0">
                                {ex.slug ? (
                                  <Link
                                    href={`/workouts/library/${ex.slug}`}
                                    className="truncate text-sm font-medium text-brand hover:underline"
                                  >
                                    {ex.name}
                                  </Link>
                                ) : (
                                  <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                    {ex.name}
                                  </span>
                                )}
                                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                  {ex.sets} × {ex.reps}
                                  {ex.weightKg ? ` · ${ex.weightKg} kg` : ""}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {day.isRest ? (
                        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
                          Recovery day — light walking, stretching, or full rest.
                        </p>
                      ) : null}

                      {!day.isRest ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => void startSession(day, false)}
                            disabled={startingKey !== null}
                            aria-label={`Start ${day.label} workout session`}
                          >
                            {startingKey === startKey ? "Starting…" : "Start session"}
                          </Button>
                          {missed ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void startSession(day, true)}
                              disabled={startingKey !== null}
                              aria-label={`Reschedule missed ${day.label} workout to today`}
                            >
                              {startingKey === reschedKey ? "Starting…" : "Reschedule to today"}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Workout history */}
          <section aria-label="Workout history" className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Recent sessions
            </h2>
            {history.length ? (
              <Card>
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {history.slice(0, 10).map((h, i) => (
                    <li key={`${h.date}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{h.name}</p>
                        {h.detail ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">{h.detail}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                        {h.date ? formatShortDate(h.date) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <EmptyState
                title="No sessions logged yet"
                message="Your completed workouts will show up here. Start a session from your weekly plan to log your first one."
              />
            )}
          </section>

          <p className="mt-8 text-xs text-neutral-500 dark:text-neutral-400">{WORKOUT_SAFETY_COPY}</p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Plans respect the limits you disclosed in your profile. If anything in this
            plan conflicts with medical advice you&apos;ve received, follow your
            professional&apos;s guidance instead.
          </p>
        </>
      )}
    </div>
  );
}
