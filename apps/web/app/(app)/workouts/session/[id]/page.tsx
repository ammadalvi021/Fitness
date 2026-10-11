"use client";

/**
 * /workouts/session/[id] — live workout session player
 * (Obsidian Gold luxury presentation).
 *
 * The session snapshot (exercises, sets, reps, rest) is handed over via
 * sessionStorage by the workouts page at creation time — there is no
 * GET /api/workouts/sessions/[id] in the contract, so a direct visit without
 * a snapshot shows a graceful recovery state.
 *
 * Finish flow: POST /api/workouts/sessions/[id]/logs per completed exercise,
 * then PATCH /api/workouts/sessions/[id] {status:'completed', endedAt}.
 *
 * PRESENTATION ONLY: session flow, timers, set logging, rest periods, and
 * completion behavior are unchanged. Restyled for mid-workout legibility:
 * large tabular numerals, gold progress, 44px+ touch targets, compact
 * animated demonstration of the current exercise.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SkipForward,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Input, Skeleton } from "@/components/ui";
import {
  EmptyStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
  LuxDialog,
  MetricCard,
  ProgressBar,
  ProgressRing,
} from "@/components/luxury";
import {
  Exercise,
  SessionSnapshot,
  SnapshotExercise,
  WORKOUT_SAFETY_COPY,
  asStringArray,
  pickArray,
  sessionStorageKey,
} from "../../_shared";
import { formatClock, parseLeadingNumber } from "../../_lux";
import {
  ExerciseAnimation,
  hasExerciseAnimation,
} from "@/components/ExerciseAnimation";

type Phase = "loading" | "ready" | "missing" | "finishing" | "done";

interface SetRow {
  reps: string;
  weightKg: string;
  done: boolean;
}

interface RuntimeExercise extends Omit<SnapshotExercise, "sets"> {
  sets: SetRow[];
  skipped: boolean;
  wasReplaced: boolean;
}

interface RestState {
  totalSec: number;
  endsAt: number; // timestamp ms (when running)
  paused: boolean;
  remainingMs: number; // used when paused
}

const secondaryText = { color: "var(--text-secondary)" } as const;

/* ------------------------------- Audio beep ------------------------------ */
function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const init = () => {
      try {
        if (!ctxRef.current) {
          const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctor) {
            ctxRef.current = new Ctor();
            if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
          }
        }
      } catch {
        /* audio unavailable — silent */
      }
    };
    window.addEventListener("pointerdown", init, { once: true });
    return () => window.removeEventListener("pointerdown", init);
  }, []);

  return (freq = 880, durationSec = 0.5, whenMs = 0) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + whenMs / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
      osc.start(t0);
      osc.stop(t0 + durationSec + 0.05);
    } catch {
      /* ignore */
    }
  };
}

function toRuntime(ex: SnapshotExercise): RuntimeExercise {
  return {
    ...ex,
    sets: Array.from({ length: Math.max(1, ex.sets) }, () => ({
      reps: ex.reps,
      weightKg: ex.weightKg != null ? String(ex.weightKg) : "",
      done: false,
    })),
    skipped: false,
    wasReplaced: false,
  };
}

export default function SessionPlayerPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const beep = useBeep();

  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [exercises, setExercises] = useState<RuntimeExercise[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [library, setLibrary] = useState<Exercise[]>([]);
  const [finishError, setFinishError] = useState<string | null>(null);

  // Session elapsed clock
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startedAtRef = useRef(0);
  const pausedAccumRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);

  // Rest timer
  const [rest, setRest] = useState<RestState | null>(null);
  const restRangRef = useRef(false);
  const [liveMessage, setLiveMessage] = useState("");

  // Replace-exercise modal
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");

  // End-early confirm
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  /* ------------------------------ Load snapshot ----------------------------- */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(sessionStorageKey(id));
      if (!raw) {
        setPhase("missing");
        return;
      }
      const snap = JSON.parse(raw) as SessionSnapshot;
      if (!snap || !Array.isArray(snap.exercises)) {
        setPhase("missing");
        return;
      }
      setSnapshot(snap);
      setExercises(snap.exercises.map(toRuntime));
      startedAtRef.current = new Date(snap.startedAt).getTime() || Date.now();
      setNowMs(Date.now());
      setPhase("ready");
    } catch {
      setPhase("missing");
    }
  }, [id]);

  /* Fetch the library once: resolves slugs -> ids for logs, powers "replace". */
  useEffect(() => {
    let cancelled = false;
    api<unknown>("/api/exercises")
      .then((res) => {
        if (!cancelled) setLibrary(pickArray<Exercise>(res, "exercises"));
      })
      .catch(() => {
        /* logs fall back to slug identifiers */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------- Tick clock -------------------------------- */
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const elapsedMs =
    nowMs -
    startedAtRef.current -
    pausedAccumRef.current -
    (pauseStartRef.current != null ? nowMs - pauseStartRef.current : 0);

  /* ------------------------------ Rest timer --------------------------------- */
  const restRemainingMs = rest
    ? rest.paused
      ? rest.remainingMs
      : Math.max(0, rest.endsAt - nowMs)
    : 0;

  useEffect(() => {
    if (rest && !rest.paused && rest.endsAt - Date.now() <= 0 && !restRangRef.current) {
      restRangRef.current = true;
      beep(880, 0.6);
      beep(880, 0.6, 700);
      setRest(null);
      setLiveMessage("Rest over. Start your next set.");
    }
  }, [nowMs, rest, beep]);

  function startRest(seconds: number) {
    const total = Math.max(5, Math.round(seconds));
    restRangRef.current = false;
    setRest({ totalSec: total, endsAt: Date.now() + total * 1000, paused: false, remainingMs: total * 1000 });
    setLiveMessage(`Rest started: ${total} seconds.`);
  }

  function togglePauseRest() {
    setRest((r) => {
      if (!r) return r;
      if (r.paused) {
        return { ...r, paused: false, endsAt: Date.now() + r.remainingMs };
      }
      return { ...r, paused: true, remainingMs: Math.max(0, r.endsAt - Date.now()) };
    });
  }

  /* --------------------------- Warn before leaving --------------------------- */
  useEffect(() => {
    if (phase !== "ready") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  /* --------------------------------- Actions --------------------------------- */
  const current = exercises[currentIdx] ?? null;
  const activeExercises = useMemo(() => exercises.filter((e) => !e.skipped), [exercises]);

  function updateSet(exIdx: number, setIdx: number, patch: Partial<SetRow>) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx
          ? { ...ex, sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, ...patch } : s)) }
          : ex
      )
    );
  }

  function completeSet(exIdx: number, setIdx: number) {
    const ex = exercises[exIdx];
    if (!ex || ex.sets[setIdx]?.done) return;
    updateSet(exIdx, setIdx, { done: true });
    const remaining = ex.sets.filter((s, j) => j !== setIdx && !s.done).length;
    if (remaining > 0) startRest(ex.restSeconds);
    else {
      setLiveMessage(`${ex.name} complete.`);
      beep(660, 0.4);
    }
  }

  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx
          ? {
              ...ex,
              sets: [
                ...ex.sets,
                {
                  reps: ex.sets[ex.sets.length - 1]?.reps ?? ex.reps,
                  weightKg: ex.sets[ex.sets.length - 1]?.weightKg ?? "",
                  done: false,
                },
              ],
            }
          : ex
      )
    );
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx && ex.sets.length > 1
          ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) }
          : ex
      )
    );
  }

  function skipExercise(exIdx: number) {
    setExercises((prev) => prev.map((ex, i) => (i === exIdx ? { ...ex, skipped: true } : ex)));
    setLiveMessage(`${exercises[exIdx]?.name ?? "Exercise"} skipped.`);
    if (exIdx === currentIdx && exIdx < exercises.length - 1) setCurrentIdx(exIdx + 1);
  }

  function undoSkip(exIdx: number) {
    setExercises((prev) => prev.map((ex, i) => (i === exIdx ? { ...ex, skipped: false } : ex)));
  }

  function replaceExercise(lib: Exercise) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === currentIdx
          ? {
              ...toRuntime({
                key: `${lib.slug}-replaced-${Date.now()}`,
                slug: lib.slug,
                exerciseId: lib.id,
                name: lib.name,
                sets: 3,
                reps: "10",
                restSeconds: 90,
                weightKg: null,
              }),
              wasReplaced: true,
            }
          : ex
      )
    );
    setReplaceOpen(false);
    setReplaceQuery("");
    setLiveMessage(`Swapped in ${lib.name}.`);
  }

  function togglePauseSession() {
    if (paused) {
      if (pauseStartRef.current != null) {
        pausedAccumRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
      }
      setPaused(false);
    } else {
      pauseStartRef.current = Date.now();
      setPaused(true);
    }
  }

  /* --------------------------------- Finish ---------------------------------- */
  const idBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of library) {
      m.set(e.slug, e.id);
      m.set(e.slug.toLowerCase(), e.id);
      m.set(e.name.toLowerCase(), e.id);
    }
    return m;
  }, [library]);

  function resolveExerciseId(ex: RuntimeExercise): string {
    if (ex.exerciseId) return ex.exerciseId;
    if (ex.slug && idBySlug.has(ex.slug)) return idBySlug.get(ex.slug) as string;
    const byName = ex.name.toLowerCase();
    if (idBySlug.has(byName)) return idBySlug.get(byName) as string;
    return ex.slug ?? ex.key; // last resort: the API can resolve or reject honestly
  }

  async function finishSession() {
    setPhase("finishing");
    setFinishError(null);
    setEndConfirmOpen(false);
    try {
      const completed = exercises.filter((e) => !e.skipped && e.sets.some((s) => s.done));
      for (const ex of completed) {
        const sets = ex.sets
          .filter((s) => s.done)
          .map((s) => ({
            reps: parseLeadingNumber(s.reps),
            weightKg: parseLeadingNumber(s.weightKg),
            completed: true,
          }));
        await api(`/api/workouts/sessions/${id}/logs`, {
          method: "POST",
          body: {
            exerciseId: resolveExerciseId(ex),
            sets,
            notes: ex.wasReplaced ? "Replacement exercise chosen mid-session" : undefined,
          },
        });
      }
      await api(`/api/workouts/sessions/${id}`, {
        method: "PATCH",
        body: { status: "completed", endedAt: new Date().toISOString() },
      });
      try {
        sessionStorage.removeItem(sessionStorageKey(id));
      } catch {
        /* ignore */
      }
      setPhase("done");
      window.scrollTo(0, 0);
    } catch (e) {
      setFinishError(
        e instanceof ApiError ? e.message : "Couldn't save your session. Please try again."
      );
      setPhase("ready");
    }
  }

  /* --------------------------------- Summary --------------------------------- */
  const summary = useMemo(() => {
    const doneSets = exercises.flatMap((e) => (e.skipped ? [] : e.sets.filter((s) => s.done)));
    const volume = doneSets.reduce(
      (sum, s) => sum + parseLeadingNumber(s.reps) * parseLeadingNumber(s.weightKg),
      0
    );
    const completedExercises = exercises.filter(
      (e) => !e.skipped && e.sets.some((s) => s.done)
    ).length;
    const durationMin = Math.max(1, Math.round(elapsedMs / 60000));
    return {
      doneSets: doneSets.length,
      volume,
      completedExercises,
      durationMin,
      kcal: Math.round(durationMin * 6), // rough estimate, labeled approximate
    };
  }, [exercises, elapsedMs]);

  const replaceResults = useMemo(() => {
    const needle = replaceQuery.trim().toLowerCase();
    if (!needle) return library.slice(0, 12);
    return library
      .filter((e) =>
        `${e.name} ${asStringArray(e.muscleGroups).join(" ")}`.toLowerCase().includes(needle)
      )
      .slice(0, 12);
  }, [library, replaceQuery]);

  /* --------------------------------- Render ---------------------------------- */
  if (phase === "loading") {
    return (
      <div className="space-y-4" aria-label="Loading session">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (phase === "missing") {
    return (
      <EmptyStateLux
        icon={<Dumbbell size={22} aria-hidden="true" />}
        title="We couldn't load this session"
        message="Session details are passed along when you start a workout from your plan, and this browser tab doesn't have them (for example, the link was opened directly or in a new tab). Start a fresh session from your weekly plan."
        action={
          <Link href="/workouts">
            <LuxButton>
              Back to workouts
            </LuxButton>
          </Link>
        }
      />
    );
  }

  if (phase === "done") {
    return (
      <div className="anim-page-enter mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="t-page-title">Session complete</h1>
          {snapshot?.sessionName ? (
            <p className="mt-1 text-sm" style={secondaryText}>
              {snapshot.sessionName}
            </p>
          ) : null}
        </div>
        <GlassPanel className="p-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Duration" value={formatClock(elapsedMs)} />
            <MetricCard
              label="Exercises"
              value={String(summary.completedExercises)}
              subtext={`of ${activeExercises.length} planned`}
            />
            <MetricCard label="Sets done" value={String(summary.doneSets)} />
            <MetricCard label="Volume" value={`${Math.round(summary.volume)} kg`} />
          </div>
          <p className="mt-4 text-sm">
            Estimated energy: <strong>≈ {summary.kcal} kcal</strong>{" "}
            <span className="text-xs" style={secondaryText}>(approximate)</span>
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={secondaryText}>
            {WORKOUT_SAFETY_COPY}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/workouts">
              <LuxButton>Back to workouts</LuxButton>
            </Link>
            <Link href="/progress">
              <LuxButton variant="secondary">View progress</LuxButton>
            </Link>
          </div>
        </GlassPanel>
      </div>
    );
  }

  if (!current) {
    return (
      <EmptyStateLux
        icon={<Dumbbell size={22} aria-hidden="true" />}
        title="This session has no exercises"
        message="Something went wrong building the workout. Please start a new session from your plan."
        action={
          <Link href="/workouts">
            <LuxButton>Back to workouts</LuxButton>
          </Link>
        }
      />
    );
  }

  const restPct = rest ? Math.min(1, Math.max(0, restRemainingMs / (rest.totalSec * 1000))) : 0;

  return (
    <div className="anim-page-enter mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">{snapshot?.sessionName ?? "Workout session"}</h1>
          <p className="mt-1 text-sm" style={secondaryText}>
            {snapshot?.dayLabel ? `${snapshot.dayLabel} · live session` : "Live session"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LuxButton variant="secondary" onClick={togglePauseSession} aria-pressed={paused}>
            {paused ? (
              <Play size={17} aria-hidden="true" />
            ) : (
              <Pause size={17} aria-hidden="true" />
            )}
            {paused ? "Resume" : "Pause"}
          </LuxButton>
          <LuxButton
            variant="secondary"
            onClick={() => setEndConfirmOpen(true)}
            style={{ borderColor: "var(--error)", color: "var(--error)" }}
          >
            <X size={17} aria-hidden="true" />
            End session
          </LuxButton>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {paused ? (
        <GlassPanel
          className="mb-4 flex items-center gap-3 p-4"
          style={{ border: "1px solid color-mix(in srgb, var(--warning) 45%, transparent)" }}
        >
          <AlertTriangle size={18} aria-hidden="true" style={{ color: "var(--warning)" }} />
          <p className="text-sm font-semibold">
            Session paused — the timer is stopped. Press Resume when you&apos;re ready.
          </p>
        </GlassPanel>
      ) : null}

      <p className="mb-4 text-xs leading-relaxed" style={secondaryText}>
        {WORKOUT_SAFETY_COPY}
      </p>

      {phase === "finishing" ? (
        <GlassPanel className="p-5">
          <p className="text-sm">Saving your session…</p>
          <Skeleton className="mt-3 h-4" />
        </GlassPanel>
      ) : (
        <>
          {/* Session clock */}
          <GlassPanel className="mb-4 p-5">
            <div className="grid items-center gap-4 sm:grid-cols-3">
              <div>
                <p className="t-meta">Elapsed</p>
                <p
                  className="t-numeral mt-1"
                  style={{ fontSize: "2.75rem", lineHeight: 1.05, color: "var(--accent)" }}
                  aria-label={`Elapsed time ${formatClock(elapsedMs)}`}
                >
                  {formatClock(elapsedMs)}
                </p>
              </div>
              <MetricCard
                label="Progress"
                value={`${summary.doneSets} sets`}
                subtext={`${summary.completedExercises} of ${activeExercises.length} exercises done`}
              />
              <MetricCard label="Volume" value={`${Math.round(summary.volume)} kg`} />
            </div>
            {finishError ? (
              <p role="alert" className="mt-3 text-sm font-medium" style={{ color: "var(--error)" }}>
                {finishError}
              </p>
            ) : null}
          </GlassPanel>

          {/* Exercise navigator */}
          <nav aria-label="Exercises in this session" className="mb-4 flex flex-wrap gap-2">
            {exercises.map((ex, i) => {
              const doneCount = ex.sets.filter((s) => s.done).length;
              const isCurrent = i === currentIdx;
              const isComplete = doneCount === ex.sets.length && doneCount > 0;
              return (
                <button
                  key={ex.key}
                  type="button"
                  onClick={() => setCurrentIdx(i)}
                  aria-label={`${ex.name}${ex.skipped ? ", skipped" : isComplete ? ", complete" : `, ${doneCount} of ${ex.sets.length} sets done`}`}
                  aria-current={isCurrent ? "true" : undefined}
                  className="anim-press touch-target flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border px-3 text-sm font-semibold"
                  style={
                    isCurrent
                      ? {
                          borderColor: "var(--accent)",
                          backgroundColor: "var(--accent)",
                          color: "var(--on-accent)",
                        }
                      : ex.skipped
                        ? {
                            borderColor: "var(--border)",
                            color: "var(--text-secondary)",
                            textDecoration: "line-through",
                          }
                        : isComplete
                          ? {
                              borderColor:
                                "color-mix(in srgb, var(--success) 55%, transparent)",
                              backgroundColor:
                                "color-mix(in srgb, var(--success) 12%, transparent)",
                              color: "var(--success)",
                            }
                          : { borderColor: "var(--border)", color: "var(--text)" }
                  }
                >
                  {i + 1}
                </button>
              );
            })}
          </nav>

          {/* Current exercise */}
          <GlassPanel key={current.key} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="t-card-heading text-xl">{current.name}</h2>
                <p className="mt-1 text-xs" style={secondaryText}>
                  Exercise {currentIdx + 1} of {exercises.length}
                  {current.wasReplaced ? " · replacement" : ""}
                  {current.slug ? (
                    <>
                      {" · "}
                      <Link
                        href={`/workouts/library/${current.slug}`}
                        className="underline"
                        style={{ color: "var(--accent)" }}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Technique guide
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <LuxButton variant="secondary" onClick={() => setReplaceOpen(true)}>
                  <RefreshCw size={16} aria-hidden="true" />
                  Replace
                </LuxButton>
                <LuxButton variant="ghost" onClick={() => skipExercise(currentIdx)}>
                  <SkipForward size={16} aria-hidden="true" />
                  Skip
                </LuxButton>
              </div>
            </div>

            {/* Compact animated demonstration of the current exercise */}
            {current.slug && hasExerciseAnimation(current.slug) ? (
              <figure
                className="mt-4 overflow-hidden rounded-2xl"
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                <ExerciseAnimation
                  slug={current.slug}
                  label={`${current.name} animated demonstration`}
                  className="mx-auto aspect-video w-full max-w-sm"
                />
                <figcaption
                  className="t-meta border-t px-4 py-2 text-center"
                  style={{ borderColor: "var(--border)" }}
                >
                  Animated demonstration
                </figcaption>
              </figure>
            ) : null}

            <div className="mt-4 space-y-2" role="group" aria-label={`Sets for ${current.name}`}>
              <div className="t-meta grid grid-cols-[2.5rem_1fr_1fr_auto] items-center gap-2">
                <span>Set</span>
                <span>Reps</span>
                <span>Weight (kg)</span>
                <span className="sr-only">Actions</span>
              </div>
              {current.sets.map((set, j) => (
                <div
                  key={j}
                  className="grid grid-cols-[2.5rem_1fr_1fr_auto] items-center gap-2 rounded-xl p-1"
                  style={
                    set.done
                      ? {
                          backgroundColor:
                            "color-mix(in srgb, var(--success) 10%, transparent)",
                        }
                      : undefined
                  }
                >
                  <span className="text-center text-sm font-semibold">{j + 1}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={set.reps}
                    onChange={(e) => updateSet(currentIdx, j, { reps: e.target.value })}
                    aria-label={`Set ${j + 1} reps`}
                    disabled={set.done}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.5"
                    placeholder="0"
                    value={set.weightKg}
                    onChange={(e) => updateSet(currentIdx, j, { weightKg: e.target.value })}
                    aria-label={`Set ${j + 1} weight in kilograms`}
                    disabled={set.done}
                  />
                  <div className="flex gap-1">
                    {!set.done ? (
                      <LuxButton
                        onClick={() => completeSet(currentIdx, j)}
                        aria-label={`Mark set ${j + 1} of ${current.name} complete`}
                      >
                        <Check size={16} aria-hidden="true" />
                        Done
                      </LuxButton>
                    ) : (
                      <LuxButton
                        variant="secondary"
                        onClick={() => updateSet(currentIdx, j, { done: false })}
                        aria-label={`Undo set ${j + 1} of ${current.name}`}
                      >
                        Undo
                      </LuxButton>
                    )}
                    {current.sets.length > 1 && !set.done ? (
                      <LuxButton
                        variant="ghost"
                        onClick={() => removeSet(currentIdx, j)}
                        aria-label={`Remove set ${j + 1}`}
                      >
                        <X size={16} aria-hidden="true" />
                      </LuxButton>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <LuxButton variant="secondary" onClick={() => addSet(currentIdx)}>
                <Plus size={16} aria-hidden="true" />
                Add set
              </LuxButton>
              {currentIdx > 0 ? (
                <LuxButton variant="secondary" onClick={() => setCurrentIdx(currentIdx - 1)}>
                  <ChevronLeft size={16} aria-hidden="true" />
                  Previous exercise
                </LuxButton>
              ) : null}
              {currentIdx < exercises.length - 1 ? (
                <LuxButton variant="secondary" onClick={() => setCurrentIdx(currentIdx + 1)}>
                  Next exercise
                  <ChevronRight size={16} aria-hidden="true" />
                </LuxButton>
              ) : (
                <LuxButton onClick={() => setEndConfirmOpen(true)}>
                  <Check size={16} aria-hidden="true" />
                  Finish session
                </LuxButton>
              )}
            </div>
          </GlassPanel>

          {/* Rest timer */}
          {rest ? (
            <GlassPanel className="mt-4 p-5" aria-label="Rest timer">
              <div className="flex flex-wrap items-center gap-5">
                <ProgressRing
                  value={restPct * 100}
                  size={120}
                  strokeWidth={10}
                  label="Rest"
                  showValue={false}
                />
                <div className="min-w-0 flex-1">
                  <p className="t-meta">{rest.paused ? "Rest paused" : "Rest remaining"}</p>
                  <p
                    className="t-numeral mt-1"
                    style={{ fontSize: "2.5rem", lineHeight: 1.1, color: "var(--accent)" }}
                    aria-label={`Rest time remaining ${formatClock(restRemainingMs)}`}
                  >
                    {formatClock(restRemainingMs)}
                  </p>
                  {rest.paused ? (
                    <div className="mt-2">
                      <LuxBadge tone="warning">Paused</LuxBadge>
                    </div>
                  ) : null}
                </div>
              </div>
              <ProgressBar value={restPct * 100} className="mt-4" />
              <div className="mt-4 flex flex-wrap gap-2">
                <LuxButton variant="secondary" onClick={togglePauseRest}>
                  {rest.paused ? (
                    <Play size={16} aria-hidden="true" />
                  ) : (
                    <Pause size={16} aria-hidden="true" />
                  )}
                  {rest.paused ? "Resume rest" : "Pause rest"}
                </LuxButton>
                <LuxButton
                  variant="ghost"
                  onClick={() => {
                    restRangRef.current = true;
                    setRest(null);
                    setLiveMessage("Rest skipped.");
                  }}
                >
                  Skip rest
                </LuxButton>
                <LuxButton variant="ghost" onClick={() => startRest(rest.totalSec + 30)}>
                  +30s
                </LuxButton>
              </div>
            </GlassPanel>
          ) : null}

          {/* Skipped list with undo */}
          {exercises.some((e) => e.skipped) ? (
            <GlassPanel className="mt-4 p-4">
              <h3 className="t-card-heading text-sm">Skipped</h3>
              <ul className="mt-2 space-y-1.5">
                {exercises.map((ex, i) =>
                  ex.skipped ? (
                    <li key={ex.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="line-through" style={secondaryText}>
                        {ex.name}
                      </span>
                      <LuxButton variant="ghost" onClick={() => undoSkip(i)}>
                        Undo skip
                      </LuxButton>
                    </li>
                  ) : null
                )}
              </ul>
            </GlassPanel>
          ) : null}
        </>
      )}

      {/* Replace modal */}
      <LuxDialog
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        title="Replace exercise"
      >
        <div>
          <label htmlFor="replace-q" className="t-meta mb-1.5 block">
            Search exercises
          </label>
          <Input
            id="replace-q"
            type="search"
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            placeholder="e.g. lunge, back, cable…"
          />
        </div>
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {replaceResults.map((e) => (
            <li key={e.slug}>
              <button
                type="button"
                onClick={() => replaceExercise(e)}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-secondary)]"
                style={{ borderColor: "var(--border)" }}
              >
                <span>
                  <span className="block font-medium">{e.name}</span>
                  <span className="block text-xs" style={secondaryText}>
                    {asStringArray(e.muscleGroups).slice(0, 3).join(", ")}
                  </span>
                </span>
                <LuxBadge>{e.difficulty}</LuxBadge>
              </button>
            </li>
          ))}
          {replaceResults.length === 0 ? (
            <li className="py-6 text-center text-sm" style={secondaryText}>
              No exercises match that search.
            </li>
          ) : null}
        </ul>
      </LuxDialog>

      {/* End-early confirm */}
      <LuxDialog
        open={endConfirmOpen}
        onClose={() => setEndConfirmOpen(false)}
        title="End session?"
        footer={
          <>
            <LuxButton onClick={() => void finishSession()}>Save and end</LuxButton>
            <LuxButton variant="secondary" onClick={() => setEndConfirmOpen(false)}>
              Keep training
            </LuxButton>
          </>
        }
      >
        <p className="text-sm">
          Completed sets will be saved to your workout log.{" "}
          {summary.doneSets === 0
            ? "You haven't completed any sets yet — ending now will save an empty session."
            : `You've completed ${summary.doneSets} ${summary.doneSets === 1 ? "set" : "sets"} so far.`}
        </p>
      </LuxDialog>
    </div>
  );
}
