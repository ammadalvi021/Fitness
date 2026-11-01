/**
 * Shared types + display helpers for the Aerobics section (V22 Phase C).
 * Mirrors the Yoga section's _shared.ts; the data itself always comes
 * from the aerobics catalog APIs — nothing is hardcoded here except
 * category display names and ordering.
 */

export interface AerobicStep {
  id: string;
  routineId?: string;
  order: number;
  /** warmup | main | cooldown */
  phase: string;
  name: string;
  durationSeconds: number;
  cue?: string | null;
  lowImpactAlternative?: string | null;
}

export interface AerobicRoutineSummary {
  id: string;
  slug: string;
  title: string;
  category: string;
  level: string;
  intensity: string;
  metValue: number;
  description: string;
  safetyNotes?: string | null;
  mediaStatus?: string | null;
  mediaType?: string | null;
  mediaUrl?: string | null;
  posterUrl?: string | null;
  stepCount: number;
  totalDurationSeconds: number;
  phases?: {
    warmup: number;
    main: number;
    cooldown: number;
  };
}

export interface AerobicRoutineDetail extends AerobicRoutineSummary {
  steps: AerobicStep[];
}

/** The six aerobics categories, in browse order, with display names. */
export const AEROBICS_CATEGORIES: { slug: string; name: string; blurb: string }[] = [
  { slug: "beginner", name: "Beginner Aerobics", blurb: "Easy-to-follow moves and gentle pacing to get started." },
  { slug: "low-impact", name: "Low-Impact Aerobics", blurb: "Joint-friendly cardio with one foot on the floor throughout." },
  { slug: "dance", name: "Dance Aerobics", blurb: "Rhythm-based routines that make cardio feel like a party." },
  { slug: "moderate-cardio", name: "Moderate Cardio", blurb: "Steady, heart-pumping sessions to build cardio fitness." },
  { slug: "full-body", name: "Full-Body Aerobics", blurb: "A complete routine that works every major muscle group." },
  { slug: "advanced", name: "Advanced Aerobics", blurb: "High-energy conditioning for experienced exercisers." },
];

export function aerobicsCategoryName(slug: string): string {
  return AEROBICS_CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}

/** "12 min" / "1 h 5 min" / "45 sec" style duration for catalog cards. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m} min ${rem} sec` : `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

/** m:ss clock for step durations in lists. */
export function formatHold(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Display label for a routine phase: warmup → "Warm-up", etc. */
export function phaseLabel(phase: string): string {
  switch (phase) {
    case "warmup":
      return "Warm-up";
    case "main":
      return "Main";
    case "cooldown":
      return "Cool-down";
    default:
      return phase;
  }
}

/** Display label for an intensity string, e.g. "moderate-high" → "Moderate-high". */
export function intensityLabel(intensity: string): string {
  if (!intensity) return intensity;
  return intensity.charAt(0).toUpperCase() + intensity.slice(1);
}
