"use client";

/**
 * /progress — charts and trends.
 *
 * Data: GET /api/progress?days=N -> {weights, nutritionByDay, workouts, waterByDay}
 * (plus GET /api/measurements?type=weight as a fallback for the weight trend).
 * Every series is normalized defensively; new users get honest empty states.
 * There is no personal-records endpoint in the contract, so that section
 * renders from the progress payload when present and an empty state otherwise.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import {
  EmptyStateLux,
  ErrorStateLux,
  GlassPanel,
  LuxButton,
  MetricCard,
} from "@/components/luxury";
import { Trophy } from "lucide-react";
import {
  formatShortDate,
  pickArray,
  toNumber,
  toString,
} from "../workouts/_shared";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Range = 7 | 30 | 90;

interface WeightPoint {
  date: string;
  kg: number;
}
interface NutritionPoint {
  date: string;
  kcal: number;
  proteinG: number;
  targetKcal: number | null;
}
interface WorkoutPoint {
  date: string;
  volumeKg: number;
  durationMin: number | null;
  name: string;
}
interface WaterPoint {
  date: string;
  ml: number;
}

const TOOLTIP_STYLE = {
  backgroundColor: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  fontSize: "12px",
  color: "var(--text)",
} as const;

const AXIS_TICK = { fontSize: 11, fill: "var(--text-secondary)" } as const;

function ChartCard({
  title,
  subtitle,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty?: string;
}) {
  return (
    <GlassPanel className="p-6">
      <h2 className="t-card-heading">{title}</h2>
      {subtitle ? (
        <p className="t-meta mb-2">{subtitle}</p>
      ) : null}
      {empty ? (
        <p className="t-body py-8 text-center" style={{ color: "var(--text-secondary)" }}>
          {empty}
        </p>
      ) : (
        <div className="h-64 w-full">{children}</div>
      )}
    </GlassPanel>
  );
}

function normalizeWeights(data: unknown): WeightPoint[] {
  const fromProgress = pickArray<Record<string, unknown>>(data, "weights").map((w) => ({
    date: toString(w.date) ?? toString(w.recordedAt) ?? "",
    kg: toNumber(w.value) ?? toNumber(w.weightKg) ?? 0,
  }));
  return fromProgress
    .filter((p) => p.date && p.kg > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export default function ProgressPage() {
  const router = useRouter();
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<unknown>(null);
  const [measurementWeights, setMeasurementWeights] = useState<WeightPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [p, m] = await Promise.all([
          api<unknown>(`/api/progress?days=${range}`),
          api<unknown>("/api/measurements?type=weight").catch(() => null),
        ]);
        if (cancelled) return;
        setProgress(p);
        const mw = pickArray<Record<string, unknown>>(m, "measurements")
          .map((w) => ({
            date: toString(w.recordedAt) ?? toString(w.date) ?? "",
            kg: toNumber(w.value) ?? 0,
          }))
          .filter((x) => x.date && x.kg > 0)
          .sort((a, b) => a.date.localeCompare(b.date));
        setMeasurementWeights(mw);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : "Couldn't load your progress.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const weights = useMemo(() => {
    const w = normalizeWeights(progress);
    return w.length ? w : measurementWeights;
  }, [progress, measurementWeights]);

  const nutrition = useMemo< NutritionPoint[]>(() => {
    return pickArray<Record<string, unknown>>(progress, "nutritionByDay")
      .map((n) => ({
        date: toString(n.date) ?? toString(n.day) ?? "",
        kcal: toNumber(n.kcal) ?? 0,
        proteinG: toNumber(n.proteinG) ?? 0,
        targetKcal: toNumber(n.targetKcal) ?? toNumber(n.calorieTarget),
      }))
      .filter((p) => p.date)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [progress]);

  const workouts = useMemo<WorkoutPoint[]>(() => {
    return pickArray<Record<string, unknown>>(progress, "workouts")
      .map((w) => ({
        date: toString(w.date) ?? toString(w.startedAt) ?? "",
        volumeKg: toNumber(w.volumeKg) ?? toNumber(w.volume) ?? 0,
        durationMin: toNumber(w.durationMin) ?? toNumber(w.durationMinutes),
        name: toString(w.name) ?? "Workout",
      }))
      .filter((p) => p.date)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [progress]);

  const water = useMemo<WaterPoint[]>(() => {
    return pickArray<Record<string, unknown>>(progress, "waterByDay")
      .map((w) => ({
        date: toString(w.date) ?? toString(w.day) ?? "",
        ml: toNumber(w.ml) ?? 0,
      }))
      .filter((p) => p.date)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [progress]);

  const weeklyVolume = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const w of workouts) {
      const d = new Date(w.date);
      if (Number.isNaN(d.getTime())) continue;
      // ISO week bucket (Monday start)
      const monday = new Date(d);
      const day = (d.getDay() + 6) % 7;
      monday.setDate(d.getDate() - day);
      const key = monday.toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) ?? 0) + w.volumeKg);
    }
    return Array.from(buckets.entries())
      .map(([week, kg]) => ({ week: formatShortDate(week), kg: Math.round(kg) }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }, [workouts]);

  const targets = nutrition.map((n) => n.targetKcal).filter((t): t is number => t != null);
  const avgTarget = targets.length ? Math.round(targets.reduce((a, b) => a + b, 0) / targets.length) : null;

  const personalRecords = useMemo(() => {
    const rec = (progress as Record<string, unknown> | null)?.personalRecords;
    return Array.isArray(rec) ? rec : [];
  }, [progress]);

  const latestWeight = weights.length ? weights[weights.length - 1] : null;
  const firstWeight = weights.length ? weights[0] : null;
  const weightDelta =
    latestWeight && firstWeight && weights.length > 1
      ? latestWeight.kg - firstWeight.kg
      : null;

  const totalWorkouts = workouts.length;
  const avgProtein =
    nutrition.length
      ? Math.round(nutrition.reduce((a, n) => a + n.proteinG, 0) / nutrition.length)
      : null;

  return (
    <div className="anim-page-enter">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">Progress</h1>
          <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
            Trends across weight, nutrition, training, and hydration.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border p-1" style={{ borderColor: "var(--border)" }} role="group" aria-label="Date range">
          {([7, 30, 90] as Range[]).map((r) => (
            <LuxButton
              key={r}
              variant={range === r ? "primary" : "ghost"}
              className="px-4"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {r}d
            </LuxButton>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4" aria-label="Loading progress">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : error ? (
        <ErrorStateLux
          title="Couldn't load progress"
          message={error}
          onRetry={() => window.location.reload()}
        />
      ) : (
        <>
          {/* Headline stats */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Latest weight"
              value={latestWeight ? <span className="t-numeral">{latestWeight.kg.toFixed(1)} kg</span> : "—"}
              subtext={latestWeight ? formatShortDate(latestWeight.date) : "No weigh-ins yet"}
            />
            <MetricCard
              label={`Change (${range}d)`}
              value={
                weightDelta == null ? "—" : (
                  <span className="t-numeral">
                    {weightDelta > 0 ? "+" : ""}{weightDelta.toFixed(1)} kg
                  </span>
                )
              }
              subtext="Neutral trend info, not a verdict"
            />
            <MetricCard
              label="Workouts"
              value={<span className="t-numeral">{totalWorkouts}</span>}
              subtext={`in the last ${range} days`}
            />
            <MetricCard
              label="Avg protein"
              value={avgProtein != null ? <span className="t-numeral">{avgProtein} g</span> : "—"}
              subtext="per day"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Weight trend"
              subtitle="Your weigh-ins over time."
              empty={weights.length < 1 ? "No weight entries yet — log your first weigh-in to start the trend." : undefined}
            >
              {weights.length >= 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weights.map((w) => ({ ...w, label: formatShortDate(w.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="var(--text-secondary)" />
                    <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={24} />
                    <YAxis
                      tick={AXIS_TICK}
                      domain={["auto", "auto"]}
                      label={{ value: "kg", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--text-secondary)" }}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Line type="monotone" dataKey="kg" name="Weight (kg)" stroke="var(--accent)" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : null}
            </ChartCard>

            <ChartCard
              title="Nutrition adherence"
              subtitle="Calories logged vs your daily target."
              empty={nutrition.length < 1 ? "No nutrition data in this range — log meals to see adherence." : undefined}
            >
              {nutrition.length >= 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nutrition.map((n) => ({ ...n, label: formatShortDate(n.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="var(--text-secondary)" />
                    <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={24} />
                    <YAxis tick={AXIS_TICK} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    <Bar dataKey="kcal" name="Calories" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                    {avgTarget != null ? (
                      <ReferenceLine
                        y={avgTarget}
                        stroke="var(--accent-muted)"
                        strokeDasharray="6 4"
                        label={{ value: `Target ~${avgTarget}`, fontSize: 11, position: "insideTopRight", fill: "var(--text-secondary)" }}
                      />
                    ) : null}
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </ChartCard>

            <ChartCard
              title="Protein trend"
              subtitle="Daily protein intake (g)."
              empty={nutrition.length < 1 ? "No nutrition data in this range." : undefined}
            >
              {nutrition.length >= 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={nutrition.map((n) => ({ ...n, label: formatShortDate(n.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="var(--text-secondary)" />
                    <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={24} />
                    <YAxis tick={AXIS_TICK} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="proteinG" name="Protein (g)" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </ChartCard>

            <ChartCard
              title="Training volume per week"
              subtitle="Total load lifted (sets × reps × kg)."
              empty={weeklyVolume.length < 1 ? "No logged workouts with volume data yet — finish a session to see it here." : undefined}
            >
              {weeklyVolume.length >= 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyVolume}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="var(--text-secondary)" />
                    <XAxis dataKey="week" tick={AXIS_TICK} />
                    <YAxis tick={AXIS_TICK} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="kg" name="Volume (kg)" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </ChartCard>

            <ChartCard
              title="Water intake"
              subtitle="Milliliters logged per day."
              empty={water.length < 1 ? "No water logs in this range." : undefined}
            >
              {water.length >= 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={water.map((w) => ({ ...w, label: formatShortDate(w.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="var(--text-secondary)" />
                    <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={24} />
                    <YAxis tick={AXIS_TICK} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="ml" name="Water (ml)" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </ChartCard>

            <GlassPanel className="p-6">
              <h2 className="t-card-heading flex items-center gap-2">
                <Trophy size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
                Personal records
              </h2>
              {personalRecords.length ? (
                <ul className="mt-2 divide-y" style={{ borderColor: "var(--border)" }}>
                  {personalRecords.map((pr, i) => {
                    const r = pr as Record<string, unknown>;
                    return (
                      <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="t-body font-medium">
                          {toString(r.exerciseName) ?? toString(r.name) ?? "Record"}
                        </span>
                        <span className="t-body" style={{ color: "var(--text-secondary)" }}>
                          {toString(r.value) ?? ""}
                          {toString(r.unit) ? ` ${toString(r.unit)}` : ""}
                          {toString(r.metric) ? ` · ${toString(r.metric)}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-2">
                  <EmptyStateLux
                    title="No personal records yet"
                    message="Complete workouts and log your lifts — your first records will appear here."
                    action={
                      <LuxButton variant="secondary" onClick={() => router.push("/workouts")}>
                        Go to workouts
                      </LuxButton>
                    }
                  />
                </div>
              )}
            </GlassPanel>
          </div>

          <p className="t-meta mt-6">
            Trends are informational and based on what you&apos;ve logged. If you have a
            medical condition, are pregnant, or are under 18, please consult a qualified
            health professional for personalized guidance.
          </p>
        </>
      )}
    </div>
  );
}
