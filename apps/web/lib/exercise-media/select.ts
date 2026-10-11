/**
 * selectMediaSource — the pure media-priority decision for an exercise.
 *
 * Priority (human video first, always honest):
 *   1. "video"      — the EXERCISE_MEDIA registry holds a real, reviewed
 *                      videoUrl for this slug, OR the exercise record itself
 *                      carries mediaType === "video" with a non-empty mediaUrl.
 *   2. "animation"  — no real video; a labeled SVG stick-figure demo exists
 *                      in @/lib/exercise-animation (interim demonstration).
 *   3. "coming-soon" — no video and no animation: the honest placeholder.
 *
 * Pure function (no DOM) so it can be unit-tested in node.
 */
import { ANIMATIONS } from "@/lib/exercise-animation/animations";
import { EXERCISE_MEDIA } from "./registry";

export type MediaSource = "video" | "animation" | "coming-soon";

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAnimation(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(ANIMATIONS, slug);
}

export function selectMediaSource(
  slug: string,
  mediaType?: string | null,
  mediaUrl?: string | null
): MediaSource {
  // Registry video wins — it is the curated, professionally-reviewed path.
  const entry = EXERCISE_MEDIA[slug];
  if (entry && hasText(entry.videoUrl)) return "video";

  // Database-provided video (mediaType/mediaUrl set through an admin path).
  if (mediaType === "video" && hasText(mediaUrl)) return "video";

  // Interim: labeled animated demonstration.
  if (hasAnimation(slug)) return "animation";

  // Honest fallback: no demo media exists for this exercise.
  return "coming-soon";
}
