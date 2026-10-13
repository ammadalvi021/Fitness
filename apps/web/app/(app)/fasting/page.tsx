"use client";

/**
 * /fasting — intermittent fasting timer (V20 Feature 5).
 *
 * - Presets 14:10 / 16:8 / 18:6 / 20:4 + custom hours.
 * - Live progress ring + time-remaining readout while fasting.
 * - Persistence: localStorage is primary (survives reloads); the active fast
 *   is also synced to `Profile.fastingSession` so it survives devices.
 *   On load the two copies are reconciled (later start wins; ties go to the
 *   local copy), and a fast whose end time passed is marked complete.
 * - States: idle / fasting / complete (gentle notice, no alarms).
 * - Starting while a fast is active asks for confirmation first.
 * - "Log to journal" writes a simple local record (last 30 fasts).
 *
 * Coexists with Ramadan mode (`/ramadan`): that page is a daily prayer-window
 * framework; this page is a general-purpose fast timer. Neither replaces the
 * other.
 */
import { useEffect, useRef, useState } from "react";
import { Hourglass, Play, Square, Timer } from "lucide-react";
import { GlassPanel, LuxButton, ProgressRing } from "@/components/luxury";
import { Input, Skeleton } from "@/components/ui";
import {
  FASTING_PRESETS,
  MAX_FAST_MINUTES,
  MIN_FAST_MINUTES,
  completionPct,
  elapsedMs,
  fastEndMs,
  fastingStatus,
  formatDuration,
  formatRemaining,
  isValidFastingRecord,
  remainingMs,
  shouldConfirmReplace,
  type FastingRecord,
} from "@fitfusion/core";
import {
  appendJournal,
  clearLastCompleted,
  clearLocalActive,
  loadJournal,
  loadLastCompleted,
  loadLocalActive,
  reconcileCandidates,
  saveLastCompleted,
  saveLocalActive,
  type FastingJournalEntry,
} from "@/lib/fasting";

type Phase = "loading" | "idle" | "fasting" | "complete";

/**
 * Best-effort server sync. Uses plain fetch (NOT the `api()` helper) because
 * `api()` redirects to /login on 401 — the fasting timer must keep working
 * as device-only when signed out, showing a "saved on this device" note
 * instead of booting the user to the sign-in page.
 */
async function fetchServerSession(): Promise<{ record: FastingRecord | null; ok: boolean }> {
  try {
    const res = await fetch("/api/profile", { credentials: "same-origin" });
    if (!res.ok) return { record: null, ok: false };
    const d = (await res.json()) as { profile?: { fastingSession?: unknown } };
    const s = d.profile?.fastingSession;
    return { record: isValidFastingRecord(s) ? s : null, ok: true };
  } catch {
    return { record: null, ok: false };
  }
}

async function pushServerSession(record: FastingRecord | null): Promise<boolean> {
  try {
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ fastingSession: record }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function FastingPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [active, setActive] = useState<FastingRecord | null>(null);
  const [completed, setCompleted] = useState<FastingRecord | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [preset, setPreset] = useState<number>(16); // fasting hours
  const [customMode, setCustomMode] = useState(false);
  const [customHours, setCustomHours] = useState("15");
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [note, setNote] = useState("");
  const [journal, setJournal] = useState<FastingJournalEntry[]>([]);
  const [journalSaved, setJournalSaved] = useState(false);
  const [syncOk, setSyncOk] = useState<boolean | null>(null);
  const autoCompletedRef = useRef(false);

  /* ---------------- load + reconcile ---------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = loadLocalActive();
      const lastDone = loadLastCompleted();
      const { record: server, ok } = await fetchServerSession();
      if (!cancelled) setSyncOk(ok);
      if (cancelled) return;

      const chosen = reconcileCandidates(local, server);
      if (chosen && chosen !== local) saveLocalActive(chosen);
      const t = Date.now();
      const status = fastingStatus(chosen, t);

      if (status === "fasting" && chosen) {
        setActive(chosen);
        setPhase("fasting");
        // Make sure the server copy matches the authoritative one.
        if (server !== chosen) void pushServerSession(chosen).then((ok) => { if (!cancelled) setSyncOk(ok); });
      } else if (status === "complete" && chosen) {
        // The fast's end passed while away: mark it complete (gentle notice).
        const done: FastingRecord = { ...chosen, endedAt: new Date(fastEndMs(chosen)).toISOString() };
        saveLastCompleted(done);
        clearLocalActive();
        void pushServerSession(null);
        setCompleted(done);
        setPhase("complete");
      } else if (lastDone) {
        setCompleted(lastDone);
        setPhase("complete");
      } else {
        setPhase("idle");
      }
      setJournal(loadJournal());
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------------- live ticker while fasting ---------------- */
  useEffect(() => {
    if (phase !== "fasting" || !active) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      // Gentle auto-complete: single state transition, no alarms or popups.
      if (remainingMs(active, t) <= 0 && !autoCompletedRef.current) {
        autoCompletedRef.current = true;
        const done: FastingRecord = { ...active, endedAt: new Date(fastEndMs(active)).toISOString() };
        saveLastCompleted(done);
        clearLocalActive();
        void pushServerSession(null);
        setCompleted(done);
        setActive(null);
        setPhase("complete");
        setNote("");
        setJournalSaved(false);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, active]);

  /* ---------------- actions ---------------- */
  function selectedHours(): number | null {
    if (!customMode) return preset;
    const v = Number(customHours);
    if (!Number.isFinite(v) || v < MIN_FAST_MINUTES / 60 || v > MAX_FAST_MINUTES / 60) {
      setInputError(`Enter a whole or decimal number of hours between ${MIN_FAST_MINUTES / 60} and ${MAX_FAST_MINUTES / 60}.`);
      return null;
    }
    return v;
  }

  function beginFast(hours: number) {
    const record: FastingRecord = {
      startedAt: new Date().toISOString(),
      targetMinutes: Math.round(hours * 60),
    };
    autoCompletedRef.current = false;
    saveLocalActive(record);
    clearLastCompleted();
    void pushServerSession(record).then(setSyncOk);
    setActive(record);
    setCompleted(null);
    setNow(Date.now());
    setConfirmReplace(false);
    setInputError(null);
    setPhase("fasting");
  }

  function handleStart() {
    const hours = selectedHours();
    if (hours == null) return;
    if (shouldConfirmReplace(active, Date.now())) {
      setConfirmReplace(true);
      return;
    }
    beginFast(hours);
  }

  function handleEnd() {
    if (!active) return;
    const done: FastingRecord = { ...active, endedAt: new Date().toISOString() };
    saveLastCompleted(done);
    clearLocalActive();
    void pushServerSession(null).then(setSyncOk);
    setCompleted(done);
    setActive(null);
    setNote("");
    setJournalSaved(false);
    setPhase("complete");
  }

  function handleLogToJournal() {
    if (!completed || !completed.endedAt) return;
    const durMs = elapsedMs(completed, Date.now());
    const entry: FastingJournalEntry = {
      startedAt: completed.startedAt,
      endedAt: completed.endedAt,
      targetMinutes: completed.targetMinutes,
      durationMinutes: Math.round(durMs / 60_000),
      completionPct: completionPct(completed, Date.now()),
      note: note.trim() ? note.trim() : null,
      loggedAt: new Date().toISOString(),
    };
    if (appendJournal(entry)) {
      setJournal(loadJournal());
      setJournalSaved(true);
    }
  }

  function handleDismissComplete() {
    clearLastCompleted();
    setCompleted(null);
    setPhase("idle");
  }

  /* ---------------- render ---------------- */
  if (phase === "loading") {
    return (
      <div className="anim-page-enter">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="mt-4 h-64" />
      </div>
    );
  }

  const pct = active ? completionPct(active, now) : 0;
  const rem = active ? remainingMs(active, now) : 0;

  return (
    <div className="anim-page-enter">
      <h1 className="t-greeting flex items-center gap-2">
        <Timer size={26} aria-hidden="true" style={{ color: "var(--brand)" }} /> Fasting timer
      </h1>
      <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
        Intermittent fasting with a live timer. Survives reloads and syncs across your devices.
      </p>
      {syncOk === false && (
        <p className="t-meta mt-2 normal-case tracking-normal" style={{ color: "var(--text-secondary)" }}>
          Not signed in (or offline) — your fast is saved on this device only.
        </p>
      )}

      {/* -------- idle: pick a fast -------- */}
      {phase === "idle" && (
        <GlassPanel className="mt-4 p-6">
          <h2 className="t-card-heading">Start a fast</h2>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Fast length presets">
            {FASTING_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setPreset(p.fastingHours); setCustomMode(false); setInputError(null); }}
                aria-pressed={!customMode && preset === p.fastingHours}
                className="rounded-xl border px-4 py-2.5 text-sm font-medium transition-transform hover:scale-[1.03]"
                style={{
                  borderColor: !customMode && preset === p.fastingHours ? "var(--accent)" : "var(--border)",
                  backgroundColor: !customMode && preset === p.fastingHours
                    ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                    : "var(--bg-secondary)",
                  color: "var(--text)",
                }}
              >
                <span className="t-numeral">{p.label}</span>
                <span className="t-meta ml-1.5 normal-case tracking-normal">{p.fastingHours}h fast</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setCustomMode(true); setInputError(null); }}
              aria-pressed={customMode}
              className="rounded-xl border px-4 py-2.5 text-sm font-medium transition-transform hover:scale-[1.03]"
              style={{
                borderColor: customMode ? "var(--accent)" : "var(--border)",
                backgroundColor: customMode
                  ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                  : "var(--bg-secondary)",
                color: "var(--text)",
              }}
            >
              Custom
            </button>
          </div>
          {customMode && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="t-meta" htmlFor="fast-custom-hours">Fasting hours</label>
                <Input
                  id="fast-custom-hours"
                  type="number"
                  min={MIN_FAST_MINUTES / 60}
                  max={MAX_FAST_MINUTES / 60}
                  step="0.5"
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value)}
                  className="w-32"
                />
              </div>
              <p className="t-meta normal-case tracking-normal">
                {MIN_FAST_MINUTES / 60}–{MAX_FAST_MINUTES / 60} hours
              </p>
            </div>
          )}
          {inputError && <p role="alert" className="t-body mt-2 text-sm" style={{ color: "var(--error)" }}>{inputError}</p>}
          <LuxButton className="mt-5 w-full sm:w-auto" onClick={handleStart}>
            <Play size={17} aria-hidden="true" /> Start{" "}
            {customMode ? `${customHours || "?"}h` : `${preset}h`} fast
          </LuxButton>

          {confirmReplace && active && (
            <div
              role="alertdialog"
              aria-label="Replace the active fast"
              className="mt-4 rounded-xl border p-4"
              style={{ borderColor: "var(--warning, var(--accent))", backgroundColor: "var(--bg-secondary)" }}
            >
              <p className="t-body text-sm">
                <strong>A fast is already running</strong> — started{" "}
                {fmtClock(Date.parse(active.startedAt))}, {formatRemaining(remainingMs(active, now))} left.
                Starting a new fast replaces it.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <LuxButton variant="secondary" onClick={() => { const h = selectedHours(); if (h != null) beginFast(h); }}>
                  Replace fast
                </LuxButton>
                <LuxButton variant="ghost" onClick={() => setConfirmReplace(false)}>
                  Keep current fast
                </LuxButton>
              </div>
            </div>
          )}
        </GlassPanel>
      )}

      {/* -------- fasting: live timer -------- */}
      {phase === "fasting" && active && (
        <GlassPanel className="mt-4 p-6 text-center">
          <p className="t-meta">Fasting in progress</p>
          <div className="mt-4 flex justify-center">
            <ProgressRing value={pct} size={200} strokeWidth={14} showValue={false} label={`${Math.round(pct)}%`} />
          </div>
          <p className="t-numeral mt-4 text-4xl" aria-live="off">{formatRemaining(rem)}</p>
          <p className="t-body mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            remaining of a {formatDuration(active.targetMinutes * 60_000)} fast
          </p>
          <p className="t-meta mt-2 normal-case tracking-normal">
            Started {fmtClock(Date.parse(active.startedAt))} · ends {fmtClock(fastEndMs(active))}
          </p>
          <LuxButton variant="secondary" className="mt-5" onClick={handleEnd}>
            <Square size={16} aria-hidden="true" /> End fast
          </LuxButton>
        </GlassPanel>
      )}

      {/* -------- complete: summary + journal -------- */}
      {phase === "complete" && completed && completed.endedAt && (
        <GlassPanel className="mt-4 p-6">
          <h2 className="t-card-heading">Fast complete</h2>
          <p className="t-body mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Nice work — here&apos;s how it went.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
              <p className="t-numeral text-2xl">{formatDuration(elapsedMs(completed, Date.now()))}</p>
              <p className="t-meta mt-1 normal-case tracking-normal">Duration</p>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
              <p className="t-numeral text-2xl">{completionPct(completed, Date.now())}%</p>
              <p className="t-meta mt-1 normal-case tracking-normal">Of target</p>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
              <p className="t-numeral text-2xl">{formatDuration(completed.targetMinutes * 60_000)}</p>
              <p className="t-meta mt-1 normal-case tracking-normal">Target</p>
            </div>
          </div>
          <div className="mt-4">
            <label className="t-meta" htmlFor="fast-note">Note (optional)</label>
            <Input
              id="fast-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How did it feel?"
              maxLength={500}
              disabled={journalSaved}
              className="mt-1"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {journalSaved ? (
              <p className="t-body text-sm" style={{ color: "var(--success)" }} role="status">
                Logged to your journal.
              </p>
            ) : (
              <LuxButton variant="secondary" onClick={handleLogToJournal}>
                <Hourglass size={16} aria-hidden="true" /> Log to journal
              </LuxButton>
            )}
            <LuxButton variant="ghost" onClick={handleDismissComplete}>
              {journalSaved ? "Done" : "Dismiss"}
            </LuxButton>
          </div>
        </GlassPanel>
      )}

      {/* -------- journal history -------- */}
      {(phase === "idle" || phase === "complete") && journal.length > 0 && (
        <GlassPanel className="mt-4 p-5">
          <h2 className="t-card-heading">Recent fasts</h2>
          <ul className="mt-3 space-y-2">
            {journal.slice(0, 5).map((e) => (
              <li
                key={e.loggedAt}
                className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}
              >
                <div>
                  <p className="t-body text-sm font-medium">
                    <span className="t-numeral">{formatDuration(e.durationMinutes * 60_000)}</span>
                    {" "}· <span className="t-numeral">{e.completionPct}%</span> of target
                  </p>
                  <p className="t-meta normal-case tracking-normal">
                    {new Date(e.startedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="t-meta mt-2 normal-case tracking-normal">Kept on this device only.</p>
        </GlassPanel>
      )}
    </div>
  );
}
