/**
 * Shared types + display helpers for the Yoga section (V22 Phase B).
 * Mirrors the defensive-normalizer style of workouts/_shared.ts; the data
 * itself always comes from the Phase A catalog APIs — nothing is hardcoded
 * here except category display names and ordering.
 */

export interface YogaPose {
  id: string;
  slug: string;
  name: string;
  sanskritName?: string | null;
  description?: string | null;
  instructions?: unknown;
  breathing?: string | null;
  modifications?: string | null;
  cautions?: string | null;
  difficulty?: string | null;
  mediaStatus?: string | null;
}

export interface YogaSequencePose {
  order: number;
  holdSeconds: number;
  side: string;
  transitionSeconds: number;
  cue?: string | null;
  pose: YogaPose;
}

export interface YogaSequenceSummary {
  id: string;
  slug: string;
  title: string;
  category: string;
  level: string;
  description: string;
  safetyNotes?: string | null;
  metValue?: number | null;
  mediaStatus?: string | null;
  poseCount: number;
  totalDurationSeconds: number;
}

export interface YogaSequenceDetail extends YogaSequenceSummary {
  poses: YogaSequencePose[];
}

/** The seven yoga categories, in browse order, with display names. */
export const YOGA_CATEGORIES: { slug: string; name: string; blurb: string }[] = [
  { slug: "beginner", name: "Beginner Yoga", blurb: "Foundational poses and gentle pacing to start your practice." },
  { slug: "morning", name: "Morning Yoga", blurb: "Wake up the body and mind with an energising flow." },
  { slug: "flexibility", name: "Flexibility Yoga", blurb: "Longer holds and deep stretches to open up tight areas." },
  { slug: "strength", name: "Strength Yoga", blurb: "Power poses that build muscular strength and endurance." },
  { slug: "balance", name: "Balance Yoga", blurb: "Standing balances to train stability and focus." },
  { slug: "relaxation-breathing", name: "Relaxation & Breathing", blurb: "Restorative poses and breathwork to fully unwind." },
  { slug: "full-body", name: "Full-Body Yoga", blurb: "A complete flow that works every major muscle group." },
];

export function yogaCategoryName(slug: string): string {
  return YOGA_CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
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

/** m:ss clock for hold times in lists. */
export function formatHold(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function sideLabel(side: string): string {
  switch (side) {
    case "each":
      return "Both sides";
    case "left":
      return "Left side";
    case "right":
      return "Right side";
    default:
      return "Both feet / centred";
  }
}
