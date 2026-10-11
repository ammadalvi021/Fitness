/**
 * Looping stick-figure animations for every exercise in the workout library,
 * keyed by exercise slug.
 *
 * Conventions (see engine.ts): side view facing right, y-down SVG coords.
 * `rot: 90` = prone (push-up/plank position), `rot: -90` = supine (on back).
 * Keyframes list the pose reached at the END of each segment; the loop
 * closes by interpolating the last keyframe back to the first.
 * Unspecified joint fields ease back to 0 (neutral) — see samplePose.
 */
import type { AnimDef } from "./engine";

export const ANIMATIONS: Record<string, AnimDef> = {
  // ---------------- Chest ----------------
  "push-up": {
    keyframes: [
      { pose: { rot: 90, shL: 75, shR: 75, elL: 15, elR: 15, hipL: 5, hipR: 5, knL: 5, knR: 5, dy: 0 }, ms: 650 },
      { pose: { rot: 90, shL: 75, shR: 75, elL: 85, elR: 85, hipL: 5, hipR: 5, knL: 5, knR: 5, dy: 12 }, ms: 650 },
      { pose: { rot: 90, shL: 75, shR: 75, elL: 15, elR: 15, hipL: 5, hipR: 5, knL: 5, knR: 5, dy: 0 }, ms: 650 },
    ],
  },
  "incline-push-up": {
    keyframes: [
      { pose: { rot: 90, shL: 70, shR: 70, elL: 20, elR: 20, hipL: 5, hipR: 5, knL: 5, knR: 5, dy: 0 }, ms: 650 },
      { pose: { rot: 90, shL: 70, shR: 70, elL: 60, elR: 60, hipL: 5, hipR: 5, knL: 5, knR: 5, dy: 8 }, ms: 650 },
      { pose: { rot: 90, shL: 70, shR: 70, elL: 20, elR: 20, hipL: 5, hipR: 5, knL: 5, knR: 5, dy: 0 }, ms: 650 },
    ],
  },
  "dumbbell-bench-press": {
    props: ["bench", "dumbbell"],
    keyframes: [
      { pose: { rot: 90, shL: 55, shR: 55, elL: 165, elR: 165, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 700 },
      { pose: { rot: 90, shL: -90, shR: -90, elL: 5, elR: 5, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 700 },
      { pose: { rot: 90, shL: 55, shR: 55, elL: 165, elR: 165, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 700 },
    ],
  },
  "barbell-bench-press": {
    props: ["bench", "barbell"],
    keyframes: [
      { pose: { rot: 90, shL: 55, shR: 58, elL: 165, elR: 160, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 700 },
      { pose: { rot: 90, shL: -90, shR: -87, elL: 5, elR: 8, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 700 },
      { pose: { rot: 90, shL: 55, shR: 58, elL: 165, elR: 160, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 700 },
    ],
  },
  "chest-fly-machine": {
    props: ["bench"],
    keyframes: [
      { pose: { rot: 90, shL: 45, shR: 45, elL: 20, elR: 20, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 750 },
      { pose: { rot: 90, shL: -75, shR: -75, elL: 15, elR: 15, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 750 },
      { pose: { rot: 90, shL: 45, shR: 45, elL: 20, elR: 20, hipL: 65, hipR: 65, knL: 75, knR: 75 }, ms: 750 },
    ],
  },

  // ---------------- Back ----------------
  "pull-up": {
    props: ["bar"],
    keyframes: [
      { pose: { shL: 170, shR: 170, elL: 5, elR: 5, hipL: 5, hipR: 5, knL: 25, knR: 25, dy: 0 }, ms: 600 },
      { pose: { shL: 150, shR: 150, elL: 60, elR: 60, hipL: 5, hipR: 5, knL: 30, knR: 30, dy: -28 }, ms: 600 },
      { pose: { shL: 170, shR: 170, elL: 5, elR: 5, hipL: 5, hipR: 5, knL: 25, knR: 25, dy: 0 }, ms: 600 },
    ],
  },
  "lat-pulldown": {
    props: ["barbell"],
    keyframes: [
      { pose: { torso: 5, shL: 170, shR: 170, elL: 15, elR: 15, hipL: 85, hipR: 85, knL: 90, knR: 90 }, ms: 700 },
      { pose: { torso: 5, shL: 100, shR: 100, elL: 85, elR: 85, hipL: 85, hipR: 85, knL: 90, knR: 90 }, ms: 700 },
      { pose: { torso: 5, shL: 170, shR: 170, elL: 15, elR: 15, hipL: 85, hipR: 85, knL: 90, knR: 90 }, ms: 700 },
    ],
  },
  "bent-over-barbell-row": {
    props: ["barbell"],
    keyframes: [
      { pose: { torso: 70, shL: 15, shR: 18, elL: 15, elR: 15, hipL: 20, hipR: 20, knL: 20, knR: 20 }, ms: 650 },
      { pose: { torso: 70, shL: -35, shR: -32, elL: 95, elR: 95, hipL: 20, hipR: 20, knL: 20, knR: 20 }, ms: 650 },
      { pose: { torso: 70, shL: 15, shR: 18, elL: 15, elR: 15, hipL: 20, hipR: 20, knL: 20, knR: 20 }, ms: 650 },
    ],
  },
  "one-arm-dumbbell-row": {
    keyframes: [
      { pose: { torso: 70, shL: 15, elL: 15, shR: 45, elR: 80, hipL: 20, hipR: 20, knL: 20, knR: 20 }, ms: 650 },
      { pose: { torso: 70, shL: -35, elL: 95, shR: 45, elR: 80, hipL: 20, hipR: 20, knL: 20, knR: 20 }, ms: 650 },
      { pose: { torso: 70, shL: 15, elL: 15, shR: 45, elR: 80, hipL: 20, hipR: 20, knL: 20, knR: 20 }, ms: 650 },
    ],
  },
  "seated-cable-row": {
    keyframes: [
      { pose: { torso: 10, shL: 70, shR: 70, elL: 25, elR: 25, hipL: 85, hipR: 85, knL: 90, knR: 90 }, ms: 650 },
      { pose: { torso: 10, shL: 15, shR: 15, elL: 90, elR: 90, hipL: 85, hipR: 85, knL: 90, knR: 90 }, ms: 650 },
      { pose: { torso: 10, shL: 70, shR: 70, elL: 25, elR: 25, hipL: 85, hipR: 85, knL: 90, knR: 90 }, ms: 650 },
    ],
  },
  "superman": {
    props: ["mat"],
    keyframes: [
      { pose: { rot: 90, shL: 150, shR: 150, elL: 5, elR: 5, hipL: -12, hipR: -12, knL: 5, knR: 5, dy: 0 }, ms: 900 },
      { pose: { rot: 90, shL: 160, shR: 160, elL: 5, elR: 5, hipL: -12, hipR: -12, knL: 5, knR: 5, dy: -8 }, ms: 900 },
      { pose: { rot: 90, shL: 150, shR: 150, elL: 5, elR: 5, hipL: -12, hipR: -12, knL: 5, knR: 5, dy: 0 }, ms: 900 },
    ],
  },

  // ---------------- Legs ----------------
  "bodyweight-squat": {
    keyframes: [
      { pose: { torso: 8, shL: 45, shR: 45, elL: 10, elR: 10, dy: 0 }, ms: 700 },
      { pose: { torso: 32, shL: 55, shR: 55, elL: 10, elR: 10, hipL: 95, hipR: 95, knL: 100, knR: 100, dy: 26 }, ms: 700 },
      { pose: { torso: 8, shL: 45, shR: 45, elL: 10, elR: 10, dy: 0 }, ms: 700 },
    ],
  },
  "goblet-squat": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { torso: 8, shL: 45, shR: 45, elL: 90, elR: 90, dy: 0 }, ms: 700 },
      { pose: { torso: 32, shL: 50, shR: 50, elL: 95, elR: 95, hipL: 95, hipR: 95, knL: 100, knR: 100, dy: 26 }, ms: 700 },
      { pose: { torso: 8, shL: 45, shR: 45, elL: 90, elR: 90, dy: 0 }, ms: 700 },
    ],
  },
  "barbell-back-squat": {
    props: ["barbell"],
    keyframes: [
      { pose: { torso: 10, shL: 35, shR: 38, elL: 105, elR: 105, dy: 0 }, ms: 700 },
      { pose: { torso: 35, shL: 35, shR: 38, elL: 105, elR: 105, hipL: 95, hipR: 95, knL: 100, knR: 100, dy: 26 }, ms: 700 },
      { pose: { torso: 10, shL: 35, shR: 38, elL: 105, elR: 105, dy: 0 }, ms: 700 },
    ],
  },
  "romanian-deadlift": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { torso: 8, shL: 15, shR: 15, elL: 8, elR: 8, dy: 0 }, ms: 750 },
      { pose: { torso: 75, shL: 25, shR: 25, elL: 8, elR: 8, hipL: 65, hipR: 65, knL: 12, knR: 12 }, ms: 750 },
      { pose: { torso: 8, shL: 15, shR: 15, elL: 8, elR: 8, dy: 0 }, ms: 750 },
    ],
  },
  "walking-lunge": {
    keyframes: [
      { pose: { torso: 5, hipL: 70, knL: 85, hipR: -25, knR: 15, dy: 14, dx: 6 }, ms: 800 },
      { pose: { torso: 5, hipL: -25, knL: 15, hipR: 70, knR: 85, dy: 14, dx: -6 }, ms: 800 },
    ],
  },
  "bulgarian-split-squat": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { torso: 8, hipL: 55, knL: 80, hipR: -20, knR: 70, dy: 8 }, ms: 700 },
      { pose: { torso: 10, hipL: 60, knL: 95, hipR: -20, knR: 75, dy: 20 }, ms: 700 },
      { pose: { torso: 8, hipL: 55, knL: 80, hipR: -20, knR: 70, dy: 8 }, ms: 700 },
    ],
  },
  "glute-bridge": {
    keyframes: [
      { pose: { rot: -90, hipL: 100, hipR: 100, knL: 95, knR: 95, shL: 20, shR: 20, elL: 10, elR: 10, dy: 0 }, ms: 800 },
      { pose: { rot: -90, hipL: 100, hipR: 100, knL: 95, knR: 95, shL: 20, shR: 20, elL: 10, elR: 10, dy: -16 }, ms: 800 },
      { pose: { rot: -90, hipL: 100, hipR: 100, knL: 95, knR: 95, shL: 20, shR: 20, elL: 10, elR: 10, dy: 0 }, ms: 800 },
    ],
  },
  "standing-calf-raise": {
    keyframes: [
      { pose: { shL: 5, shR: 5, elL: 5, elR: 5, dy: 0 }, ms: 500 },
      { pose: { shL: 5, shR: 5, elL: 5, elR: 5, dy: -7 }, ms: 500 },
      { pose: { shL: 5, shR: 5, elL: 5, elR: 5, dy: 0 }, ms: 500 },
    ],
  },
  "leg-press": {
    keyframes: [
      { pose: { rot: -90, hipL: 95, hipR: 95, knL: 95, knR: 95, shL: 20, shR: 20 }, ms: 700 },
      { pose: { rot: -90, hipL: 25, hipR: 25, knL: 15, knR: 15, shL: 20, shR: 20 }, ms: 700 },
      { pose: { rot: -90, hipL: 95, hipR: 95, knL: 95, knR: 95, shL: 20, shR: 20 }, ms: 700 },
    ],
  },

  // ---------------- Shoulders ----------------
  "dumbbell-overhead-press": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { shL: 95, shR: 95, elL: 75, elR: 75 }, ms: 700 },
      { pose: { shL: 170, shR: 170, elL: 10, elR: 10 }, ms: 700 },
      { pose: { shL: 95, shR: 95, elL: 75, elR: 75 }, ms: 700 },
    ],
  },
  "barbell-overhead-press": {
    props: ["barbell"],
    keyframes: [
      { pose: { shL: 95, shR: 98, elL: 75, elR: 75 }, ms: 700 },
      { pose: { shL: 170, shR: 170, elL: 10, elR: 10 }, ms: 700 },
      { pose: { shL: 95, shR: 98, elL: 75, elR: 75 }, ms: 700 },
    ],
  },
  "lateral-raise": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { shL: 10, shR: 10, elL: 8, elR: 8 }, ms: 700 },
      { pose: { shL: 80, shR: 80, elL: 8, elR: 8 }, ms: 700 },
      { pose: { shL: 10, shR: 10, elL: 8, elR: 8 }, ms: 700 },
    ],
  },
  "front-raise": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { torso: 5, shL: 10, shR: 10, elL: 8, elR: 8 }, ms: 700 },
      { pose: { torso: 5, shL: 85, shR: 85, elL: 8, elR: 8 }, ms: 700 },
      { pose: { torso: 5, shL: 10, shR: 10, elL: 8, elR: 8 }, ms: 700 },
    ],
  },
  "face-pull": {
    keyframes: [
      { pose: { torso: 5, shL: 90, shR: 90, elL: 90, elR: 90 }, ms: 600 },
      { pose: { torso: 5, shL: 130, shR: 130, elL: 100, elR: 100 }, ms: 600 },
      { pose: { torso: 5, shL: 90, shR: 90, elL: 90, elR: 90 }, ms: 600 },
    ],
  },
  "dumbbell-shrug": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { shL: 5, shR: 5, elL: 5, elR: 5, dy: 0 }, ms: 500 },
      { pose: { shL: 5, shR: 5, elL: 5, elR: 5, dy: -6 }, ms: 500 },
      { pose: { shL: 5, shR: 5, elL: 5, elR: 5, dy: 0 }, ms: 500 },
    ],
  },

  // ---------------- Arms ----------------
  "dumbbell-bicep-curl": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { shL: 8, shR: 8, elL: 12, elR: 12 }, ms: 600 },
      { pose: { shL: 8, shR: 8, elL: 125, elR: 125 }, ms: 600 },
      { pose: { shL: 8, shR: 8, elL: 12, elR: 12 }, ms: 600 },
    ],
  },
  "hammer-curl": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { shL: 8, shR: 8, elL: 12, elR: 12 }, ms: 600 },
      { pose: { shL: 8, shR: 8, elL: 125, elR: 125 }, ms: 600 },
      { pose: { shL: 8, shR: 8, elL: 12, elR: 12 }, ms: 600 },
    ],
  },
  "barbell-curl": {
    props: ["barbell"],
    keyframes: [
      { pose: { shL: 8, shR: 10, elL: 12, elR: 12 }, ms: 600 },
      { pose: { shL: 8, shR: 10, elL: 125, elR: 125 }, ms: 600 },
      { pose: { shL: 8, shR: 10, elL: 12, elR: 12 }, ms: 600 },
    ],
  },
  "tricep-pushdown": {
    keyframes: [
      { pose: { shL: 15, shR: 15, elL: 95, elR: 95 }, ms: 600 },
      { pose: { shL: 15, shR: 15, elL: 15, elR: 15 }, ms: 600 },
      { pose: { shL: 15, shR: 15, elL: 95, elR: 95 }, ms: 600 },
    ],
  },
  "overhead-tricep-extension": {
    props: ["dumbbell"],
    keyframes: [
      { pose: { shL: 170, shR: 170, elL: 100, elR: 100 }, ms: 650 },
      { pose: { shL: 170, shR: 170, elL: 20, elR: 20 }, ms: 650 },
      { pose: { shL: 170, shR: 170, elL: 100, elR: 100 }, ms: 650 },
    ],
  },
  "bench-dip": {
    props: ["bench"],
    keyframes: [
      { pose: { shL: 10, shR: 10, elL: 20, elR: 20, hipL: 70, hipR: 70, knL: 75, knR: 75, dy: 0 }, ms: 650 },
      { pose: { shL: 35, shR: 35, elL: 90, elR: 90, hipL: 70, hipR: 70, knL: 75, knR: 75, dy: 10 }, ms: 650 },
      { pose: { shL: 10, shR: 10, elL: 20, elR: 20, hipL: 70, hipR: 70, knL: 75, knR: 75, dy: 0 }, ms: 650 },
    ],
  },

  // ---------------- Core ----------------
  "plank": {
    props: ["mat"],
    keyframes: [
      { pose: { rot: 90, shL: 75, shR: 75, elL: 12, elR: 12, hipL: 0, hipR: 0, knL: 5, knR: 5, dy: 0 }, ms: 1000 },
      { pose: { rot: 90, shL: 75, shR: 75, elL: 12, elR: 12, hipL: 0, hipR: 0, knL: 5, knR: 5, dy: 2 }, ms: 1000 },
      { pose: { rot: 90, shL: 75, shR: 75, elL: 12, elR: 12, hipL: 0, hipR: 0, knL: 5, knR: 5, dy: 0 }, ms: 1000 },
    ],
  },
  "dead-bug": {
    keyframes: [
      { pose: { rot: -90, shL: 160, elL: 10, shR: 40, elR: 10, hipL: 95, knL: 90, hipR: 20, knR: 15 }, ms: 900 },
      { pose: { rot: -90, shL: 40, elL: 10, shR: 160, elR: 10, hipL: 20, knL: 15, hipR: 95, knR: 90 }, ms: 900 },
    ],
  },
  "bicycle-crunch": {
    keyframes: [
      { pose: { rot: -90, torso: 15, shL: 120, elL: 60, shR: 40, elR: 15, hipL: 20, knL: 15, hipR: 95, knR: 100 }, ms: 700 },
      { pose: { rot: -90, torso: 15, shL: 40, elL: 15, shR: 120, elR: 60, hipL: 95, knL: 100, hipR: 20, knR: 15 }, ms: 700 },
    ],
  },
  "russian-twist": {
    keyframes: [
      { pose: { hipL: 80, hipR: 80, knL: 85, knR: 85, torso: 30, shL: 60, shR: 60, elL: 70, elR: 70 }, ms: 600 },
      { pose: { hipL: 80, hipR: 80, knL: 85, knR: 85, torso: 10, shL: 60, shR: 60, elL: 70, elR: 70 }, ms: 600 },
    ],
  },
  "mountain-climber": {
    keyframes: [
      { pose: { rot: 90, shL: 75, shR: 75, elL: 12, elR: 12, hipL: 90, knL: 100, hipR: 10, knR: 10 }, ms: 450 },
      { pose: { rot: 90, shL: 75, shR: 75, elL: 12, elR: 12, hipL: 10, knL: 10, hipR: 90, knR: 100 }, ms: 450 },
    ],
  },
  "hanging-knee-raise": {
    props: ["bar"],
    keyframes: [
      { pose: { shL: 165, shR: 165, elL: 8, elR: 8, hipL: 10, hipR: 10, knL: 10, knR: 10 }, ms: 700 },
      { pose: { shL: 165, shR: 165, elL: 8, elR: 8, hipL: 95, hipR: 95, knL: 95, knR: 95 }, ms: 700 },
      { pose: { shL: 165, shR: 165, elL: 8, elR: 8, hipL: 10, hipR: 10, knL: 10, knR: 10 }, ms: 700 },
    ],
  },
  "ab-wheel-rollout": {
    props: ["mat"],
    keyframes: [
      { pose: { rot: 90, hipL: 60, hipR: 60, knL: 90, knR: 90, shL: 40, shR: 40, elL: 10, elR: 10, dx: 0 }, ms: 800 },
      { pose: { rot: 90, hipL: 60, hipR: 60, knL: 90, knR: 90, shL: 130, shR: 130, elL: 10, elR: 10, dx: 8 }, ms: 800 },
      { pose: { rot: 90, hipL: 60, hipR: 60, knL: 90, knR: 90, shL: 40, shR: 40, elL: 10, elR: 10, dx: 0 }, ms: 800 },
    ],
  },

  // ---------------- Cardio ----------------
  "jumping-jacks": {
    keyframes: [
      { pose: { shL: 10, shR: 10, elL: 5, elR: 5, hipL: 8, hipR: 8, dy: 0 }, ms: 500 },
      { pose: { shL: 160, shR: 160, elL: 5, elR: 5, hipL: 35, hipR: 35, dy: -10 }, ms: 500 },
      { pose: { shL: 10, shR: 10, elL: 5, elR: 5, hipL: 8, hipR: 8, dy: 0 }, ms: 500 },
    ],
  },
  "burpee": {
    keyframes: [
      { pose: { dy: 0 }, ms: 500 },
      { pose: { torso: 25, hipL: 90, hipR: 90, knL: 95, knR: 95, shL: 30, shR: 30, dy: 20 }, ms: 500 },
      { pose: { rot: 90, shL: 75, shR: 75, elL: 15, elR: 15, hipL: 5, hipR: 5, knL: 5, knR: 5, dy: 0 }, ms: 500 },
      { pose: { torso: 25, hipL: 90, hipR: 90, knL: 95, knR: 95, shL: 30, shR: 30, dy: 20 }, ms: 500 },
      { pose: { shL: 150, shR: 150, elL: 10, elR: 10, hipL: 10, hipR: 10, knL: 15, knR: 15, dy: -14 }, ms: 500 },
    ],
  },
  "high-knees": {
    keyframes: [
      { pose: { torso: 8, hipL: 95, knL: 100, hipR: 10, knR: 15, shL: 50, elL: 80, shR: -20, elR: 80, dy: -4 }, ms: 350 },
      { pose: { torso: 8, hipL: 10, knL: 15, hipR: 95, knR: 100, shL: -20, elL: 80, shR: 50, elR: 80, dy: -4 }, ms: 350 },
    ],
  },
  "jump-rope": {
    keyframes: [
      { pose: { shL: 25, shR: 25, elL: 70, elR: 70, dy: 0 }, ms: 400 },
      { pose: { shL: 30, shR: 30, elL: 70, elR: 70, dy: -8 }, ms: 400 },
      { pose: { shL: 25, shR: 25, elL: 70, elR: 70, dy: 0 }, ms: 400 },
    ],
  },
  "treadmill-run": {
    keyframes: [
      { pose: { torso: 10, hipL: 70, knL: 100, hipR: -30, knR: 20, shL: 60, elL: 80, shR: -30, elR: 80, dy: -6 }, ms: 400 },
      { pose: { torso: 10, hipL: -30, knL: 20, hipR: 70, knR: 100, shL: -30, elL: 80, shR: 60, elR: 80, dy: -6 }, ms: 400 },
    ],
  },
  "stationary-bike": {
    keyframes: [
      { pose: { torso: 30, shL: 40, shR: 40, elL: 30, elR: 30, hipL: 85, knL: 90, hipR: 55, knR: 50, dy: 2 }, ms: 500 },
      { pose: { torso: 30, shL: 40, shR: 40, elL: 30, elR: 30, hipL: 55, knL: 50, hipR: 85, knR: 90, dy: -2 }, ms: 500 },
    ],
  },

  // ---------------- Mobility ----------------
  "cat-cow": {
    props: ["mat"],
    keyframes: [
      { pose: { rot: 90, hipL: 90, hipR: 90, knL: 90, knR: 90, shL: 75, shR: 75, elL: 10, elR: 10, torso: -12 }, ms: 1200 },
      { pose: { rot: 90, hipL: 90, hipR: 90, knL: 90, knR: 90, shL: 75, shR: 75, elL: 10, elR: 10, torso: 18 }, ms: 1200 },
    ],
  },
  "thoracic-rotation": {
    props: ["mat"],
    keyframes: [
      { pose: { rot: 90, hipL: 90, hipR: 90, knL: 90, knR: 90, shL: 70, elL: 10, shR: 20, elR: 10 }, ms: 900 },
      { pose: { rot: 90, hipL: 90, hipR: 90, knL: 90, knR: 90, shL: 70, elL: 10, shR: 140, elR: 10 }, ms: 900 },
      { pose: { rot: 90, hipL: 90, hipR: 90, knL: 90, knR: 90, shL: 70, elL: 10, shR: 20, elR: 10 }, ms: 900 },
    ],
  },
  "hip-flexor-stretch": {
    keyframes: [
      { pose: { hipL: 90, knL: 90, hipR: -10, knR: 80, torso: 5, shL: 10, shR: 10, dy: 0 }, ms: 1000 },
      { pose: { hipL: 90, knL: 90, hipR: -10, knR: 80, torso: 5, shL: 10, shR: 10, dy: 3 }, ms: 1000 },
      { pose: { hipL: 90, knL: 90, hipR: -10, knR: 80, torso: 5, shL: 10, shR: 10, dy: 0 }, ms: 1000 },
    ],
  },
  "hamstring-stretch": {
    keyframes: [
      { pose: { torso: 60, hipL: 15, hipR: 15, knL: 5, knR: 5, shL: 30, shR: 30 }, ms: 1000 },
      { pose: { torso: 65, hipL: 15, hipR: 15, knL: 5, knR: 5, shL: 30, shR: 30 }, ms: 1000 },
      { pose: { torso: 60, hipL: 15, hipR: 15, knL: 5, knR: 5, shL: 30, shR: 30 }, ms: 1000 },
    ],
  },
  "childs-pose": {
    props: ["mat"],
    keyframes: [
      { pose: { rot: 90, hipL: 100, hipR: 100, knL: 100, knR: 100, torso: 55, shL: 150, shR: 150, elL: 10, elR: 10, dy: 0 }, ms: 1200 },
      { pose: { rot: 90, hipL: 100, hipR: 100, knL: 100, knR: 100, torso: 55, shL: 150, shR: 150, elL: 10, elR: 10, dy: 2 }, ms: 1200 },
      { pose: { rot: 90, hipL: 100, hipR: 100, knL: 100, knR: 100, torso: 55, shL: 150, shR: 150, elL: 10, elR: 10, dy: 0 }, ms: 1200 },
    ],
  },
};
