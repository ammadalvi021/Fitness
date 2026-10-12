"use client";

/**
 * /ramadan — Ramadan framework (V18 Phase E).
 *
 * Shown when profile.ramadanMode is on (toggle in Settings or below).
 *
 * - Sehri / Iftar meal-type shortcuts (deep-link into voice logging).
 * - Fasting window: TWO time inputs the USER sets themselves, stored in
 *   localStorage. These are NOT prayer times — FitFusion has no prayer-time
 *   source and never claims these are. Labeled as "your fasting window"
 *   everywhere.
 * - Water tracker reusing the WaterLog API, shown against the fasting window.
 * - Opt-in in-browser reminders (Notification API) for the window the user
 *   set. No times are ever fabricated: reminders only fire for user-set
 *   times, while this page is open.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Droplets, Mic, MoonStar } from "lucide-react";
import { api } from "@/lib/api";
import {
  clearFastingWindow,
  hhmmToMinutes,
  isValidWindowTime,
  loadFastingWindow,
  loadNotifyPref,
  minutesUntil,
  saveFastingWindow,
  saveNotifyPref,
  type FastingWindow,
} from "@/lib/ramadan";
import { GlassPanel, LuxButton } from "@/components/luxury";
import { Input, Skeleton } from "@/components/ui";
import { todayYMD } from "../nutrition/_shared";

function nowMinutes(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function inWindow(w: FastingWindow, mins: number = nowMinutes()): boolean {
  const s = hhmmToMinutes(w.start);
  const e = hhmmToMinutes(w.end);
  if (s === e) return false;
  return s < e ? mins >= s && mins < e : mins >= s || mins < e;
}

export default function RamadanPage() {
  const [mode, setMode] = useState<boolean | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [fastWindow, setFastWindow] = useState<FastingWindow | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [windowError, setWindowError] = useState<string | null>(null);

  const [waterMl, setWaterMl] = useState<number | null>(null);
  const [customWater, setCustomWater] = useState("");
  const [waterBusy, setWaterBusy] = useState(false);

  const [notifyOn, setNotifyOn] = useState(false);
  const [notifyState, setNotifyState] = useState<NotificationPermission | "unsupported">("default");
  const firedRef = useRef<Set<string>>(new Set());

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ profile?: { ramadanMode?: boolean } }>("/api/profile")
      .then((d) => { if (!cancelled) setMode(Boolean(d.profile?.ramadanMode)); })
      .catch(() => { if (!cancelled) setMode(false); });
    setFastWindow(loadFastingWindow());
    setNotifyOn(loadNotifyPref());
    setNotifyState(
      typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (fastWindow) {
      setStart(fastWindow.start);
      setEnd(fastWindow.end);
    }
  }, [fastWindow]);

  const refreshWater = useCallback(async () => {
    try {
      const d = await api<{ ml?: number }>(`/api/water?date=${todayYMD()}`);
      setWaterMl(typeof d.ml === "number" ? d.ml : 0);
    } catch {
      setWaterMl(null);
    }
  }, []);

  useEffect(() => {
    if (mode) void refreshWater();
  }, [mode, refreshWater]);

  async function setModePref(on: boolean) {
    setModeSaving(true);
    setError(null);
    try {
      await api("/api/profile", { method: "PUT", body: { ramadanMode: on } });
      setMode(on);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save Ramadan mode.");
    } finally {
      setModeSaving(false);
    }
  }

  function saveWindow() {
    setWindowError(null);
    if (!isValidWindowTime(start) || !isValidWindowTime(end)) {
      setWindowError("Enter both times as HH:MM (24-hour).");
      return;
    }
    if (saveFastingWindow({ start, end })) {
      setFastWindow({ start, end });
    } else {
      setWindowError("Couldn't save your fasting window on this device.");
    }
  }

  async function addWater(ml: number) {
    if (waterMl == null || ml <= 0) return;
    setWaterBusy(true);
    try {
      const d = await api<{ log?: { ml?: number } }>("/api/water", {
        method: "POST",
        body: { date: todayYMD(), ml: waterMl + ml },
      });
      setWaterMl(d.log?.ml ?? waterMl + ml);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log water.");
    } finally {
      setWaterBusy(false);
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setNotifyState("unsupported");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifyState(perm);
    const on = perm === "granted";
    setNotifyOn(on);
    saveNotifyPref(on);
  }

  function disableNotifications() {
    setNotifyOn(false);
    saveNotifyPref(false);
  }

  // Reminder ticker: fires only for the USER's set window, while this page
  // is open. Events: window start, window end, and a water nudge 2h after
  // the window ends.
  useEffect(() => {
    if (!notifyOn || notifyState !== "granted" || !fastWindow) return;
    const tick = () => {
      const today = todayYMD();
      const fire = (key: string, title: string, body: string, atHhmm: string) => {
        const k = `${today}:${key}`;
        if (firedRef.current.has(k)) return;
        // Fire within the minute the event time passes.
        const mins = nowMinutes();
        const target = hhmmToMinutes(atHhmm);
        const prev = mins - 1;
        const hit = prev < target && mins >= target;
        if (hit) {
          firedRef.current.add(k);
          try {
            new Notification(title, { body });
          } catch {
            /* ignore */
          }
        }
      };
      const w = fastWindow;
      fire("sehri", "Sehri", `Your fasting window starts now (${w.start}).`, w.start);
      fire("iftar", "Iftar", `Your fasting window ends now (${w.end}).`, w.end);
      const [eh, em] = w.end.split(":").map(Number);
      const waterAt = `${String((eh + 2) % 24).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
      fire("water", "Water reminder", "Fasting has ended — remember to rehydrate this evening.", waterAt);
    };
    const id = setInterval(tick, 30_000);
    tick();
    return () => clearInterval(id);
  }, [notifyOn, notifyState, fastWindow]);

  if (mode === null) {
    return (
      <div className="anim-page-enter">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="mt-4 h-40" />
      </div>
    );
  }

  if (!mode) {
    return (
      <div className="anim-page-enter">
        <h1 className="t-greeting">Ramadan</h1>
        <GlassPanel className="mt-4 p-6 text-center">
          <MoonStar size={28} aria-hidden="true" className="mx-auto" style={{ color: "var(--brand)" }} />
          <h2 className="t-card-heading mt-3">Ramadan mode is off</h2>
          <p className="t-body mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
            Turn it on for Sehri / Iftar meal types, fasting-window tools, and water
            tracking. No prayer times are shown — you set your own fasting window.
          </p>
          <LuxButton className="mt-4" disabled={modeSaving} onClick={() => void setModePref(true)}>
            {modeSaving ? "Turning on…" : "Turn on Ramadan mode"}
          </LuxButton>
        </GlassPanel>
      </div>
    );
  }

  const fastingNow = fastWindow ? inWindow(fastWindow) : null;

  return (
    <div className="anim-page-enter">
      <h1 className="t-greeting">Ramadan</h1>
      <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
        Sehri & Iftar logging, your fasting window, and water tracking.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl px-4 py-3 text-sm"
          style={{ color: "var(--error)", backgroundColor: "color-mix(in srgb, var(--error) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)" }}>
          {error}
        </p>
      )}

      {/* Sehri / Iftar shortcuts */}
      <GlassPanel className="mt-4 p-5">
        <h2 className="t-card-heading">Log a Ramadan meal</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Link href="/log/voice?meal=sehri" className="block">
            <div className="rounded-xl border p-4 transition-transform hover:scale-[1.01]" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
              <p className="t-body font-medium">Sehri</p>
              <p className="t-meta mt-1 normal-case tracking-normal">Voice-log your pre-dawn meal</p>
              <span className="t-meta mt-2 inline-flex items-center gap-1 underline underline-offset-2">
                <Mic size={13} aria-hidden="true" /> Open voice log
              </span>
            </div>
          </Link>
          <Link href="/log/voice?meal=iftar" className="block">
            <div className="rounded-xl border p-4 transition-transform hover:scale-[1.01]" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
              <p className="t-body font-medium">Iftar</p>
              <p className="t-meta mt-1 normal-case tracking-normal">Voice-log your fast-breaking meal</p>
              <span className="t-meta mt-2 inline-flex items-center gap-1 underline underline-offset-2">
                <Mic size={13} aria-hidden="true" /> Open voice log
              </span>
            </div>
          </Link>
        </div>
        <p className="t-meta mt-3 normal-case tracking-normal">
          Sehri and Iftar also appear as meal types in the nutrition diary while Ramadan mode is on.
        </p>
      </GlassPanel>

      {/* Fasting window */}
      <GlassPanel className="mt-4 p-5">
        <h2 className="t-card-heading">Your fasting window</h2>
        <p className="t-body mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Set the hours <strong>you</strong> fast. This is your own schedule —{" "}
          <strong>not prayer times</strong>. FitFusion has no prayer-time source and
          never shows them.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="t-meta" htmlFor="ram-start">Fasting starts</label>
            <Input id="ram-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-36" />
          </div>
          <div>
            <label className="t-meta" htmlFor="ram-end">Fasting ends</label>
            <Input id="ram-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-36" />
          </div>
          <LuxButton variant="secondary" onClick={saveWindow}>Save window</LuxButton>
          {fastWindow && (
            <button type="button" className="t-meta underline underline-offset-2" onClick={() => { clearFastingWindow(); setFastWindow(null); setStart(""); setEnd(""); }}>
              Clear
            </button>
          )}
        </div>
        {windowError && <p role="alert" className="t-body mt-2 text-sm" style={{ color: "var(--error)" }}>{windowError}</p>}
        {fastWindow && (
          <p className="t-body mt-3 text-sm" aria-live="polite">
            Your window: <strong>{fastWindow.start} – {fastWindow.end}</strong>
            {fastingNow != null && (
              <> · {fastingNow ? "you're in your fasting hours now" : "you're outside your fasting hours now"}</>
            )}
            {notifyOn && notifyState === "granted" && (
              <> · next Sehri reminder in ~{Math.round(minutesUntil(fastWindow!.start) / 60)}h</>
            )}
          </p>
        )}
      </GlassPanel>

      {/* Water */}
      <GlassPanel className="mt-4 p-5">
        <h2 className="t-card-heading flex items-center gap-2">
          <Droplets size={18} aria-hidden="true" /> Water today
        </h2>
        {waterMl === null ? (
          <Skeleton className="mt-3 h-10 w-40" />
        ) : (
          <>
            <p className="t-greeting mt-2">
              <span className="t-numeral">{waterMl.toLocaleString()}</span>{" "}
              <span className="t-body">ml</span>
            </p>
            {fastWindow && (
              <p className="t-meta mt-1 normal-case tracking-normal">
                {inWindow(fastWindow) ? "You're in your fasting hours — log water you drink outside them." : "Outside your fasting hours — a good time to rehydrate."}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <LuxButton variant="secondary" disabled={waterBusy} onClick={() => void addWater(250)}>+250 ml</LuxButton>
              <LuxButton variant="secondary" disabled={waterBusy} onClick={() => void addWater(500)}>+500 ml</LuxButton>
              <Input
                type="number" min={1} value={customWater}
                onChange={(e) => setCustomWater(e.target.value)}
                placeholder="ml" aria-label="Custom water amount in ml" className="w-24"
              />
              <LuxButton
                variant="secondary" disabled={waterBusy || !Number(customWater)}
                onClick={() => { const v = Number(customWater); setCustomWater(""); void addWater(v); }}
              >
                Add
              </LuxButton>
            </div>
          </>
        )}
      </GlassPanel>

      {/* Reminders */}
      <GlassPanel className="mt-4 p-5">
        <h2 className="t-card-heading flex items-center gap-2">
          <Bell size={18} aria-hidden="true" /> Reminders
        </h2>
        <p className="t-body mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          In-browser reminders for the start and end of <strong>your</strong> fasting
          window, plus an evening water nudge. They only work while this page is
          open, and only for times you set — nothing is fetched or assumed.
        </p>
        {!window && (
          <p className="t-meta mt-2 normal-case tracking-normal">Set your fasting window above first.</p>
        )}
        {notifyState === "unsupported" ? (
          <p className="t-body mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            This browser doesn&apos;t support notifications.
          </p>
        ) : notifyOn && notifyState === "granted" ? (
          <LuxButton variant="secondary" className="mt-3" onClick={disableNotifications}>
            <BellOff size={16} aria-hidden="true" /> Turn reminders off
          </LuxButton>
        ) : (
          <LuxButton className="mt-3" disabled={!window} onClick={() => void enableNotifications()}>
            <Bell size={16} aria-hidden="true" /> Enable reminders
          </LuxButton>
        )}
        {notifyState === "denied" && (
          <p className="t-body mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Notifications are blocked for this site — allow them in your browser settings to use reminders.
          </p>
        )}
      </GlassPanel>

      {/* Disable */}
      <GlassPanel className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="t-card-heading">Ramadan mode</h2>
            <p className="t-body mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Turn off to hide Sehri / Iftar meal types and this hub. Your logged data stays.
            </p>
          </div>
          <LuxButton variant="secondary" disabled={modeSaving} onClick={() => void setModePref(false)}>
            {modeSaving ? "Saving…" : "Turn off"}
          </LuxButton>
        </div>
      </GlassPanel>
    </div>
  );
}
