"use client";

/**
 * /workouts — weekly workout schedule (Obsidian Gold luxury presentation).
 *
 * - Loads the latest plan from GET /api/workouts/plans
 * - Generates a plan via POST /api/workouts/plans/generate (403 plan_required -> upgrade gate)
 * - Shows profile exerciseRestrictions in the plan header + safety copy
 * - Per workout day: "Start session" creates POST /api/workouts/sessions and
 *   hands the day snapshot to the session player via sessionStorage
 * - Reschedule-missed affordance for past workout days
 * - Recent workout history (from GET /api/progress)
 *
 * PRESENTATION ONLY: all data flow, gating, and API behavior are unchanged.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Crown,
  Dumbbell,
  History,
  Info,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import {
  EmptyStateLux,
  ErrorStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
} from "@/components/luxury";
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

const secondaryText = { color: "var(--text-secondary)" } as const;

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
    <div className="anim-page-enter">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">Workouts</h1>
          <p className="mt-1 text-sm" style={secondaryText}>
            Your weekly training schedule, exercise library, and live sessions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/workouts/library">
            <LuxButton variant="secondary">
              <BookOpen size={17} aria-hidden="true" />
              Exercise library
            </LuxButton>
          </Link>
          <LuxButton onClick={handleGenerate} disabled={generating}>
            <Sparkles size={17} aria-hidden="true" />
            {generating ? "Generating…" : plan ? "Regenerate plan" : "Generate plan"}
          </LuxButton>
        </div>
      </div>

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
            <ErrorStateLux
              title="Couldn't load your workouts"
              message={error}
              onRetry={() => void load()}
              retryLabel="Try again"
              className="mb-4"
            />
          ) : null}

          {/* Upgrade gate — premium treatment, gating logic and copy unchanged. */}
          {gated ? (
            <GlassPanel
              className="anim-page-enter relative mb-4 p-6 pt-7"
              style={{ border: "1px solid var(--accent)" }}
            >
              <div className="absolute -top-3 left-6">
                <LuxBadge tone="accent">
                  <Crown size={13} aria-hidden="true" />
                  Premium
                </LuxBadge>
              </div>
              <h2 className="t-card-heading">
                Workout plans need the Diet + Exercise plan
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed" style={secondaryText}>
                Your current plan doesn&apos;t include generated workout plans. Upgrade to
                unlock personalized weekly training built around your goals, equipment,
                and schedule.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/plans">
                  <LuxButton>View plans</LuxButton>
                </Link>
                <LuxButton variant="secondary" onClick={() => setGated(false)}>
                  Dismiss
                </LuxButton>
              </div>
            </GlassPanel>
          ) : null}

          {/* Plan header: preferences + restrictions + safety */}
          {plan ? (
            <GlassPanel className="mb-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="t-card-heading">
                  Week of {plan.weekStart ? formatShortDate(String(plan.weekStart)) : "your plan"}
                </h2>
                {plan.generatedBy ? <LuxBadge>{plan.generatedBy}</LuxBadge> : null}
              </div>
              {prefs.length ? (
                <p className="mt-1.5 text-sm" style={secondaryText}>
                  Built for: {prefs.join(" · ")}
                </p>
              ) : null}
              {profile?.exerciseRestrictions ? (
                <div
                  className="mt-3 flex gap-3 rounded-xl p-3"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--warning) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--warning) 40%, transparent)",
                  }}
                >
                  <AlertTriangle
                    size={18}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                    style={{ color: "var(--warning)" }}
                  />
                  <p className="text-sm leading-relaxed">
                    <strong>Your noted restrictions:</strong> {profile.exerciseRestrictions}. This
                    plan was generated with them in mind — skip anything that doesn&apos;t feel
                    right and talk to a qualified professional about alternatives.
                  </p>
                </div>
              ) : null}
              <p className="mt-3 text-xs leading-relaxed" style={secondaryText}>
                {WORKOUT_SAFETY_COPY}
              </p>
            </GlassPanel>
          ) : null}

          {!plan && !gated ? (
            <EmptyStateLux
              icon={<Dumbbell size={22} aria-hidden="true" />}
              title="No workout plan yet"
              message="Generate a weekly plan tailored to your goal, experience, equipment, and available days. It takes a few seconds."
              action={
                <LuxButton onClick={handleGenerate} disabled={generating}>
                  <Sparkles size={17} aria-hidden="true" />
                  {generating ? "Generating…" : "Generate my plan"}
                </LuxButton>
              }
            />
          ) : null}

          {profile?.fitnessExperience === "beginner" && plan ? (
            <GlassPanel className="mb-4 flex gap-3 p-4">
              <Info
                size={18}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                style={{ color: "var(--accent)" }}
              />
              <p className="text-sm leading-relaxed">
                <strong>New to training?</strong> Every exercise page includes an easier
                variation — start there and build up gradually.{" "}
                <Link
                  href="/workouts/library"
                  className="font-semibold underline"
                  style={{ color: "var(--accent)" }}
                >
                  Browse the exercise library
                </Link>
              </p>
            </GlassPanel>
          ) : null}

          {/* Weekly schedule */}
          {plan && days.length ? (
            <section aria-label="Weekly schedule" className="mt-2">
              <h2 className="t-card-heading mb-3">This week</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {days.map((day) => {
                  const missed = !day.isRest && day.dayIndex < todayIdx;
                  const startKey = `${day.dayIndex}-s`;
                  const reschedKey = `${day.dayIndex}-r`;
                  return (
                    <GlassPanel
                      key={day.dayIndex}
                      className="anim-hover-lift flex flex-col p-5"
                      style={
                        day.dayIndex === todayIdx
                          ? { border: "1px solid var(--accent)" }
                          : undefined
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="t-card-heading">{day.label}</h3>
                          <p className="text-xs" style={secondaryText}>{day.title}</p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {day.dayIndex === todayIdx ? <LuxBadge tone="accent">Today</LuxBadge> : null}
                          {day.isRest ? <LuxBadge>Rest</LuxBadge> : null}
                          {missed ? <LuxBadge tone="warning">Missed</LuxBadge> : null}
                        </div>
                      </div>

                      {!day.isRest && day.exercises.length ? (
                        <ul className="mt-3 space-y-2">
                          {day.exercises.map((ex) => (
                            <li
                              key={ex.key}
                              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                              style={{ backgroundColor: "var(--bg-secondary)" }}
                            >
                              <div className="min-w-0">
                                {ex.slug ? (
                                  <Link
                                    href={`/workouts/library/${ex.slug}`}
                                    className="block truncate text-sm font-medium hover:underline"
                                    style={{ color: "var(--accent)" }}
                                  >
                                    {ex.name}
                                  </Link>
                                ) : (
                                  <span className="block truncate text-sm font-medium">
                                    {ex.name}
                                  </span>
                                )}
                                <p className="text-xs" style={secondaryText}>
                                  {ex.sets} × {ex.reps}
                                  {ex.weightKg ? ` · ${ex.weightKg} kg` : ""}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {day.isRest ? (
                        <p className="mt-3 text-sm" style={secondaryText}>
                          Recovery day — light walking, stretching, or full rest.
                        </p>
                      ) : null}

                      {!day.isRest ? (
                        <div className="mt-3 flex flex-wrap gap-2 pt-1">
                          <LuxButton
                            onClick={() => void startSession(day, false)}
                            disabled={startingKey !== null}
                            aria-label={`Start ${day.label} workout session`}
                          >
                            <Play size={16} aria-hidden="true" />
                            {startingKey === startKey ? "Starting…" : "Start session"}
                          </LuxButton>
                          {missed ? (
                            <LuxButton
                              variant="secondary"
                              onClick={() => void startSession(day, true)}
                              disabled={startingKey !== null}
                              aria-label={`Reschedule missed ${day.label} workout to today`}
                            >
                              <RotateCcw size={16} aria-hidden="true" />
                              {startingKey === reschedKey ? "Starting…" : "Reschedule to today"}
                            </LuxButton>
                          ) : null}
                        </div>
                      ) : null}
                    </GlassPanel>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Workout history */}
          <section aria-label="Workout history" className="mt-8">
            <h2 className="t-card-heading mb-3">Recent sessions</h2>
            {history.length ? (
              <GlassPanel className="px-5 py-2">
                <ul>
                  {history.slice(0, 10).map((h, i) => (
                    <li
                      key={`${h.date}-${i}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                      style={{
                        borderBottom:
                          i < Math.min(10, history.length) - 1
                            ? "1px solid var(--border)"
                            : undefined,
                      }}
                    >
                      <div>
                        <p className="text-sm font-medium">{h.name}</p>
                        {h.detail ? (
                          <p className="text-xs" style={secondaryText}>{h.detail}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs" style={secondaryText}>
                        {h.date ? formatShortDate(h.date) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </GlassPanel>
            ) : (
              <EmptyStateLux
                icon={<History size={22} aria-hidden="true" />}
                title="No sessions logged yet"
                message="Your completed workouts will show up here. Start a session from your weekly plan to log your first one."
              />
            )}
          </section>

          <p className="mt-8 text-xs leading-relaxed" style={secondaryText}>
            {WORKOUT_SAFETY_COPY}
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={secondaryText}>
            Plans respect the limits you disclosed in your profile. If anything in this
            plan conflicts with medical advice you&apos;ve received, follow your
            professional&apos;s guidance instead.
          </p>
        </>
      )}
    </div>
  );
}
