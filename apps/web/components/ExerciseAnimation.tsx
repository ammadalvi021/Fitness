/**
 * ExerciseAnimation — looping SVG stick-figure demo for an exercise.
 *
 * Looks the exercise up by slug in ANIMATIONS; renders nothing when the
 * slug has no animation (never render broken). Animates with rAF; honors
 * prefers-reduced-motion by rendering a single static mid-pose instead.
 */
"use client";

import { useEffect, useState } from "react";
import { ANIMATIONS } from "@/lib/exercise-animation/animations";
import { cycleMs, fk, samplePose } from "@/lib/exercise-animation/engine";
import { StickFigure } from "@/lib/exercise-animation/figure";

export function hasExerciseAnimation(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(ANIMATIONS, slug);
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function ExerciseAnimation({
  slug,
  className,
  label,
  animated = true,
}: {
  slug: string;
  className?: string;
  label?: string;
  /** When false, render a static mid-pose (used for library thumbnails). */
  animated?: boolean;
}) {
  const def = ANIMATIONS[slug];
  const reduceMotion = usePrefersReducedMotion();
  const [tMs, setTMs] = useState(0);

  useEffect(() => {
    if (!def || !animated || reduceMotion) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setTMs(now - start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [def, animated, reduceMotion]);

  if (!def) return null;

  const cycle = cycleMs(def);
  const t = !animated || reduceMotion ? cycle * 0.3 : tMs;
  const pose = samplePose(def, t);
  const joints = fk(pose);

  return (
    <StickFigure
      joints={joints}
      pose={pose}
      props={def.props}
      svgProps={{
        role: "img",
        "aria-label": label ?? `${slug} exercise animation`,
        className,
      }}
    />
  );
}
