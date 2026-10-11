/**
 * Exercise stick-figure animations — contract tests.
 *
 * - Every exercise slug in the workout library has an animation definition.
 * - Every definition passes validateAnimDef (sane keyframes/angles).
 * - Loops close seamlessly: pose(t=0) === pose(t=cycle).
 * - Animations actually move (not all sampled poses identical).
 * - Spot-checks that key poses are anatomically plausible (e.g. squats squat).
 *
 * Pure unit tests — no database, no network.
 */
import { describe, expect, it } from "vitest";
import { ANIMATIONS } from "@/lib/exercise-animation/animations";
import {
  cycleMs,
  fk,
  samplePose,
  validateAnimDef,
} from "@/lib/exercise-animation/engine";

const EXERCISE_SLUGS = [
  "push-up",
  "incline-push-up",
  "dumbbell-bench-press",
  "barbell-bench-press",
  "chest-fly-machine",
  "pull-up",
  "lat-pulldown",
  "bent-over-barbell-row",
  "one-arm-dumbbell-row",
  "seated-cable-row",
  "superman",
  "bodyweight-squat",
  "goblet-squat",
  "barbell-back-squat",
  "romanian-deadlift",
  "walking-lunge",
  "bulgarian-split-squat",
  "glute-bridge",
  "standing-calf-raise",
  "leg-press",
  "dumbbell-overhead-press",
  "barbell-overhead-press",
  "lateral-raise",
  "front-raise",
  "face-pull",
  "dumbbell-shrug",
  "dumbbell-bicep-curl",
  "hammer-curl",
  "barbell-curl",
  "tricep-pushdown",
  "overhead-tricep-extension",
  "bench-dip",
  "plank",
  "dead-bug",
  "bicycle-crunch",
  "russian-twist",
  "mountain-climber",
  "hanging-knee-raise",
  "ab-wheel-rollout",
  "jumping-jacks",
  "burpee",
  "high-knees",
  "jump-rope",
  "treadmill-run",
  "stationary-bike",
  "cat-cow",
  "thoracic-rotation",
  "hip-flexor-stretch",
  "hamstring-stretch",
  "childs-pose",
];

describe("exercise animation coverage", () => {
  it("has exactly the 50 workout-library slugs", () => {
    expect(EXERCISE_SLUGS).toHaveLength(50);
    for (const slug of EXERCISE_SLUGS) {
      expect(
        Object.prototype.hasOwnProperty.call(ANIMATIONS, slug),
        `missing animation for "${slug}"`,
      ).toBe(true);
    }
  });

  it("every definition validates clean", () => {
    for (const slug of EXERCISE_SLUGS) {
      const problems = validateAnimDef(ANIMATIONS[slug]);
      expect(problems, `"${slug}": ${problems.join("; ")}`).toEqual([]);
    }
  });
});

describe("loop closure and motion", () => {
  it("pose(t=0) equals pose(t=cycle) for every animation", () => {
    for (const slug of EXERCISE_SLUGS) {
      const def = ANIMATIONS[slug];
      const cycle = cycleMs(def);
      expect(cycle).toBeGreaterThan(0);
      expect(samplePose(def, 0), `"${slug}" loop does not close`).toEqual(
        samplePose(def, cycle),
      );
    }
  });

  it("every animation actually moves across its cycle", () => {
    for (const slug of EXERCISE_SLUGS) {
      const def = ANIMATIONS[slug];
      const cycle = cycleMs(def);
      const seen = new Set<string>();
      for (let i = 0; i < 8; i++) {
        seen.add(JSON.stringify(samplePose(def, (cycle * i) / 8)));
      }
      expect(
        seen.size,
        `"${slug}" never changes pose across its cycle`,
      ).toBeGreaterThan(1);
    }
  });

  it("forward kinematics keeps joints in the 200x200 frame (after rot)", () => {
    for (const slug of EXERCISE_SLUGS) {
      const def = ANIMATIONS[slug];
      const cycle = cycleMs(def);
      for (let i = 0; i < 12; i++) {
        const pose = samplePose(def, (cycle * i) / 12);
        const joints = fk(pose);
        // The figure is rendered inside <g transform={rotate(rot, hx, hy)}>
        // — apply the same rotation before checking the visible frame.
        const rot = pose.rot ?? 0;
        const hx = joints.hips.x;
        const hy = joints.hips.y;
        const r = (rot * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        for (const [name, p] of Object.entries(joints)) {
          const sx = hx + (p.x - hx) * cos - (p.y - hy) * sin;
          const sy = hy + (p.x - hx) * sin + (p.y - hy) * cos;
          expect(
            sx >= -10 && sx <= 210 && sy >= -10 && sy <= 210,
            `"${slug}" joint ${name} out of frame at t=${i}/12: (${sx.toFixed(1)}, ${sy.toFixed(1)})`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("anatomical spot-checks", () => {
  it("squat bottom pose actually squats (hipL > 60)", () => {
    for (const slug of [
      "bodyweight-squat",
      "goblet-squat",
      "barbell-back-squat",
    ]) {
      const def = ANIMATIONS[slug];
      // Bottom of the squat is reached at the end of the down segment:
      // sum of ms up to and including keyframe[1].
      const bottomT = def.keyframes[0].ms + def.keyframes[1].ms;
      const pose = samplePose(def, bottomT);
      expect(
        pose.hipL ?? 0,
        `"${slug}" squat bottom hipL should exceed 60`,
      ).toBeGreaterThan(60);
    }
  });

  it("pull-up top pose raises the body (dy < 0)", () => {
    const def = ANIMATIONS["pull-up"];
    const topT = def.keyframes[0].ms + def.keyframes[1].ms;
    const pose = samplePose(def, topT);
    expect(pose.dy ?? 0).toBeLessThan(0);
  });

  it("burpee visits both standing and prone (rot 90) phases", () => {
    const def = ANIMATIONS["burpee"];
    const rots = new Set<number>();
    const cycle = cycleMs(def);
    for (let i = 0; i < 10; i++) {
      rots.add(Math.round(samplePose(def, (cycle * i) / 10).rot ?? 0));
    }
    expect(rots.has(0)).toBe(true);
    expect(rots.has(90)).toBe(true);
  });
});
