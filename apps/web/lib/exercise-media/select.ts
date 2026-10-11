/**
 * selectMediaSource — the pure media-priority decision for an exercise.
 *
 * Priority (human demonstration first, always honest):
 *   1. "video"        — a VERIFIED human-demonstration asset exists:
 *                        registry entry with verificationStatus === "verified"
 *                        and a non-empty assetUrl, OR the exercise record
 *                        itself carries mediaType === "video" with a non-empty
 *                        mediaUrl.
 *   2. "illustration" — no verified human asset; a three-stage static
 *                        illustration can be rendered from the animation
 *                        engine's pose data (never presented as footage).
 *   3. "coming-soon"  — no verified asset and no illustration source:
 *                        honest "Human demonstration coming soon" + text
 *                        instructions.
 *
 * Pure function (no DOM) so it can be unit-tested in node.
 */
import { ANIMATIONS } from "@/lib/exercise-animation/animations";
import { EXERCISE_MEDIA } from "./registry";

export type MediaSource = "video" | "illustration" | "coming-soon";

/** Database media types that count as a real human-demonstration asset. */
const DB_ASSET_TYPES = new Set(["video", "gif", "webp", "mp4", "webm"]);

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasIllustrationSource(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(ANIMATIONS, slug);
}

/**
 * True only when the registry entry is a genuinely verified human asset:
 * status "verified" AND a real asset URL. Anything less is not footage.
 */
export function hasVerifiedAsset(slug: string): boolean {
  const entry = EXERCISE_MEDIA[slug];
  return (
    !!entry &&
    entry.verificationStatus === "verified" &&
    hasText(entry.assetUrl)
  );
}

export function selectMediaSource(
  slug: string,
  mediaType?: string | null,
  mediaUrl?: string | null
): MediaSource {
  // Verified registry asset wins — the curated, professionally-reviewed path.
  if (hasVerifiedAsset(slug)) return "video";

  // Database-provided asset (mediaType/mediaUrl set through an admin path).
  // "video" is the legacy value (implies mp4); gif/webp/mp4/webm are explicit.
  const dbType = (mediaType ?? "").trim().toLowerCase();
  if (DB_ASSET_TYPES.has(dbType) && hasText(mediaUrl)) return "video";

  // Static three-stage illustration from the pose engine — honest, labeled,
  // never passed off as human footage.
  if (hasIllustrationSource(slug)) return "illustration";

  // Honest fallback: no demo media exists for this exercise.
  return "coming-soon";
}
