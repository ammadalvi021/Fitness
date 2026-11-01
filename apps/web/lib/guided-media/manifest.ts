/**
 * Guided-media manifest — Yoga & Aerobics (V22 Phase A).
 *
 * HONESTY CONTRACT:
 * - An entry may be marked `verified` ONLY when its asset file actually
 *   exists in `apps/web/public/`. The manifest test enforces this: every
 *   non-null videoUrl/posterUrl must resolve to a real file on disk.
 * - NEVER substitute an unrelated clip (for example a strength exercise
 *   video from /exercise-videos/) for a yoga pose or aerobics routine.
 *   A missing demonstration is shown as a clearly labelled placeholder.
 * - Until real, verified demonstrations are produced, every entry here is
 *   `placeholder` with null URLs.
 */

export type GuidedMediaKind = 'yoga-pose' | 'aerobics-routine';
export type GuidedMediaStatus = 'placeholder' | 'verified';

export interface GuidedMediaEntry {
  slug: string;
  kind: GuidedMediaKind;
  mediaStatus: GuidedMediaStatus;
  videoUrl: string | null;
  posterUrl: string | null;
}

const YOGA_POSE_SLUGS = [
  'mountain-pose',
  'easy-pose',
  'cat-cow',
  'downward-facing-dog',
  'plank-pose',
  'cobra-pose',
  'childs-pose',
  'bridge-pose',
  'warrior-i',
  'warrior-ii',
  'warrior-iii',
  'triangle-pose',
  'extended-side-angle',
  'chair-pose',
  'tree-pose',
  'eagle-pose',
  'low-lunge',
  'standing-forward-fold',
  'seated-forward-fold',
  'butterfly-pose',
  'pigeon-pose',
  'boat-pose',
  'supine-twist',
  'legs-up-the-wall',
  'corpse-pose',
] as const;

const AEROBICS_ROUTINE_SLUGS = [
  'beginner-aerobics-starter',
  'low-impact-aerobics',
  'dance-aerobics-party',
  'moderate-cardio-aerobics',
  'full-body-aerobics-blast',
  'advanced-aerobics-conditioning',
] as const;

function placeholder(slug: string, kind: GuidedMediaKind): GuidedMediaEntry {
  return { slug, kind, mediaStatus: 'placeholder', videoUrl: null, posterUrl: null };
}

/** Every guided-catalog slug, keyed by slug. */
export const GUIDED_MEDIA: Record<string, GuidedMediaEntry> = Object.fromEntries(
  [
    ...YOGA_POSE_SLUGS.map((slug) => placeholder(slug, 'yoga-pose')),
    ...AEROBICS_ROUTINE_SLUGS.map((slug) => placeholder(slug, 'aerobics-routine')),
  ].map((entry) => [entry.slug, entry]),
);

export function getGuidedMedia(slug: string): GuidedMediaEntry | undefined {
  return GUIDED_MEDIA[slug];
}
