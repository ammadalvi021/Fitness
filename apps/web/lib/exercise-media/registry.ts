/**
 * EXERCISE_MEDIA — the honest human-video registry.
 *
 * This registry is INTENTIONALLY EMPTY: every entry is
 * `{ videoUrl: null, posterUrl: null }` by design. Nobody on this project
 * can film or license 50 real human exercise videos right now, and this
 * file must never contain invented or placeholder URLs — a wrong or fake
 * demo teaches unsafe technique.
 *
 * An entry is filled in ONLY when real, professionally-reviewed footage
 * exists for that exercise (see docs/exercise-video-prompts.md and
 * docs/exercise-media-workflow.md). Until then, <ExerciseMedia> falls back
 * to the labeled SVG "Animated demonstration" (interim) or the honest
 * "Video coming soon" panel — written technique instructions are always
 * rendered regardless.
 *
 * Slugs must match the animation slugs in
 * @/lib/exercise-animation/animations (exactly 50, enforced by test).
 */

export interface ExerciseMediaEntry {
  /** Direct URL to the reviewed human demonstration video (CDN-hosted), or null. */
  videoUrl: string | null;
  /** Poster/thumbnail image URL for the video, or null. */
  posterUrl: string | null;
}

const EMPTY: ExerciseMediaEntry = { videoUrl: null, posterUrl: null };

export const EXERCISE_MEDIA: Record<string, ExerciseMediaEntry> = {
  "ab-wheel-rollout": { ...EMPTY },
  "barbell-back-squat": { ...EMPTY },
  "barbell-bench-press": { ...EMPTY },
  "barbell-curl": { ...EMPTY },
  "barbell-overhead-press": { ...EMPTY },
  "bench-dip": { ...EMPTY },
  "bent-over-barbell-row": { ...EMPTY },
  "bicycle-crunch": { ...EMPTY },
  "bodyweight-squat": { ...EMPTY },
  "bulgarian-split-squat": { ...EMPTY },
  "burpee": { ...EMPTY },
  "cat-cow": { ...EMPTY },
  "chest-fly-machine": { ...EMPTY },
  "childs-pose": { ...EMPTY },
  "dead-bug": { ...EMPTY },
  "dumbbell-bench-press": { ...EMPTY },
  "dumbbell-bicep-curl": { ...EMPTY },
  "dumbbell-overhead-press": { ...EMPTY },
  "dumbbell-shrug": { ...EMPTY },
  "face-pull": { ...EMPTY },
  "front-raise": { ...EMPTY },
  "glute-bridge": { ...EMPTY },
  "goblet-squat": { ...EMPTY },
  "hammer-curl": { ...EMPTY },
  "hamstring-stretch": { ...EMPTY },
  "hanging-knee-raise": { ...EMPTY },
  "high-knees": { ...EMPTY },
  "hip-flexor-stretch": { ...EMPTY },
  "incline-push-up": { ...EMPTY },
  "jump-rope": { ...EMPTY },
  "jumping-jacks": { ...EMPTY },
  "lat-pulldown": { ...EMPTY },
  "lateral-raise": { ...EMPTY },
  "leg-press": { ...EMPTY },
  "mountain-climber": { ...EMPTY },
  "one-arm-dumbbell-row": { ...EMPTY },
  "overhead-tricep-extension": { ...EMPTY },
  "plank": { ...EMPTY },
  "pull-up": { ...EMPTY },
  "push-up": { ...EMPTY },
  "romanian-deadlift": { ...EMPTY },
  "russian-twist": { ...EMPTY },
  "seated-cable-row": { ...EMPTY },
  "standing-calf-raise": { ...EMPTY },
  "stationary-bike": { ...EMPTY },
  "superman": { ...EMPTY },
  "thoracic-rotation": { ...EMPTY },
  "treadmill-run": { ...EMPTY },
  "tricep-pushdown": { ...EMPTY },
  "walking-lunge": { ...EMPTY },
};

/** Returns the registry entry for a slug, or null when the slug is unknown. */
export function getExerciseMedia(slug: string): ExerciseMediaEntry | null {
  return Object.prototype.hasOwnProperty.call(EXERCISE_MEDIA, slug)
    ? EXERCISE_MEDIA[slug]
    : null;
}
