"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Check, Droplets, Info } from "lucide-react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, ApiError } from "@/lib/api";
import { Field, Input, Skeleton } from "@/components/ui";
import {
  EmptyStateLux,
  GlassPanel,
  LuxButton,
  MetricCard,
  Tooltip as LuxTooltip,
} from "@/components/luxury";
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
  const router = useRouter();
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
    <div className="anim-page-enter">
      <div className="mb-6">
        <h1 className="t-page-title flex items-center gap-3">
          <Calculator size={26} aria-hidden="true" style={{ color: "var(--accent)" }} />
          Calculators
        </h1>
        <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
          Quick health math, explained plainly.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------ BMI ------------------------------ */}
        <GlassPanel className="p-6">
          <h2 className="t-card-heading">BMI calculator</h2>
          <div className="mt-3 flex gap-2" role="group" aria-label="Units">
            {(["metric", "imperial"] as const).map((u) => (
              <LuxButton
                key={u}
                variant={units === u ? "primary" : "secondary"}
                className="flex-1"
                aria-pressed={units === u}
                onClick={() => setUnits(u)}
              >
                {u === "metric" ? "Metric (kg, cm)" : "Imperial (lb, in)"}
              </LuxButton>
            ))}
          </div>

          <form onSubmit={calculate} className="mt-4 space-y-4">
            {calcError && (
              <p
                role="alert"
                className="rounded-xl border p-3 text-sm"
                style={{
                  borderColor: "color-mix(in srgb, var(--error) 45%, transparent)",
                  backgroundColor: "color-mix(in srgb, var(--error) 10%, transparent)",
                  color: "var(--text)",
                }}
              >
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
            <LuxButton type="submit" className="w-full" disabled={calculating}>
              {calculating ? "Calculating…" : "Calculate BMI"}
            </LuxButton>
          </form>

          {result && (
            <div
              className="mt-5 rounded-2xl border p-5"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}
              aria-live="polite"
            >
              <p className="t-meta">Your BMI</p>
              <p className="t-numeral mt-1 text-4xl" style={{ color: "var(--accent)" }}>
                {result.bmi}
              </p>
              {result.classificationLabel && (
                <p className="t-body mt-1 font-medium">
                  Classification: {result.classificationLabel}
                </p>
              )}
              <p className="t-meta mt-2">
                {result.screeningNote || "BMI is a screening measure, not a diagnosis."}
              </p>
              {result.isMinor && result.pediatricGuidance && (
                <p
                  role="note"
                  className="t-meta mt-2 rounded-xl border p-3"
                  style={{
                    borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)",
                    backgroundColor: "color-mix(in srgb, var(--warning) 10%, transparent)",
                    color: "var(--text)",
                  }}
                >
                  {result.pediatricGuidance}
                </p>
              )}
              {!saved ? (
                <LuxButton
                  variant="secondary"
                  className="mt-3"
                  onClick={saveResult}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save to history"}
                </LuxButton>
              ) : (
                <p role="status" className="t-body mt-3 flex items-center gap-1.5 font-medium" style={{ color: "var(--success)" }}>
                  <Check size={16} aria-hidden="true" />
                  Saved to your history
                </p>
              )}
            </div>
          )}

          {/* BMI history */}
          <h3 className="t-meta mt-6 uppercase">BMI history</h3>
          {history === null ? (
            <Skeleton className="mt-2 h-32" />
          ) : historySeries.length >= 2 ? (
            <div className="mt-2 h-36" role="img" aria-label={`BMI history chart with ${historySeries.length} points`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historySeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickFormatter={(d: string) => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-secondary)" }} domain={["auto", "auto"]} />
                  <Tooltip
                    formatter={(v) => [v, "BMI"]}
                    contentStyle={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: "var(--text)",
                    }}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="t-body mt-2" style={{ color: "var(--text-secondary)" }}>
              No BMI history yet — calculate and save your BMI to track it over time.
            </p>
          )}
        </GlassPanel>

        {/* ---------------- BMR / TDEE / targets ---------------- */}
        <div className="space-y-4">
          <GlassPanel className="p-6">
            <h2 className="t-card-heading">Your energy numbers</h2>
            {targets ? (
              <>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <MetricCard label="BMR" value={<span className="t-numeral">{targets.bmr}</span>} subtext="kcal / day" />
                  <MetricCard label="TDEE" value={<span className="t-numeral">{targets.tdee}</span>} subtext="kcal / day" />
                  <MetricCard
                    label="Target"
                    value={<span className="t-numeral" style={{ color: "var(--accent)" }}>{targets.calorie.targetKcal}</span>}
                    subtext="kcal / day"
                  />
                </dl>
                <div className="t-body mt-4 space-y-2" style={{ color: "var(--text-secondary)" }}>
                  <p>
                    <strong className="font-semibold" style={{ color: "var(--text)" }}>BMR</strong> (basal metabolic rate) is the energy your body uses at complete rest, estimated with the Mifflin-St Jeor equation from your age, sex, height, and weight.
                  </p>
                  <p>
                    <strong className="font-semibold" style={{ color: "var(--text)" }}>TDEE</strong> (total daily energy expenditure) multiplies BMR by your activity level to estimate what you burn on a typical day.
                  </p>
                  <p>
                    <strong className="font-semibold" style={{ color: "var(--text)" }}>Target</strong> adjusts TDEE for your goal — a moderate deficit for weight loss, a small surplus for gain, or maintenance otherwise — with safe floors applied.
                  </p>
                </div>
                {targets.calorie.warnings.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {targets.calorie.warnings.map((w) => (
                      <li
                        key={w}
                        role="note"
                        className="t-meta rounded-xl border p-3"
                        style={{
                          borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)",
                          backgroundColor: "color-mix(in srgb, var(--warning) 10%, transparent)",
                          color: "var(--text)",
                        }}
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                {targets.calorie.professionalGuidance && (
                  <p
                    role="note"
                    className="t-meta mt-3 rounded-xl border p-3"
                    style={{
                      borderColor: "color-mix(in srgb, var(--accent) 45%, transparent)",
                      backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)",
                      color: "var(--text)",
                    }}
                  >
                    {targets.calorie.professionalGuidance}
                  </p>
                )}
              </>
            ) : (
              <EmptyStateLux
                icon={<Calculator size={22} aria-hidden="true" />}
                title="Add your measurements"
                message="We need your height, weight, and age to estimate your energy needs."
                action={
                  <LuxButton onClick={() => router.push("/onboarding")}>
                    Complete onboarding
                  </LuxButton>
                }
              />
            )}
          </GlassPanel>

          {targets && (
            <GlassPanel className="p-6">
              <h2 className="t-card-heading">Daily macro targets</h2>
              <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
                Based on <span className="t-numeral">{targets.calorie.targetKcal}</span> kcal / day.
                <LuxTooltip tip="Estimated with the Mifflin-St Jeor equation from your age, sex, height and weight, adjusted for your activity level and goal.">
                  <Info size={13} aria-hidden="true" className="ml-1 inline cursor-help" style={{ color: "var(--text-secondary)" }} />
                </LuxTooltip>
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Protein", value: `${targets.macros.proteinG} g` },
                  { label: "Carbs", value: `${targets.macros.carbsG} g` },
                  { label: "Fat", value: `${targets.macros.fatG} g` },
                  { label: "Fiber", value: `${targets.macros.fiberG} g` },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="rounded-xl border p-3 text-center"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}
                  >
                    <dt className="t-meta">{m.label}</dt>
                    <dd className="t-numeral mt-1 text-lg">{m.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="t-meta mt-3 flex items-center gap-1.5">
                <Droplets size={13} aria-hidden="true" style={{ color: "var(--accent)" }} />
                Water target: <span className="t-numeral">{(num(targets.waterMl) / 1000).toFixed(1)}</span> L / day (35 ml per kg, adjusted for activity).
              </p>
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}
