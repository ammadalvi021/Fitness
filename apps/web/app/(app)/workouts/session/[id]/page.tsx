"use client";

/**
 * /workouts/session/[id] — live workout session player.
 *
 * The session snapshot (exercises, sets, reps, rest) is handed over via
 * sessionStorage by the workouts page at creation time — there is no
 * GET /api/workouts/sessions/[id] in the contract, so a direct visit without
 * a snapshot shows a graceful recovery state.
 *
 * Finish flow: POST /api/workouts/sessions/[id]/logs per completed exercise,
 * then PATCH /api/workouts/sessions/[id] {status:'completed', endedAt}.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  ProgressRing,
  Skeleton,
  Stat,
} from "@/components/ui";
import {
  Exercise,
  SessionSnapshot,
  SnapshotExercise,
  WORKOUT_SAFETY_COPY,
  asStringArray,
  pickArray,
  sessionStorageKey,
} from "../../_shared";

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

function parseLeadingNumber(s: string): number {
  const m = /[\d.]+/.exec(s);
  const n = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

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
      <EmptyState
        title="We couldn't load this session"
        message="Session details are passed along when you start a workout from your plan, and this browser tab doesn't have them (for example, the link was opened directly or in a new tab). Start a fresh session from your weekly plan."
        action={
          <Link href="/workouts">
            <Button>Back to workouts</Button>
          </Link>
        }
      />
    );
  }

  if (phase === "done") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Session complete" subtitle={snapshot?.sessionName} />
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Duration" value={formatClock(elapsedMs)} />
            <Stat label="Exercises" value={String(summary.completedExercises)} sub={`of ${activeExercises.length} planned`} />
            <Stat label="Sets done" value={String(summary.doneSets)} />
            <Stat label="Volume" value={`${Math.round(summary.volume)} kg`} />
          </div>
          <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
            Estimated energy: <strong>≈ {summary.kcal} kcal</strong>{" "}
            <span className="text-xs">(approximate)</span>
          </p>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{WORKOUT_SAFETY_COPY}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/workouts">
              <Button>Back to workouts</Button>
            </Link>
            <Link href="/progress">
              <Button variant="secondary">View progress</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (!current) {
    return (
      <EmptyState
        title="This session has no exercises"
        message="Something went wrong building the workout. Please start a new session from your plan."
        action={
          <Link href="/workouts">
            <Button>Back to workouts</Button>
          </Link>
        }
      />
    );
  }

  const restPct = rest ? Math.min(1, Math.max(0, restRemainingMs / (rest.totalSec * 1000))) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={snapshot?.sessionName ?? "Workout session"}
        subtitle={snapshot?.dayLabel ? `${snapshot.dayLabel} · live session` : "Live session"}
        actions={
          <>
            <Button variant="secondary" onClick={togglePauseSession} aria-pressed={paused}>
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button variant="danger" onClick={() => setEndConfirmOpen(true)}>
              End session
            </Button>
          </>
        }
      />

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {paused ? (
        <Card className="mb-4 border-amber-300 dark:border-amber-800">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Session paused — the timer is stopped. Press Resume when you&apos;re ready.
          </p>
        </Card>
      ) : null}

      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">{WORKOUT_SAFETY_COPY}</p>

      {phase === "finishing" ? (
        <Card>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">Saving your session…</p>
          <Skeleton className="mt-3 h-4" />
        </Card>
      ) : (
        <>
          {/* Session clock */}
          <Card className="mb-4">
            <div className="flex items-center justify-between gap-4">
              <Stat label="Elapsed" value={formatClock(elapsedMs)} />
              <Stat
                label="Progress"
                value={`${summary.doneSets} sets`}
                sub={`${summary.completedExercises} of ${activeExercises.length} exercises done`}
              />
              <Stat label="Volume" value={`${Math.round(summary.volume)} kg`} />
            </div>
            {finishError ? (
              <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
                {finishError}
              </p>
            ) : null}
          </Card>

          {/* Exercise navigator */}
          <nav aria-label="Exercises in this session" className="mb-4 flex flex-wrap gap-2">
            {exercises.map((ex, i) => {
              const doneCount = ex.sets.filter((s) => s.done).length;
              const isCurrent = i === currentIdx;
              return (
                <button
                  key={ex.key}
                  type="button"
                  onClick={() => setCurrentIdx(i)}
                  aria-label={`${ex.name}${ex.skipped ? ", skipped" : doneCount === ex.sets.length && doneCount > 0 ? ", complete" : `, ${doneCount} of ${ex.sets.length} sets done`}`}
                  aria-current={isCurrent ? "true" : undefined}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    isCurrent
                      ? "border-brand bg-brand/10 text-brand"
                      : ex.skipped
                        ? "border-neutral-200 text-neutral-400 line-through dark:border-neutral-700"
                        : doneCount === ex.sets.length && doneCount > 0
                          ? "border-green-500 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300"
                          : "border-neutral-200 text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  {i + 1}
                </button>
              );
            })}
          </nav>

          {/* Current exercise */}
          <Card key={current.key}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {current.name}
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Exercise {currentIdx + 1} of {exercises.length}
                  {current.wasReplaced ? " · replacement" : ""}
                  {current.slug ? (
                    <>
                      {" · "}
                      <Link
                        href={`/workouts/library/${current.slug}`}
                        className="text-brand underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Technique guide
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setReplaceOpen(true)}>
                  Replace
                </Button>
                <Button size="sm" variant="ghost" onClick={() => skipExercise(currentIdx)}>
                  Skip
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-2" role="group" aria-label={`Sets for ${current.name}`}>
              <div className="grid grid-cols-[2.5rem_1fr_1fr_auto] items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                <span>Set</span>
                <span>Reps</span>
                <span>Weight (kg)</span>
                <span className="sr-only">Actions</span>
              </div>
              {current.sets.map((set, j) => (
                <div
                  key={j}
                  className={`grid grid-cols-[2.5rem_1fr_1fr_auto] items-center gap-2 rounded-xl p-1 ${
                    set.done ? "bg-green-50 dark:bg-green-900/20" : ""
                  }`}
                >
                  <span className="text-center text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                    {j + 1}
                  </span>
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
                      <Button
                        size="sm"
                        onClick={() => completeSet(currentIdx, j)}
                        aria-label={`Mark set ${j + 1} of ${current.name} complete`}
                      >
                        Done
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => updateSet(currentIdx, j, { done: false })}
                        aria-label={`Undo set ${j + 1} of ${current.name}`}
                      >
                        Undo
                      </Button>
                    )}
                    {current.sets.length > 1 && !set.done ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeSet(currentIdx, j)}
                        aria-label={`Remove set ${j + 1}`}
                      >
                        ✕
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => addSet(currentIdx)}>
                + Add set
              </Button>
              {currentIdx > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setCurrentIdx(currentIdx - 1)}>
                  ← Previous exercise
                </Button>
              ) : null}
              {currentIdx < exercises.length - 1 ? (
                <Button size="sm" variant="secondary" onClick={() => setCurrentIdx(currentIdx + 1)}>
                  Next exercise →
                </Button>
              ) : (
                <Button size="sm" onClick={() => setEndConfirmOpen(true)}>
                  Finish session
                </Button>
              )}
            </div>
          </Card>

          {/* Rest timer */}
          {rest ? (
            <Card className="mt-4" aria-label="Rest timer">
              <div className="flex items-center gap-4">
                <ProgressRing
                  value={restRemainingMs}
                  max={rest.totalSec * 1000}
                  size={110}
                  label={formatClock(restRemainingMs)}
                  sublabel={rest.paused ? "paused" : "rest remaining"}
                />
                <div className="flex-1">
                  <div
                    className="h-2.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(restPct * 100)}
                    aria-label="Rest time remaining"
                  >
                    <div
                      className="h-full rounded-full bg-brand transition-[width] duration-200"
                      style={{ width: `${restPct * 100}%` }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={togglePauseRest}>
                      {rest.paused ? "Resume rest" : "Pause rest"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        restRangRef.current = true;
                        setRest(null);
                        setLiveMessage("Rest skipped.");
                      }}
                    >
                      Skip rest
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startRest(rest.totalSec + 30)}>
                      +30s
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {/* Skipped list with undo */}
          {exercises.some((e) => e.skipped) ? (
            <Card className="mt-4">
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Skipped
              </h3>
              <ul className="mt-2 space-y-1.5">
                {exercises.map((ex, i) =>
                  ex.skipped ? (
                    <li key={ex.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-neutral-500 line-through dark:text-neutral-400">
                        {ex.name}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => undoSkip(i)}>
                        Undo skip
                      </Button>
                    </li>
                  ) : null
                )}
              </ul>
            </Card>
          ) : null}
        </>
      )}

      {/* Replace modal */}
      <Modal open={replaceOpen} onClose={() => setReplaceOpen(false)} title="Replace exercise">
        <Field label="Search exercises" htmlFor="replace-q">
          <Input
            id="replace-q"
            type="search"
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            placeholder="e.g. lunge, back, cable…"
          />
        </Field>
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {replaceResults.map((e) => (
            <li key={e.slug}>
              <button
                type="button"
                onClick={() => replaceExercise(e)}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                <span>
                  <span className="block font-medium text-neutral-900 dark:text-neutral-100">
                    {e.name}
                  </span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                    {asStringArray(e.muscleGroups).slice(0, 3).join(", ")}
                  </span>
                </span>
                <Badge>{e.difficulty}</Badge>
              </button>
            </li>
          ))}
          {replaceResults.length === 0 ? (
            <li className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No exercises match that search.
            </li>
          ) : null}
        </ul>
      </Modal>

      {/* End-early confirm */}
      <Modal open={endConfirmOpen} onClose={() => setEndConfirmOpen(false)} title="End session?">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Completed sets will be saved to your workout log.{" "}
          {summary.doneSets === 0
            ? "You haven't completed any sets yet — ending now will save an empty session."
            : `You've completed ${summary.doneSets} ${summary.doneSets === 1 ? "set" : "sets"} so far.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void finishSession()}>Save and end</Button>
          <Button variant="secondary" onClick={() => setEndConfirmOpen(false)}>
            Keep training
          </Button>
        </div>
      </Modal>
    </div>
  );
}
