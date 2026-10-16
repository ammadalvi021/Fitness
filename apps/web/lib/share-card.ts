/**
 * V20 Feature 7 — Shareable progress cards: pure data-selection logic.
 *
 * These functions decide WHICH card variants a user can share and what the
 * card says. They never fabricate: when a stat has no backing records the
 * variant's data is `null` (unavailable), never zero-filled.
 *
 * No DOM, no canvas here — that lives in components/ShareCard.tsx — so this
 * module is fully unit-testable.
 */

export type ShareCardVariant = "weight" | "streak" | "milestone";

/** A real weigh-in: ISO date string + kilograms. */
export interface WeightPoint {
  date: string;
  kg: number;
}

export interface WeightCardData {
  variant: "weight";
  startKg: number;
  currentKg: number;
  /** Signed change in kg (negative = loss, positive = gain). */
  deltaKg: number;
  /** "lost" | "gained" | "held" */
  direction: "lost" | "gained" | "held";
  /** Full weeks spanned by the journey (min 1). */
  weeks: number;
  /** Chronological points for the card's sparkline. */
  points: WeightPoint[];
}

export interface StreakCardData {
  variant: "streak";
  /** Consecutive active days. */
  days: number;
}

export interface MilestoneCardData {
  variant: "milestone";
  kind: "workouts" | "days" | "kcal";
  count: number;
  /** Timeframe the milestone was earned over, e.g. "last 90 days". */
  timeframeLabel: string;
}

export type ShareCardData = WeightCardData | StreakCardData | MilestoneCardData;

export interface VariantAvailability {
  variant: ShareCardVariant;
  /** Null when the user's records don't support this variant. */
  data: ShareCardData | null;
  /** Explains what the user must do to unlock the variant (when data is null). */
  needsNote: string | null;
}

const VARIANT_LABELS: Record<ShareCardVariant, string> = {
  weight: "Weight journey",
  streak: "Logging streak",
  milestone: "Milestone",
};

export function variantLabel(variant: ShareCardVariant): string {
  return VARIANT_LABELS[variant];
}

/** Local YYYY-MM-DD for a Date. */
export function toDateOnlyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Extract a YYYY-MM-DD date from an ISO datetime string (or null). */
function dateOnly(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1] : null;
}

function isFiniteKg(kg: unknown): kg is number {
  return typeof kg === "number" && Number.isFinite(kg) && kg > 0;
}

/**
 * Build the weight-journey card data from weigh-ins.
 * Returns null unless there are ≥2 valid, distinct weight points.
 */
export function buildWeightCardData(points: WeightPoint[]): WeightCardData | null {
  const valid = (Array.isArray(points) ? points : [])
    .filter(
      (p): p is WeightPoint =>
        !!p && isFiniteKg(p.kg) && dateOnly(p.date) !== null
    )
    .map((p) => ({ date: dateOnly(p.date) as string, kg: p.kg }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (valid.length < 2) return null;

  const start = valid[0];
  const current = valid[valid.length - 1];
  const deltaKg = current.kg - start.kg;
  const abs = Math.abs(deltaKg);
  const direction = abs < 0.05 ? "held" : deltaKg < 0 ? "lost" : "gained";

  const ms = new Date(current.date).getTime() - new Date(start.date).getTime();
  const days = Math.max(1, Math.round(ms / 86_400_000));
  const weeks = Math.max(1, Math.round(days / 7));

  return {
    variant: "weight",
    startKg: start.kg,
    currentKg: current.kg,
    deltaKg,
    direction,
    weeks,
    points: valid,
  };
}

/**
 * Build the logging-streak card data from days the user logged anything
 * (meals, workouts, …). Counts consecutive calendar days ending today or
 * yesterday — a streak is alive if yesterday is the latest active day.
 * Returns null unless the streak is ≥2 days.
 */
export function buildStreakCardData(
  dayIsoStrings: string[],
  todayIso: string = toDateOnlyLocal(new Date())
): StreakCardData | null {
  const active = new Set<string>();
  for (const raw of Array.isArray(dayIsoStrings) ? dayIsoStrings : []) {
    if (typeof raw !== "string") continue;
    const d = dateOnly(raw);
    if (d && d <= todayIso) active.add(d);
  }
  if (active.size === 0) return null;

  const days: string[] = [];
  const cursor = new Date(`${todayIso}T12:00:00Z`);
  // A streak that ends yesterday still counts (the user may not have logged today yet).
  if (!active.has(toDateOnlyLocal(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!active.has(toDateOnlyLocal(cursor))) return null;
  }
  while (active.has(toDateOnlyLocal(cursor))) {
    days.push(toDateOnlyLocal(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  if (days.length < 2) return null;
  return { variant: "streak", days: days.length };
}

/**
 * Build the milestone card from diary/activity aggregates.
 * Picks the strongest available milestone; null when nothing exists.
 * Priority: workouts completed → days of meals logged → kcal tracked.
 */
export function buildMilestoneCardData(input: {
  workoutCount: number;
  loggedDays: number;
  totalKcal: number;
  timeframeLabel?: string;
}): MilestoneCardData | null {
  const timeframeLabel = input.timeframeLabel ?? "last 90 days";
  const workoutCount = Math.max(0, Math.floor(input.workoutCount || 0));
  const loggedDays = Math.max(0, Math.floor(input.loggedDays || 0));
  const totalKcal = Math.max(0, Math.floor(input.totalKcal || 0));

  if (workoutCount >= 1) {
    return { variant: "milestone", kind: "workouts", count: workoutCount, timeframeLabel };
  }
  if (loggedDays >= 1) {
    return { variant: "milestone", kind: "days", count: loggedDays, timeframeLabel };
  }
  if (totalKcal >= 1) {
    return { variant: "milestone", kind: "kcal", count: totalKcal, timeframeLabel };
  }
  return null;
}

const NEEDS_NOTES: Record<ShareCardVariant, string> = {
  weight:
    "Log at least 2 weigh-ins (a starting and a current weight) to unlock this card.",
  streak:
    "Log meals or workouts on 2 or more consecutive days to unlock this card.",
  milestone:
    "Log meals or complete workouts to unlock this card.",
};

/**
 * Decide, for every variant, whether the user's records support it.
 * Variants lacking data come back with data === null plus a note explaining
 * what is needed — they are never zero-filled.
 */
export function describeCardAvailability(input: {
  weights: WeightPoint[];
  activeDays: string[];
  workoutCount: number;
  loggedDays: number;
  totalKcal: number;
  timeframeLabel?: string;
  /** Test seam: pin "today" for the streak check. Defaults to real today. */
  todayIso?: string;
}): VariantAvailability[] {
  const weight = buildWeightCardData(input.weights);
  const streak = buildStreakCardData(input.activeDays, input.todayIso ?? toDateOnlyLocal(new Date()));
  const milestone = buildMilestoneCardData({
    workoutCount: input.workoutCount,
    loggedDays: input.loggedDays,
    totalKcal: input.totalKcal,
    timeframeLabel: input.timeframeLabel,
  });
  const byVariant: Record<ShareCardVariant, ShareCardData | null> = {
    weight,
    streak,
    milestone,
  };
  return (Object.keys(byVariant) as ShareCardVariant[]).map((variant) => {
    const data = byVariant[variant];
    return {
      variant,
      data,
      needsNote: data ? null : NEEDS_NOTES[variant],
    };
  });
}

/** Headline text for a card (what the user shares). */
export function cardHeadline(data: ShareCardData): string {
  switch (data.variant) {
    case "weight": {
      const abs = Math.abs(data.deltaKg).toFixed(1);
      const weeks = data.weeks === 1 ? "1 week" : `${data.weeks} weeks`;
      if (data.direction === "lost") return `I lost ${abs} kg in ${weeks}`;
      if (data.direction === "gained") return `I gained ${abs} kg in ${weeks}`;
      return `I held steady in ${weeks}`;
    }
    case "streak": {
      const days = data.days === 1 ? "1-day" : `${data.days}-day`;
      return `${days} logging streak`;
    }
    case "milestone": {
      if (data.kind === "workouts") {
        const w = data.count === 1 ? "workout" : "workouts";
        return `${data.count} ${w} completed`;
      }
      if (data.kind === "days") {
        const d = data.count === 1 ? "day" : "days";
        return `${data.count} ${d} of meals logged`;
      }
      return `${data.count.toLocaleString("en-US")} kcal tracked`;
    }
  }
}

/** Supporting line under the headline. */
export function cardSubline(data: ShareCardData): string {
  switch (data.variant) {
    case "weight": {
      const from = data.startKg.toFixed(1);
      const to = data.currentKg.toFixed(1);
      return `${from} kg → ${to} kg · my real weigh-ins`;
    }
    case "streak":
      return "meals & workouts logged, day after day";
    case "milestone":
      return `from my real logs · ${data.timeframeLabel}`;
  }
}

/** Small caps label naming the variant, drawn above the headline. */
export function cardEyebrow(data: ShareCardData): string {
  switch (data.variant) {
    case "weight":
      return "Weight journey";
    case "streak":
      return "Consistency";
    case "milestone":
      return "Milestone";
  }
}
