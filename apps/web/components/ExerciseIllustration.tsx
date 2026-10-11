/**
 * ExerciseIllustration — three STATIC key-frame illustrations for an exercise.
 *
 * Replaces the looping animated SVG demos in the customer-facing UI. Uses
 * the existing pose engine (samplePose + fk + StickFigure) to render the
 * start pose, the mid-rep pose, and the finishing pose side by side —
 * labeled, captioned, and explicitly NOT presented as human footage.
 *
 * The animation engine code stays in the repo as the illustration source
 * (isolated, documented); the rAF looping <ExerciseAnimation> component is
 * no longer rendered on any customer-facing page.
 */
"use client";

import { ANIMATIONS } from "@/lib/exercise-animation/animations";
import {
  cycleMs,
  fk,
  samplePose,
  type Joints,
  type Pose,
} from "@/lib/exercise-animation/engine";
import { StickFigure } from "@/lib/exercise-animation/figure";

export interface IllustrationFrame {
  label: string;
  pose: Pose;
  joints: Joints;
}

/**
 * Pure frame selection for an exercise slug: start (t=0), mid-rep
 * (t=cycle/2), finish (t=cycle — the loop closes back to the start pose).
 * Returns null when the slug has no pose data.
 */
export function illustrationFrames(slug: string): IllustrationFrame[] | null {
  const def = ANIMATIONS[slug];
  if (!def) return null;
  const total = cycleMs(def);
  if (!(total > 0)) return null;
  const picks: Array<[string, number]> = [
    ["Start", 0],
    ["Mid-rep", total / 2],
    ["Finish", total],
  ];
  return picks.map(([label, t]) => {
    const pose = samplePose(def, t);
    return { label, pose, joints: fk(pose) };
  });
}

/** True when a three-stage illustration can be rendered for this slug. */
export function hasExerciseIllustration(slug: string): boolean {
  return illustrationFrames(slug) !== null;
}

export function ExerciseIllustration({
  slug,
  name,
  className,
  compact,
}: {
  slug: string;
  /** Exercise display name, used in the accessible label. */
  name: string;
  className?: string;
  /** Compact mode: smaller labels for card thumbnails. */
  compact?: boolean;
}) {
  const frames = illustrationFrames(slug);
  if (!frames) return null;
  const def = ANIMATIONS[slug];

  return (
    <figure className={className}>
      <div
        role="img"
        aria-label={`${name}: three-stage illustration showing the start, mid-repetition, and finishing positions`}
        className="grid grid-cols-3 gap-1.5"
      >
        {frames.map((f) => (
          <div key={f.label} className="flex flex-col">
            <div className="aspect-square w-full overflow-hidden rounded-lg bg-neutral-50 dark:bg-neutral-800/40">
              <StickFigure
                joints={f.joints}
                pose={f.pose}
                props={def.props}
                svgProps={{ "aria-hidden": true, focusable: false }}
              />
            </div>
            <span
              className={`mt-1 text-center font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400 ${
                compact ? "text-[10px]" : "text-[11px]"
              }`}
            >
              {f.label}
            </span>
          </div>
        ))}
      </div>
      {!compact ? (
        <figcaption className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
          Illustration — human demonstration coming soon
        </figcaption>
      ) : null}
    </figure>
  );
}
