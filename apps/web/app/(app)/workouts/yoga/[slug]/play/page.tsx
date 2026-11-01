"use client";

/**
 * /workouts/yoga/[slug]/play — guided yoga pose player (V22 Phase B).
 *
 * Built on the pure state machine in lib/guided-player/machine.ts: this
 * page only renders machine state and dispatches events (a 1s interval
 * dispatches TICK while holding/transitioning). Playback creates a guided
 * WorkoutSession via POST /api/workouts/sessions {kind:'yoga'}; finishing
 * (naturally or early) PATCHes it completed with the machine's active
 * elapsed seconds — the server computes the calorie estimate.
 *
 * Media stays honest: poses have no verified demonstration video yet, so
 * the media area is a clearly labelled placeholder, never a fake player.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  VideoOff,
  Wind,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import {
  ErrorStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
  LuxDialog,
  MediaPanelLux,
  MetricCard,
  ProgressBar,
} from "@/components/luxury";
import { WORKOUT_SAFETY_COPY, pickObject } from "../../../_shared";
import { formatClock } from "../../../_lux";
import {
  YogaSequenceDetail,
  formatDuration,
  formatHold,
} from "../../_shared";
import {
  buildSegments,
  createMachine,
  currentSegment,
  nextHoldSegment,
  reduce,
  type PlayerEvent,
  type PlayerState,
} from "@/lib/guided-player/machine";

const secondaryText = { color: "var(--text-secondary)" } as const;

/** WebAudio beep — same minimal approach as the strength session player. */
function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const init = () => {
      try {
        if (!ctxRef.current) {
          const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
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
      /* audio unavailable — silent */
    }
  };
}

interface CompletedSession {
  caloriesEstimateKcal?: number | null;
  durationSeconds?: number | null;
}

type LoadPhase = "loading" | "ready" | "missing" | "error";
type SaveState = "idle" | "saving" | "saved" | "save-error";

export default function YogaPlayerPage({ params }: { params: { slug: string } }) {
  const beep = useBeep();
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sequence, setSequence] = useState<YogaSequenceDetail | null>(null);
  const [machine, setMachine] = useState<PlayerState | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [completedSession, setCompletedSession] = useState<CompletedSession | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  const finalElapsedRef = useRef(0);
  const saveAttemptedRef = useRef(false);
  const prevSegmentRef = useRef<{ index: number; phase: string }>({ index: 0, phase: "ready" });

  const dispatch = useCallback((event: PlayerEvent) => {
    setMachine((s) => (s ? reduce(s, event) : s));
  }, []);

  /* ------------------------------- Load ---------------------------------- */
  const load = useCallback(async () => {
    setLoadPhase("loading");
    setLoadError(null);
    try {
      const res = await api<unknown>(`/api/yoga/sequences/${params.slug}`);
      const seq = pickObject<YogaSequenceDetail>(res, "sequence");
      if (!seq) throw new Error("The server returned an unexpected response.");
      setSequence(seq);
      setMachine(createMachine(buildSegments(seq)));
      setLoadPhase("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setLoadPhase("missing");
      } else {
        setLoadError(
          e instanceof ApiError ? e.message : "Couldn't load this session. Please try again.",
        );
        setLoadPhase("error");
      }
    }
  }, [params.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------- Ticking ------------------------------- */
  const machinePhase = machine?.phase;
  useEffect(() => {
    if (machinePhase !== "holding" && machinePhase !== "transition") return;
    const id = window.setInterval(() => dispatch({ type: "TICK" }), 1000);
    return () => window.clearInterval(id);
  }, [machinePhase, dispatch]);

  /* --------------------- Beeps + aria-live announcements ------------------ */
  useEffect(() => {
    if (!machine) return;
    const prev = prevSegmentRef.current;
    prevSegmentRef.current = { index: machine.currentIndex, phase: machine.phase };
    if (machine.phase === "complete") {
      if (prev.phase !== "complete" && prev.phase !== "ready") {
        beep(660, 0.35);
        beep(990, 0.5, 160);
        setLiveMessage("Session complete. Well done.");
      }
      return;
    }
    if (machine.phase !== "holding" && machine.phase !== "transition") return;
    if (prev.index === machine.currentIndex && prev.phase !== "ready") return;
    const seg = currentSegment(machine);
    if (!seg) return;
    if (machine.phase === "transition") {
      beep(520, 0.25);
      setLiveMessage(`Get ready: ${seg.poseName ?? "next pose"}`);
    } else {
      beep(880, 0.3);
      setLiveMessage(
        `Now: ${seg.poseName ?? "pose"}${seg.sideLabel ? `, ${seg.sideLabel}` : ""}`,
      );
    }
  }, [machine, beep]);

  /* --------------------------- Completion save ---------------------------- */
  const saveCompletion = useCallback(async () => {
    if (!sessionId) return;
    setSaveState("saving");
    try {
      const res = await api<unknown>(`/api/workouts/sessions/${sessionId}`, {
        method: "PATCH",
        body: {
          status: "completed",
          durationSeconds: Math.max(1, finalElapsedRef.current),
        },
      });
      setCompletedSession(pickObject<CompletedSession>(res, "session"));
      setSaveState("saved");
    } catch {
      setSaveState("save-error");
    }
  }, [sessionId]);

  useEffect(() => {
    if (!machine || machine.phase !== "complete" || !sessionId) return;
    if (saveAttemptedRef.current) return;
    saveAttemptedRef.current = true;
    finalElapsedRef.current = machine.elapsedSeconds;
    void saveCompletion();
  }, [machine, sessionId, saveCompletion]);

  /* -------------------------------- Start --------------------------------- */
  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await api<unknown>("/api/workouts/sessions", {
        method: "POST",
        body: { kind: "yoga", sourceSlug: params.slug },
      });
      const session = pickObject<{ id: string }>(res, "session");
      if (!session?.id) throw new Error("The server didn't return a session id.");
      setSessionId(session.id);
      dispatch({ type: "START" });
    } catch (e) {
      setStartError(
        e instanceof ApiError ? e.message : "Couldn't start the session. Please try again.",
      );
    } finally {
      setStarting(false);
    }
  }

  /* -------------------------------- Render -------------------------------- */
  if (loadPhase === "loading") {
    return (
      <div className="space-y-3" aria-label="Loading session player">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (loadPhase === "missing" || loadPhase === "error" || !sequence || !machine) {
    return (
      <ErrorStateLux
        title={loadPhase === "missing" ? "Session not found" : "Couldn't load this session"}
        message={
          loadPhase === "missing"
            ? "This yoga session doesn't exist or may have been removed."
            : (loadError ?? "Something went wrong.")
        }
        onRetry={() => void load()}
        retryLabel="Try again"
      />
    );
  }

  const seg = currentSegment(machine);
  const nextHold = nextHoldSegment(machine);
  const currentHoldNumber =
    machine.phase === "transition"
      ? (seg?.nextSegmentIndex != null
          ? (machine.segments[seg.nextSegmentIndex]?.holdIndex ?? 0) + 1
          : machine.totalHolds)
      : (seg?.holdIndex ?? 0) + 1;

  return (
    <div className="anim-page-enter">
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/workouts/yoga/${sequence.slug}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
            style={{ color: "var(--accent)" }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {sequence.title}
          </Link>
          <p className="mt-1 text-sm" style={secondaryText}>
            {machine.phase === "complete"
              ? "Session finished"
              : machine.totalHolds > 0
                ? `Pose ${Math.min(currentHoldNumber, machine.totalHolds)} of ${machine.totalHolds}`
                : "Guided session"}
            {" · "}
            Elapsed {formatClock(machine.elapsedSeconds * 1000)}
          </p>
        </div>
        {machine.totalHolds > 0 && machine.phase !== "complete" ? (
          <div className="w-44 shrink-0">
            <ProgressBar
              value={machine.completedHolds}
              max={machine.totalHolds}
              label="Poses completed"
            />
          </div>
        ) : null}
      </div>

      {/* ------------------------------ Complete ------------------------------ */}
      {machine.phase === "complete" ? (
        <GlassPanel className="p-6">
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{
                color: "var(--accent)",
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              <CheckCircle2 size={22} aria-hidden="true" />
            </span>
            <div>
              <h1 className="t-card-heading">
                {machine.completedHolds >= machine.totalHolds && machine.totalHolds > 0
                  ? "Session complete!"
                  : "Session ended"}
              </h1>
              <p className="text-sm" style={secondaryText}>
                {sequence.title}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Active time"
              value={formatClock(machine.elapsedSeconds * 1000)}
            />
            <MetricCard
              label="Poses completed"
              value={`${machine.completedHolds} / ${machine.totalHolds}`}
            />
            <MetricCard
              label="Estimated calories"
              value={
                saveState === "saved" && completedSession?.caloriesEstimateKcal != null
                  ? `${Math.round(completedSession.caloriesEstimateKcal)} kcal`
                  : saveState === "saving"
                    ? "Saving…"
                    : "—"
              }
              subtext={
                saveState === "saved" && completedSession?.caloriesEstimateKcal == null
                  ? "Calorie estimate unavailable — add your weight in Measurements to enable estimates."
                  : saveState === "saved"
                    ? "Estimate based on your latest recorded weight."
                    : undefined
              }
            />
          </div>

          {saveState === "save-error" ? (
            <div
              className="mt-4 flex flex-wrap items-center gap-3 rounded-xl p-3"
              style={{
                backgroundColor: "color-mix(in srgb, var(--error) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--error) 40%, transparent)",
              }}
            >
              <p className="text-sm">
                Your session finished, but saving it failed. Your progress isn&apos;t
                recorded yet.
              </p>
              <LuxButton
                variant="secondary"
                onClick={() => {
                  saveAttemptedRef.current = true;
                  void saveCompletion();
                }}
              >
                Retry saving
              </LuxButton>
            </div>
          ) : null}
          {saveState === "saved" ? (
            <p className="mt-4 text-sm" style={{ color: "var(--success, var(--accent))" }}>
              Session saved to your workout history.
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/workouts/yoga">
              <LuxButton>Back to Yoga</LuxButton>
            </Link>
            <Link href="/dashboard">
              <LuxButton variant="secondary">Dashboard</LuxButton>
            </Link>
          </div>
        </GlassPanel>
      ) : machine.phase === "ready" ? (
        /* ------------------------------- Ready ------------------------------ */
        <GlassPanel className="p-6">
          <h1 className="t-page-title">{sequence.title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed" style={secondaryText}>
            {sequence.description}
          </p>
          <p className="mt-3 text-sm" style={secondaryText}>
            {machine.totalHolds} pose holds · about {formatDuration(sequence.totalDurationSeconds)}
          </p>
          <div className="mt-4">
            <MediaPanelLux label="Demonstration media coming soon">
              <div className="flex flex-col items-center gap-2 px-6 text-center">
                <VideoOff size={28} aria-hidden="true" style={{ color: "var(--accent)" }} />
                <p className="text-sm font-medium">
                  Demonstration media coming soon — follow the written guidance
                </p>
              </div>
            </MediaPanelLux>
          </div>
          {startError ? (
            <p className="mt-4 text-sm" style={{ color: "var(--error)" }} role="alert">
              {startError}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <LuxButton onClick={() => void handleStart()} disabled={starting}>
              <Play size={17} aria-hidden="true" />
              {starting ? "Starting…" : "Start session"}
            </LuxButton>
            <Link href={`/workouts/yoga/${sequence.slug}`}>
              <LuxButton variant="secondary">View pose list</LuxButton>
            </Link>
          </div>
          <p className="mt-6 text-xs leading-relaxed" style={secondaryText}>
            {WORKOUT_SAFETY_COPY}
          </p>
        </GlassPanel>
      ) : (
        /* ------------------------------- Active ------------------------------ */
        <>
          {machine.phase === "paused" ? (
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

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div>
              <MediaPanelLux
                label={
                  seg?.mediaStatus === "verified"
                    ? (seg?.poseName ?? undefined)
                    : "Demonstration media coming soon"
                }
              >
                <div className="flex flex-col items-center gap-2 px-6 text-center">
                  <VideoOff size={28} aria-hidden="true" style={{ color: "var(--accent)" }} />
                  <p className="text-sm font-medium">
                    {seg?.mediaStatus === "verified"
                      ? seg?.poseName
                      : "Demonstration media coming soon — follow the written guidance"}
                  </p>
                </div>
              </MediaPanelLux>

              <GlassPanel className="mt-4 p-5">
                {machine.phase === "transition" || (machine.phase === "paused" && machine.resumePhase === "transition") ? (
                  <>
                    <p className="t-meta">Get ready</p>
                    <h2 className="t-page-title mt-1">{seg?.poseName ?? "Next pose"}</h2>
                    {seg?.sanskritName ? (
                      <p className="mt-0.5 text-sm italic" style={secondaryText}>
                        {seg.sanskritName}
                      </p>
                    ) : null}
                    <p
                      className="t-numeral mt-3"
                      style={{ fontSize: "4rem", lineHeight: 1, color: "var(--accent)" }}
                      aria-label={`Next pose in ${machine.remainingSeconds} seconds`}
                    >
                      {formatClock(machine.remainingSeconds * 1000)}
                    </p>
                    {(() => {
                      const incoming =
                        seg?.nextSegmentIndex != null
                          ? machine.segments[seg.nextSegmentIndex]
                          : null;
                      return incoming ? (
                        <p className="mt-2 text-sm" style={secondaryText}>
                          Hold for {formatHold(incoming.durationSeconds)}
                          {incoming.sideLabel ? ` · ${incoming.sideLabel}` : ""}
                        </p>
                      ) : null;
                    })()}
                  </>
                ) : seg ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="t-meta">Now</p>
                      {seg.sideLabel ? <LuxBadge tone="accent">{seg.sideLabel}</LuxBadge> : null}
                    </div>
                    <h2 className="t-page-title mt-1">{seg.poseName}</h2>
                    {seg.sanskritName ? (
                      <p className="mt-0.5 text-sm italic" style={secondaryText}>
                        {seg.sanskritName}
                      </p>
                    ) : null}
                    <p
                      className="t-numeral mt-3"
                      style={{ fontSize: "4rem", lineHeight: 1, color: "var(--accent)" }}
                      aria-label={`${machine.remainingSeconds} seconds remaining in this pose`}
                    >
                      {formatClock(machine.remainingSeconds * 1000)}
                    </p>
                    {seg.cue ? (
                      <p className="mt-2 text-sm font-medium">{seg.cue}</p>
                    ) : null}
                  </>
                ) : null}

                {/* Controls */}
                <div className="mt-5 flex flex-wrap gap-2">
                  <LuxButton
                    variant="secondary"
                    onClick={() =>
                      dispatch({ type: machine.phase === "paused" ? "RESUME" : "PAUSE" })
                    }
                    aria-pressed={machine.phase === "paused"}
                  >
                    {machine.phase === "paused" ? (
                      <Play size={17} aria-hidden="true" />
                    ) : (
                      <Pause size={17} aria-hidden="true" />
                    )}
                    {machine.phase === "paused" ? "Resume" : "Pause"}
                  </LuxButton>
                  <LuxButton variant="secondary" onClick={() => dispatch({ type: "REPEAT" })}>
                    <RotateCcw size={16} aria-hidden="true" />
                    Repeat pose
                  </LuxButton>
                  <LuxButton variant="secondary" onClick={() => dispatch({ type: "SKIP" })}>
                    <SkipForward size={16} aria-hidden="true" />
                    Skip
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
              </GlassPanel>
            </div>

            {/* Guidance column */}
            <div className="space-y-4">
              {machine.phase !== "transition" && seg ? (
                <>
                  {seg.instructions.length ? (
                    <GlassPanel className="p-5">
                      <h3 className="t-card-heading">How to hold it</h3>
                      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
                        {seg.instructions.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </GlassPanel>
                  ) : null}
                  {seg.breathing ? (
                    <GlassPanel className="p-5">
                      <h3 className="t-card-heading flex items-center gap-2">
                        <Wind size={17} aria-hidden="true" style={{ color: "var(--accent)" }} />
                        Breathing
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed">{seg.breathing}</p>
                    </GlassPanel>
                  ) : null}
                  {seg.modifications ? (
                    <GlassPanel className="p-5">
                      <h3 className="t-card-heading">Beginner modification</h3>
                      <p className="mt-1.5 text-sm leading-relaxed">{seg.modifications}</p>
                    </GlassPanel>
                  ) : null}
                  {seg.cautions ? (
                    <div
                      className="flex gap-3 rounded-xl p-3"
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
                        <strong>Take care:</strong> {seg.cautions}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}

              {nextHold ? (
                <GlassPanel className="p-5">
                  <p className="t-meta">Up next</p>
                  <p className="mt-1 text-sm font-semibold">{nextHold.poseName}</p>
                  <p className="text-xs" style={secondaryText}>
                    Hold {formatHold(nextHold.durationSeconds)}
                    {nextHold.sideLabel ? ` · ${nextHold.sideLabel}` : ""}
                  </p>
                </GlassPanel>
              ) : (
                <GlassPanel className="p-5">
                  <p className="t-meta">Up next</p>
                  <p className="mt-1 text-sm font-semibold">Final pose — you&apos;re almost done</p>
                </GlassPanel>
              )}
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed" style={secondaryText}>
            {WORKOUT_SAFETY_COPY}
          </p>
        </>
      )}

      {/* End-session confirmation */}
      <LuxDialog
        open={endConfirmOpen}
        onClose={() => setEndConfirmOpen(false)}
        title="End this session?"
        footer={
          <>
            <LuxButton variant="secondary" onClick={() => setEndConfirmOpen(false)}>
              Keep going
            </LuxButton>
            <LuxButton
              onClick={() => {
                setEndConfirmOpen(false);
                dispatch({ type: "FINISH_EARLY" });
              }}
              style={{ backgroundColor: "var(--error)", borderColor: "var(--error)" }}
            >
              End session
            </LuxButton>
          </>
        }
      >
        Your progress so far will be saved as a completed session with the time
        you were active. Poses you haven&apos;t reached won&apos;t be counted.
      </LuxDialog>
    </div>
  );
}
