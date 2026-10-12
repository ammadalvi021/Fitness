"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Check, Target } from "lucide-react";
import { Field, Input, Select, Skeleton } from "@/components/ui";
import {
  GlassPanel,
  LuxButton,
  ProgressRing,
} from "@/components/luxury";
import { num } from "@/lib/targets";
import { useSession } from "@/components/session";

const GOAL_OPTIONS = [
  { value: "lose", label: "Lose weight" },
  { value: "maintain", label: "Maintain weight" },
  { value: "gain", label: "Gain weight" },
  { value: "improve_fitness", label: "Improve fitness" },
  { value: "eat_healthier", label: "Eat healthier" },
];

export default function GoalsPage() {
  const router = useRouter();
  const session = useSession();
  const profile = (session.profile ?? {}) as Record<string, unknown>;

  const [goal, setGoal] = useState<string>(String(profile.goal ?? ""));
  const [targetWeightKg, setTargetWeightKg] = useState<string>(
    profile.targetWeightKg != null ? String(profile.targetWeightKg) : ""
  );
  const [currentWeightKg, setCurrentWeightKg] = useState<string>(
    profile.weightKg != null ? String(profile.weightKg) : ""
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Refresh from the canonical profile endpoint on mount.
  useEffect(() => {
    let cancelled = false;
    api<{ profile?: Record<string, unknown> } | Record<string, unknown>>("/api/profile")
      .then((data) => {
        if (cancelled) return;
        const p = ("profile" in data && typeof data.profile === "object"
          ? data.profile
          : data) as Record<string, unknown>;
        if (p.goal) setGoal(String(p.goal));
        if (p.targetWeightKg != null) setTargetWeightKg(String(p.targetWeightKg));
        if (p.weightKg != null) setCurrentWeightKg(String(p.weightKg));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true); // fall back to session profile values
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const progress = useMemo(() => {
    const current = num(currentWeightKg === "" ? NaN : parseFloat(currentWeightKg), NaN);
    const target = num(targetWeightKg === "" ? NaN : parseFloat(targetWeightKg), NaN);
    if (!Number.isFinite(current) || !Number.isFinite(target) || current === target) {
      return null;
    }
    // Progress ring: how close current is to target, relative to a 10% band.
    const total = Math.abs(current - target);
    const band = Math.max(Math.abs(current) * 0.1, total, 1);
    const remaining = total;
    const done = Math.max(band - remaining, 0);
    return { current, target, remaining, done, band };
  }, [currentWeightKg, targetWeightKg]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (goal) body.goal = goal;
      const tw = parseFloat(targetWeightKg);
      if (Number.isFinite(tw) && tw > 0) body.targetWeightKg = tw;
      const cw = parseFloat(currentWeightKg);
      if (Number.isFinite(cw) && cw > 0) body.weightKg = cw;
      await api("/api/profile", { method: "PUT", body });
      setNotice("Goals updated");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your goals.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <div aria-busy="true" aria-label="Loading goals">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="mt-6 h-64" />
      </div>
    );
  }

  const goalLabel = GOAL_OPTIONS.find((o) => o.value === goal)?.label;

  return (
    <div className="anim-page-enter">
      <div className="mb-6">
        <h1 className="t-page-title flex items-center gap-3">
          <Target size={26} aria-hidden="true" style={{ color: "var(--accent)" }} />
          Goals
        </h1>
        <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
          Set your direction — your targets and plans adapt to it.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-6">
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-xl border p-3 text-sm"
              style={{
                borderColor: "color-mix(in srgb, var(--error) 45%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--error) 10%, transparent)",
                color: "var(--text)",
              }}
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm"
              style={{
                borderColor: "color-mix(in srgb, var(--success) 45%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--success) 10%, transparent)",
                color: "var(--text)",
              }}
            >
              <Check size={16} aria-hidden="true" style={{ color: "var(--success)" }} />
              {notice}
            </p>
          )}
          <form onSubmit={onSave} className="space-y-5">
            <Field label="My goal" htmlFor="goal-goal" hint="Your calorie target and recommendations follow this goal.">
              <Select id="goal-goal" value={goal} onChange={(e) => setGoal(e.target.value)}>
                <option value="">Choose a goal</option>
                {GOAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Target weight (kg)"
              htmlFor="goal-target"
              hint="Optional. A realistic target keeps your plan sustainable — no shame in adjusting it."
            >
              <Input
                id="goal-target"
                type="number"
                min={20}
                max={300}
                step="0.1"
                inputMode="decimal"
                value={targetWeightKg}
                onChange={(e) => setTargetWeightKg(e.target.value)}
                placeholder="e.g. 68"
              />
            </Field>
            <Field
              label="Current weight (kg)"
              htmlFor="goal-current"
              hint="Updates the weight on your profile so progress stays accurate."
            >
              <Input
                id="goal-current"
                type="number"
                min={20}
                max={300}
                step="0.1"
                inputMode="decimal"
                value={currentWeightKg}
                onChange={(e) => setCurrentWeightKg(e.target.value)}
                placeholder="e.g. 75"
              />
            </Field>
            <LuxButton type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save goals"}
            </LuxButton>
          </form>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h2 className="t-card-heading">Your progress</h2>
          {progress ? (
            <div className="mt-4 flex flex-col items-center gap-3">
              <div className="relative">
                <ProgressRing
                  value={Math.min((progress.done / progress.band) * 100, 100)}
                  size={150}
                  showValue={false}
                  label="Progress toward target weight"
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="t-numeral text-3xl">{progress.remaining.toFixed(1)}</span>
                  <span className="t-meta mt-1">kg to go</span>
                </div>
              </div>
              <dl className="grid w-full grid-cols-3 gap-2 text-center">
                {[
                  { label: "Current", value: `${progress.current.toFixed(1)} kg` },
                  { label: "Target", value: `${progress.target.toFixed(1)} kg` },
                  { label: "Goal", value: goalLabel ?? "—" },
                ].map((d) => (
                  <div
                    key={d.label}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}
                  >
                    <dt className="t-meta">{d.label}</dt>
                    <dd className="t-numeral mt-1 text-lg">{d.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="t-body text-center" style={{ color: "var(--text-secondary)" }}>
                Steady progress toward your goal beats perfection. Keep going.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <p className="t-body" style={{ color: "var(--text-secondary)" }}>
                {goalLabel
                  ? `Your goal: ${goalLabel}. Add a target weight to track your progress toward it here.`
                  : "Choose a goal and add a target weight to see your progress here."}
              </p>
              <LuxButton variant="secondary" onClick={() => router.push("/progress")}>
                View detailed progress
              </LuxButton>
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
