/**
 * Luxury-workout presentation helpers.
 *
 * Pure functions only — no React, no API calls, no invented data — so they
 * can be unit-tested (see tests/integration/workouts-lux.test.ts).
 * Extracted verbatim from the workout pages during the Obsidian Gold
 * presentation redesign; behavior is identical to the originals.
 */
import { difficultyTone } from "./_shared";

export type LuxDifficultyTone = "success" | "warning" | "error" | "neutral";

/**
 * Map an exercise difficulty string to a LuxBadge tone.
 * Mirrors `difficultyTone` semantics from _shared (beginner → green, etc.).
 */
export function luxDifficultyTone(difficulty: string): LuxDifficultyTone {
  switch (difficultyTone(difficulty)) {
    case "green":
      return "success";
    case "amber":
      return "warning";
    case "red":
      return "error";
    default:
      return "neutral";
  }
}

/** Format a millisecond duration as m:ss or h:mm:ss, clamped at zero. */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Parse the leading number out of a free-text reps/weight field.
 * Returns 0 when no number is present (same as the session page original).
 */
export function parseLeadingNumber(s: string): number {
  const m = /[\d.]+/.exec(s);
  const n = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(n) ? n : 0;
}
