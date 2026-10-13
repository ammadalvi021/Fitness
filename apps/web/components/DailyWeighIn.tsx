"use client";

/**
 * DailyWeighIn — once-per-day "Morning weigh-in" nudge.
 *
 * On first dashboard view of the day (user-local date), if no weight
 * measurement has been recorded today and the user hasn't skipped, show a
 * modal asking for today's weight. Saving posts to /api/measurements;
 * skipping dismisses until tomorrow. Never blocks the app.
 */
import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { GlassPanel, LuxButton } from "./luxury";
import { Input, Modal } from "./ui";

function todayKey(): string {
  const d = new Date();
  return `ff-weighin-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isToday(iso: string): boolean {
  const r = new Date(iso);
  const n = new Date();
  return (
    r.getFullYear() === n.getFullYear() &&
    r.getMonth() === n.getMonth() &&
    r.getDate() === n.getDate()
  );
}

async function readJson(res: Response): Promise<{ ok: boolean; data?: any }> {
  try {
    const data = await res.json();
    return { ok: res.ok, data };
  } catch {
    return { ok: false };
  }
}

export function DailyWeighIn({ unitSystem = "metric" }: { unitSystem?: string }) {
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unit = unitSystem === "imperial" ? "lb" : "kg";

  useEffect(() => {
    let cancelled = false;
    // Already handled today (saved or skipped)?
    try {
      if (localStorage.getItem(todayKey())) return;
    } catch {
      /* storage unavailable — still check the server below */
    }
    (async () => {
      try {
        const res = await fetch("/api/measurements?type=weight&limit=1", {
          credentials: "include",
        });
        const { ok, data } = await readJson(res);
        if (cancelled || !ok) return;
        const latest = data?.measurements?.[0];
        if (latest && isToday(latest.recordedAt)) {
          try {
            localStorage.setItem(todayKey(), "done");
          } catch {}
          return;
        }
        // Small delay so the prompt doesn't fight the page-load animation.
        setTimeout(() => {
          if (!cancelled) setOpen(true);
        }, 1200);
      } catch {
        /* offline or unauthenticated — stay silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = (mark: string) => {
    try {
      localStorage.setItem(todayKey(), mark);
    } catch {}
    setOpen(false);
  };

  const save = async () => {
    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0 || value > 500) {
      setError(`Enter a valid weight in ${unit}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/measurements", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "weight", value, unit }),
      });
      const { ok } = await readJson(res);
      if (!ok) throw new Error("save failed");
      dismiss("done");
    } catch {
      setError("Couldn't save just now — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={() => dismiss("skipped")} title="Morning weigh-in">
      <GlassPanel className="p-6 text-center">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)",
            color: "var(--accent)",
          }}
        >
          <Scale size={24} aria-hidden="true" />
        </span>
        <p className="t-body mt-3" style={{ color: "var(--text-secondary)" }}>
          Weigh in each morning — the trend is built one sunrise at a time.
        </p>
        <div className="mt-4 flex gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={1}
            aria-label={`Today's weight in ${unit}`}
            placeholder={unit}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            className="min-h-[44px] flex-1 text-center text-lg"
            autoFocus
          />
          <LuxButton onClick={() => void save()} disabled={saving} className="min-h-[44px]">
            {saving ? "Saving…" : "Save"}
          </LuxButton>
        </div>
        {error && (
          <p role="alert" className="t-body mt-2" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => dismiss("skipped")}
          className="t-body mt-3 underline underline-offset-2"
          style={{ color: "var(--text-secondary)" }}
        >
          Skip for now
        </button>
      </GlassPanel>
    </Modal>
  );
}
