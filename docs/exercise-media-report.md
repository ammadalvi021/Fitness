# Exercise media availability report

Generated: 2026-10-11 — from `apps/web/lib/exercise-media/registry.ts`.
Regenerate with: `npx tsx scripts/exercise-media-report.ts`

## Counts

| Category | Count |
|---|---|
| Verified human GIFs (gif/webp) | 0 |
| Verified human videos (mp4/webm) | 0 |
| Exercises with three-stage illustration | 50 |
| Exercises with text-only technique instructions | 50 |
| Total exercises in registry | 50 |

## Verified assets

None. No human GIF, WebP, MP4, or WebM demonstration exists for any
exercise yet. The registry is intentionally empty: every entry is
`verificationStatus: "missing"` with null URLs by design.

Until real, professionally-reviewed footage is imported (see
docs/exercise-media-import.md), each exercise shows a three-stage
static illustration captioned “Illustration — human demonstration
coming soon”, plus the full written technique instructions.

## Awaiting human demonstration

- ab-wheel-rollout (Ab Wheel Rollout)
- barbell-back-squat (Barbell Back Squat)
- barbell-bench-press (Barbell Bench Press)
- barbell-curl (Barbell Curl)
- barbell-overhead-press (Barbell Overhead Press)
- bench-dip (Bench Dip)
- bent-over-barbell-row (Bent-Over Barbell Row)
- bicycle-crunch (Bicycle Crunch)
- bodyweight-squat (Bodyweight Squat)
- bulgarian-split-squat (Bulgarian Split Squat)
- burpee (Burpee)
- cat-cow (Cat-Cow)
- chest-fly-machine (Machine Chest Fly)
- childs-pose (Child's Pose)
- dead-bug (Dead Bug)
- dumbbell-bench-press (Dumbbell Bench Press)
- dumbbell-bicep-curl (Dumbbell Bicep Curl)
- dumbbell-overhead-press (Dumbbell Overhead Press)
- dumbbell-shrug (Dumbbell Shrug)
- face-pull (Face Pull)
- front-raise (Front Raise)
- glute-bridge (Glute Bridge)
- goblet-squat (Goblet Squat)
- hammer-curl (Hammer Curl)
- hamstring-stretch (Standing Hamstring Stretch)
- hanging-knee-raise (Hanging Knee Raise)
- high-knees (High Knees)
- hip-flexor-stretch (Half-Kneeling Hip Flexor Stretch)
- incline-push-up (Incline Push-Up)
- jump-rope (Jump Rope)
- jumping-jacks (Jumping Jacks)
- lat-pulldown (Lat Pulldown)
- lateral-raise (Lateral Raise)
- leg-press (Leg Press)
- mountain-climber (Mountain Climber)
- one-arm-dumbbell-row (One-Arm Dumbbell Row)
- overhead-tricep-extension (Overhead Tricep Extension)
- plank (Plank)
- pull-up (Pull-Up)
- push-up (Push-Up)
- romanian-deadlift (Romanian Deadlift)
- russian-twist (Russian Twist)
- seated-cable-row (Seated Cable Row)
- standing-calf-raise (Standing Calf Raise)
- stationary-bike (Stationary Bike)
- superman (Superman)
- thoracic-rotation (Thoracic Rotation (Open Book))
- treadmill-run (Treadmill Run)
- tricep-pushdown (Tricep Pushdown)
- walking-lunge (Walking Lunge)

## Notes

- This report is generated from the registry — it cannot drift from it.
- Technique instructions (steps, breathing, mistakes, variations,
  safety notes) come from the existing exercise seed data and are always
  shown regardless of media state.
- Exercise advice in this app has not been medically or professionally
  reviewed unless an entry's reviewDate says so.
