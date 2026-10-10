"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  ProgressRing,
  Select,
  Skeleton,
} from "@/components/ui";
import { num } from "@/lib/targets";
import { useSession } from "../layout";

const GOAL_OPTIONS = [
  { value: "lose", label: "Lose weight" },
  { value: "maintain", label: "Maintain weight" },
  { value: "gain", label: "Gain weight" },
  { value: "improve_fitness", label: "Improve fitness" },
  { value: "eat_healthier", label: "Eat healthier" },
];

export default function GoalsPage() {
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
      setNotice("Goals updated ✓");
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
    <div>
      <PageHeader
        title="Goals"
        subtitle="Set your direction — your targets and plans adapt to it."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          {error && (
            <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
          )}
          {notice && (
            <p role="status" className="mb-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">{notice}</p>
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
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? "Saving…" : "Save goals"}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Your progress
          </h2>
          {progress ? (
            <div className="mt-4 flex flex-col items-center gap-3">
              <ProgressRing
                value={progress.done}
                max={progress.band}
                size={150}
                label={`${progress.remaining.toFixed(1)} kg`}
                sublabel="to go"
              />
              <dl className="grid w-full grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800">
                  <dt className="text-xs text-neutral-500">Current</dt>
                  <dd className="font-bold text-neutral-900 dark:text-neutral-100">{progress.current.toFixed(1)} kg</dd>
                </div>
                <div className="rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800">
                  <dt className="text-xs text-neutral-500">Target</dt>
                  <dd className="font-bold text-neutral-900 dark:text-neutral-100">{progress.target.toFixed(1)} kg</dd>
                </div>
                <div className="rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800">
                  <dt className="text-xs text-neutral-500">Goal</dt>
                  <dd className="font-bold text-neutral-900 dark:text-neutral-100">{goalLabel ?? "—"}</dd>
                </div>
              </dl>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Steady progress toward your goal beats perfection. Keep going 💪
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {goalLabel
                  ? `Your goal: ${goalLabel}. Add a target weight to track your progress toward it here.`
                  : "Choose a goal and add a target weight to see your progress here."}
              </p>
              <Link
                href="/progress"
                className="mt-4 inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                View detailed progress
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
