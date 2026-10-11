/**
 * EXERCISE_MEDIA — the human-demonstration asset registry.
 *
 * HONESTY CONTRACT (enforced by test): every entry is
 * `verificationStatus: "missing"` with null URLs by design. Nobody on this
 * project can film, purchase, or license 50 real human exercise videos
 * right now, and this file must never contain invented or placeholder
 * URLs — a wrong or fake demo teaches unsafe technique.
 *
 * An entry may move to "verified" ONLY when ALL of these hold:
 *   1. a real human-demonstration file exists at assetUrl and loads,
 *   2. it demonstrates THIS exercise with correct form,
 *   3. attribution + license expressly permit commercial app use,
 *   4. reviewDate is set (qualified fitness-professional review).
 *
 * Until then, <ExerciseMedia> renders the three-stage static
 * illustration plus the always-present technique instructions.
 *
 * Slugs must match the seed exercise slugs (exactly 50, enforced by test).
 */

export type ExerciseMediaType = 'gif' | 'webp' | 'mp4' | 'webm';

export type VerificationStatus = 'missing' | 'pending-review' | 'verified';

export interface ExerciseMediaEntry {
  /** Display name (from the exercise seed data). */
  displayName: string;
  /** Asset kind, or null when no asset exists. */
  mediaType: ExerciseMediaType | null;
  /** Direct URL / storage key of the verified human demo, or null. */
  assetUrl: string | null;
  /** Poster/thumbnail URL, or null. */
  posterUrl: string | null;
  /** Who made / supplied the asset, or null. */
  attribution: string | null;
  /** License identifier permitting commercial app use, or null. */
  license: string | null;
  /** Lifecycle state — 'missing' for all 50 until real assets arrive. */
  verificationStatus: VerificationStatus;
  /** ISO date of the professional form review, or null. */
  reviewDate: string | null;
}

const MISSING: Omit<ExerciseMediaEntry, 'displayName'> = {
  mediaType: null,
  assetUrl: null,
  posterUrl: null,
  attribution: null,
  license: null,
  verificationStatus: 'missing',
  reviewDate: null,
};

export const EXERCISE_MEDIA: Record<string, ExerciseMediaEntry> = {
  'ab-wheel-rollout': { displayName: 'Ab Wheel Rollout', ...MISSING },
  'barbell-back-squat': { displayName: 'Barbell Back Squat', ...MISSING },
  'barbell-bench-press': { displayName: 'Barbell Bench Press', ...MISSING },
  'barbell-curl': { displayName: 'Barbell Curl', ...MISSING },
  'barbell-overhead-press': { displayName: 'Barbell Overhead Press', ...MISSING },
  'bench-dip': { displayName: 'Bench Dip', ...MISSING },
  'bent-over-barbell-row': { displayName: 'Bent-Over Barbell Row', ...MISSING },
  'bicycle-crunch': { displayName: 'Bicycle Crunch', ...MISSING },
  'bodyweight-squat': { displayName: 'Bodyweight Squat', ...MISSING },
  'bulgarian-split-squat': { displayName: 'Bulgarian Split Squat', ...MISSING },
  'burpee': { displayName: 'Burpee', ...MISSING },
  'cat-cow': { displayName: 'Cat-Cow', ...MISSING },
  'chest-fly-machine': { displayName: 'Machine Chest Fly', ...MISSING },
  'childs-pose': { displayName: 'Child\'s Pose', ...MISSING },
  'dead-bug': { displayName: 'Dead Bug', ...MISSING },
  'dumbbell-bench-press': { displayName: 'Dumbbell Bench Press', ...MISSING },
  'dumbbell-bicep-curl': { displayName: 'Dumbbell Bicep Curl', ...MISSING },
  'dumbbell-overhead-press': { displayName: 'Dumbbell Overhead Press', ...MISSING },
  'dumbbell-shrug': { displayName: 'Dumbbell Shrug', ...MISSING },
  'face-pull': { displayName: 'Face Pull', ...MISSING },
  'front-raise': { displayName: 'Front Raise', ...MISSING },
  'glute-bridge': { displayName: 'Glute Bridge', ...MISSING },
  'goblet-squat': { displayName: 'Goblet Squat', ...MISSING },
  'hammer-curl': { displayName: 'Hammer Curl', ...MISSING },
  'hamstring-stretch': { displayName: 'Standing Hamstring Stretch', ...MISSING },
  'hanging-knee-raise': { displayName: 'Hanging Knee Raise', ...MISSING },
  'high-knees': { displayName: 'High Knees', ...MISSING },
  'hip-flexor-stretch': { displayName: 'Half-Kneeling Hip Flexor Stretch', ...MISSING },
  'incline-push-up': { displayName: 'Incline Push-Up', ...MISSING },
  'jump-rope': { displayName: 'Jump Rope', ...MISSING },
  'jumping-jacks': { displayName: 'Jumping Jacks', ...MISSING },
  'lat-pulldown': { displayName: 'Lat Pulldown', ...MISSING },
  'lateral-raise': { displayName: 'Lateral Raise', ...MISSING },
  'leg-press': { displayName: 'Leg Press', ...MISSING },
  'mountain-climber': { displayName: 'Mountain Climber', ...MISSING },
  'one-arm-dumbbell-row': { displayName: 'One-Arm Dumbbell Row', ...MISSING },
  'overhead-tricep-extension': { displayName: 'Overhead Tricep Extension', ...MISSING },
  'plank': { displayName: 'Plank', ...MISSING },
  'pull-up': { displayName: 'Pull-Up', ...MISSING },
  'push-up': { displayName: 'Push-Up', ...MISSING },
  'romanian-deadlift': { displayName: 'Romanian Deadlift', ...MISSING },
  'russian-twist': { displayName: 'Russian Twist', ...MISSING },
  'seated-cable-row': { displayName: 'Seated Cable Row', ...MISSING },
  'standing-calf-raise': { displayName: 'Standing Calf Raise', ...MISSING },
  'stationary-bike': { displayName: 'Stationary Bike', ...MISSING },
  'superman': { displayName: 'Superman', ...MISSING },
  'thoracic-rotation': { displayName: 'Thoracic Rotation (Open Book)', ...MISSING },
  'treadmill-run': { displayName: 'Treadmill Run', ...MISSING },
  'tricep-pushdown': { displayName: 'Tricep Pushdown', ...MISSING },
  'walking-lunge': { displayName: 'Walking Lunge', ...MISSING },
};

/** Returns the registry entry for a slug, or null when the slug is unknown. */
export function getExerciseMedia(slug: string): ExerciseMediaEntry | null {
  return Object.prototype.hasOwnProperty.call(EXERCISE_MEDIA, slug)
    ? EXERCISE_MEDIA[slug]
    : null;
}

/**
 * Validate the whole registry. Returns problem descriptions; empty = clean.
 * Rules:
 *  - every entry needs a non-empty displayName,
 *  - a non-null assetUrl requires mediaType, attribution, and license,
 *  - verificationStatus 'verified' requires assetUrl + reviewDate + license,
 *  - 'pending-review' requires assetUrl,
 *  - no entry may claim verified/missing inconsistently.
 */
export function validateRegistry(): string[] {
  const problems: string[] = [];
  for (const [slug, e] of Object.entries(EXERCISE_MEDIA)) {
    if (!e.displayName || !e.displayName.trim()) problems.push(slug + ': displayName missing');
    const hasUrl = typeof e.assetUrl === 'string' && e.assetUrl.trim().length > 0;
    const hasAttribution = typeof e.attribution === 'string' && e.attribution.trim().length > 0;
    const hasLicense = typeof e.license === 'string' && e.license.trim().length > 0;
    const hasReviewDate = typeof e.reviewDate === 'string' && e.reviewDate.trim().length > 0;
    if (hasUrl && !e.mediaType) problems.push(slug + ': assetUrl without mediaType');
    if (hasUrl && !hasAttribution) problems.push(slug + ': assetUrl without attribution');
    if (hasUrl && !hasLicense) problems.push(slug + ': assetUrl without license');
    if (e.verificationStatus === 'verified' && !hasUrl) problems.push(slug + ': verified without assetUrl');
    if (e.verificationStatus === 'verified' && !hasReviewDate) problems.push(slug + ': verified without reviewDate');
    if (e.verificationStatus === 'verified' && !hasLicense) problems.push(slug + ': verified without license');
    if (e.verificationStatus === 'pending-review' && !hasUrl) problems.push(slug + ': pending-review without assetUrl');
    if (e.verificationStatus === 'missing' && hasUrl) problems.push(slug + ': marked missing but has assetUrl');
    if (e.mediaType && !hasUrl) problems.push(slug + ': mediaType without assetUrl');
  }
  return problems;
}
