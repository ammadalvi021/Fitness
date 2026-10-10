/**
 * Shared types + defensive normalizers for the workout / progress / coach UI.
 * Lives inside the workout route scope (underscore = not a route).
 *
 * The server JSON shapes for WorkoutPlan.days, /api/progress and the coach
 * thread are not pinned in CONTRACT.md, so every parser below is defensive:
 * unknown fields fall back to sensible defaults instead of crashing.
 */

export interface Exercise {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  muscleGroups: string[];
  equipment: string[];
  difficulty: string;
  exerciseType?: string | null;
  trainingStyles: string[];
  homeSuitable: boolean;
  gymSuitable: boolean;
  steps?: unknown;
  breathing?: string | null;
  commonMistakes?: unknown;
  easierVariation?: string | null;
  harderVariation?: string | null;
  safetyNotes?: string | null;
  mediaType?: string | null;
  mediaUrl?: string | null;
}

export const WORKOUT_SAFETY_COPY =
  "Stop exercising and seek medical attention if you feel chest pain, dizziness, or unusual shortness of breath.";

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Coerce an unknown value to a string array (handles Prisma Json + JSON strings). */
export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((v): v is string => typeof v === "string");
        }
      } catch {
        /* fall through */
      }
    }
    return trimmed ? [trimmed] : [];
  }
  return [];
}

/** Pull an array out of either `{key: [...]}` or a bare array response. */
export function pickArray<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const v = (data as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

/** Pull a single object out of `{key: {...}}` or a bare object response. */
export function pickObject<T>(data: unknown, key: string): T | null {
  if (data && typeof data === "object") {
    if (Array.isArray(data)) return null;
    const rec = data as Record<string, unknown>;
    if (rec[key] && typeof rec[key] === "object") return rec[key] as T;
    return data as T;
  }
  return null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function toString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function difficultyTone(difficulty: string): "green" | "amber" | "red" | "gray" {
  if (difficulty === "beginner") return "green";
  if (difficulty === "intermediate") return "amber";
  if (difficulty === "advanced") return "red";
  return "gray";
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------- Workout plan normalization ------------------------ */

export interface SnapshotExercise {
  key: string;
  slug?: string;
  exerciseId?: string;
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  weightKg?: number | null;
}

export interface NormalizedPlanDay {
  dayIndex: number;
  label: string;
  title: string;
  isRest: boolean;
  exercises: SnapshotExercise[];
}

function normalizePlanExercise(raw: unknown, index: number): SnapshotExercise {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = toString(o.name) ?? toString(o.exerciseName) ?? toString(o.slug) ?? `Exercise ${index + 1}`;
  const slug = toString(o.slug) ?? undefined;
  const exerciseId = toString(o.exerciseId) ?? toString(o.id) ?? undefined;
  return {
    key: `${slug ?? name}-${index}`,
    slug,
    exerciseId,
    name,
    sets: toNumber(o.sets) ?? 3,
    reps: toString(o.reps) ?? toString(o.repsRange) ?? "10",
    restSeconds: toNumber(o.restSeconds) ?? toNumber(o.restSec) ?? 90,
    weightKg: toNumber(o.weightKg) ?? toNumber(o.weight) ?? null,
  };
}

export function normalizePlanDays(days: unknown): NormalizedPlanDay[] {
  const arr = Array.isArray(days) ? days : [];
  return arr.map((raw, i) => {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const dayIndex =
      toNumber(o.dayIndex) ?? toNumber(o.day) ?? i;
    const idx = ((Math.round(dayIndex) % 7) + 7) % 7;
    const exercisesRaw = Array.isArray(o.exercises) ? o.exercises : [];
    const isRest =
      o.rest === true || o.isRest === true || o.type === "rest" || o.kind === "rest";
    return {
      dayIndex: idx,
      label: DAY_NAMES[idx] ?? `Day ${idx + 1}`,
      title: toString(o.title) ?? toString(o.focus) ?? toString(o.name) ?? (isRest ? "Rest day" : "Workout"),
      isRest,
      exercises: isRest ? [] : exercisesRaw.map((e, j) => normalizePlanExercise(e, j)),
    };
  });
}

export interface WorkoutPlanShape {
  id: string;
  weekStart?: string | null;
  days?: unknown;
  generatedBy?: string | null;
  createdAt?: string | null;
}

/* ------------------------------ Session snapshot ----------------------------- */
/* Stored in sessionStorage by the workouts page when a session is created, so  */
/* the session player can run without a GET /api/workouts/sessions/[id] route.  */

export interface SessionSnapshot {
  sessionId: string;
  sessionName: string;
  startedAt: string;
  planId?: string;
  dayLabel?: string;
  exercises: SnapshotExercise[];
}

export function sessionStorageKey(sessionId: string): string {
  return `ff_session_${sessionId}`;
}
