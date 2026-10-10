"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { profileTargets, num, ageFromDob } from "@/lib/targets";
import { useSession } from "../layout";

interface BmiResult {
  bmi: number;
  isMinor: boolean;
  classificationKey: string | null;
  classificationLabel: string | null;
  screeningNote: string;
  pediatricGuidance?: string;
}

interface MeasurementLike {
  value?: number;
  recordedAt?: string;
  createdAt?: string;
}

export default function CalculatorsPage() {
  const session = useSession();
  const profile = (session.profile ?? {}) as Record<string, unknown>;

  const [units, setUnits] = useState<"metric" | "imperial">("metric");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [result, setResult] = useState<BmiResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [history, setHistory] = useState<MeasurementLike[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ measurements?: MeasurementLike[] } | MeasurementLike[]>(
      "/api/measurements?type=bmi"
    )
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data)
          ? data
          : Array.isArray((data as { measurements?: MeasurementLike[] }).measurements)
            ? (data as { measurements?: MeasurementLike[] }).measurements!
            : [];
        setHistory(list);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefill age from the profile when available.
  useEffect(() => {
    const a = ageFromDob(profile.dateOfBirth);
    if (a !== undefined) setAge(String(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targets = useMemo(() => profileTargets(profile), [profile]);

  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    setCalcError(null);
    setSaved(false);
    setCalculating(true);
    try {
      const res = await api<BmiResult>("/api/calculators/bmi", {
        method: "POST",
        body: {
          weight: parseFloat(weight),
          height: parseFloat(height),
          units,
          ageYears: age ? parseInt(age, 10) : undefined,
        },
      });
      setResult(res);
    } catch (err) {
      setCalcError(
        err instanceof ApiError
          ? err.message
          : "Couldn't calculate BMI. Check your numbers and try again."
      );
    } finally {
      setCalculating(false);
    }
  }

  async function saveResult() {
    if (!result) return;
    setSaving(true);
    try {
      await api("/api/measurements", {
        method: "POST",
        body: { type: "bmi", value: result.bmi, unit: "kg/m²" },
      });
      setSaved(true);
      // Refresh history.
      const data = await api<{ measurements?: MeasurementLike[] } | MeasurementLike[]>(
        "/api/measurements?type=bmi"
      );
      const list = Array.isArray(data)
        ? data
        : (data as { measurements?: MeasurementLike[] }).measurements ?? [];
      setHistory(list);
    } catch {
      setCalcError("Couldn't save this result. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const historySeries = useMemo(() => {
    const pts = (history ?? [])
      .filter((m) => typeof m.value === "number")
      .map((m) => ({
        date: ((m.recordedAt ?? m.createdAt ?? "") as string).slice(0, 10),
        value: Math.round((m.value as number) * 10) / 10,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return pts.slice(-30);
  }, [history]);

  return (
    <div>
      <PageHeader
        title="Calculators"
        subtitle="Quick health math, explained plainly."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------ BMI ------------------------------ */}
        <Card>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            BMI calculator
          </h2>
          <div className="mt-3 flex gap-2" role="group" aria-label="Units">
            {(["metric", "imperial"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnits(u)}
                aria-pressed={units === u}
                className={`min-h-[44px] flex-1 rounded-xl border px-4 text-sm font-medium ${
                  units === u
                    ? "border-brand bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                    : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                }`}
              >
                {u === "metric" ? "Metric (kg, cm)" : "Imperial (lb, in)"}
              </button>
            ))}
          </div>

          <form onSubmit={calculate} className="mt-4 space-y-4">
            {calcError && (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                {calcError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={units === "metric" ? "Weight (kg)" : "Weight (lb)"}
                htmlFor="bmi-weight"
                required
              >
                <Input
                  id="bmi-weight"
                  type="number"
                  required
                  min={1}
                  step="0.1"
                  inputMode="decimal"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder={units === "metric" ? "70" : "154"}
                />
              </Field>
              <Field
                label={units === "metric" ? "Height (cm)" : "Height (in)"}
                htmlFor="bmi-height"
                required
              >
                <Input
                  id="bmi-height"
                  type="number"
                  required
                  min={1}
                  step="0.1"
                  inputMode="decimal"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder={units === "metric" ? "170" : "67"}
                />
              </Field>
            </div>
            <Field
              label="Age (years, optional)"
              htmlFor="bmi-age"
              hint="Under 18? We'll show pediatric guidance instead of an adult classification."
            >
              <Input
                id="bmi-age"
                type="number"
                min={1}
                max={120}
                inputMode="numeric"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="30"
              />
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={calculating}>
              {calculating ? "Calculating…" : "Calculate BMI"}
            </Button>
          </form>

          {result && (
            <div className="mt-5 rounded-xl bg-neutral-100 p-4 dark:bg-neutral-800" aria-live="polite">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Your BMI
              </p>
              <p className="text-4xl font-extrabold text-neutral-900 dark:text-neutral-100">
                {result.bmi}
              </p>
              {result.classificationLabel && (
                <p className="mt-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Classification: {result.classificationLabel}
                </p>
              )}
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                {result.screeningNote || "BMI is a screening measure, not a diagnosis."}
              </p>
              {result.isMinor && result.pediatricGuidance && (
                <p role="note" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  {result.pediatricGuidance}
                </p>
              )}
              {!saved ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={saveResult}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save to history"}
                </Button>
              ) : (
                <p role="status" className="mt-3 text-sm font-medium text-green-700 dark:text-green-300">
                  Saved to your history ✓
                </p>
              )}
            </div>
          )}

          {/* BMI history */}
          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            BMI history
          </h3>
          {history === null ? (
            <Skeleton className="mt-2 h-32" />
          ) : historySeries.length >= 2 ? (
            <div className="mt-2 h-36" role="img" aria-label={`BMI history chart with ${historySeries.length} points`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                  <Tooltip formatter={(v) => [v, "BMI"]} />
                  <Line type="monotone" dataKey="value" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              No BMI history yet — calculate and save your BMI to track it over time.
            </p>
          )}
        </Card>

        {/* ---------------- BMR / TDEE / targets ---------------- */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Your energy numbers
            </h2>
            {targets ? (
              <>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800">
                    <dt className="text-xs text-neutral-500 dark:text-neutral-400">BMR</dt>
                    <dd className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{targets.bmr}</dd>
                    <dd className="text-[11px] text-neutral-500">kcal / day</dd>
                  </div>
                  <div className="rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800">
                    <dt className="text-xs text-neutral-500 dark:text-neutral-400">TDEE</dt>
                    <dd className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{targets.tdee}</dd>
                    <dd className="text-[11px] text-neutral-500">kcal / day</dd>
                  </div>
                  <div className="rounded-xl bg-green-100 p-3 dark:bg-green-900/30">
                    <dt className="text-xs text-green-700 dark:text-green-300">Target</dt>
                    <dd className="text-xl font-bold text-green-800 dark:text-green-200">{targets.calorie.targetKcal}</dd>
                    <dd className="text-[11px] text-green-600 dark:text-green-400">kcal / day</dd>
                  </div>
                </dl>
                <div className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
                  <p>
                    <strong className="text-neutral-800 dark:text-neutral-200">BMR</strong> (basal metabolic rate) is the energy your body uses at complete rest, estimated with the Mifflin-St Jeor equation from your age, sex, height, and weight.
                  </p>
                  <p>
                    <strong className="text-neutral-800 dark:text-neutral-200">TDEE</strong> (total daily energy expenditure) multiplies BMR by your activity level to estimate what you burn on a typical day.
                  </p>
                  <p>
                    <strong className="text-neutral-800 dark:text-neutral-200">Target</strong> adjusts TDEE for your goal — a moderate deficit for weight loss, a small surplus for gain, or maintenance otherwise — with safe floors applied.
                  </p>
                </div>
                {targets.calorie.warnings.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {targets.calorie.warnings.map((w) => (
                      <li key={w} role="note" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                {targets.calorie.professionalGuidance && (
                  <p role="note" className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
                    {targets.calorie.professionalGuidance}
                  </p>
                )}
              </>
            ) : (
              <EmptyState
                icon="🧮"
                title="Add your measurements"
                message="We need your height, weight, and age to estimate your energy needs."
                action={
                  <Link
                    href="/onboarding"
                    className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-dark"
                  >
                    Complete onboarding
                  </Link>
                }
              />
            )}
          </Card>

          {targets && (
            <Card>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Daily macro targets
              </h2>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Based on {targets.calorie.targetKcal} kcal / day.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Protein", value: `${targets.macros.proteinG} g` },
                  { label: "Carbs", value: `${targets.macros.carbsG} g` },
                  { label: "Fat", value: `${targets.macros.fatG} g` },
                  { label: "Fiber", value: `${targets.macros.fiberG} g` },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl bg-neutral-100 p-3 text-center dark:bg-neutral-800">
                    <dt className="text-xs text-neutral-500 dark:text-neutral-400">{m.label}</dt>
                    <dd className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{m.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
                Water target: {(num(targets.waterMl) / 1000).toFixed(1)} L / day (35 ml per kg, adjusted for activity).
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
