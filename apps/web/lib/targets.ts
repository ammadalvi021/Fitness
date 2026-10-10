/**
 * Shared client-side computation of calorie / macro / water targets from a
 * user's profile, using the pure @fitfusion/core functions.
 *
 * Returns null when the profile lacks the measurements needed for the
 * Mifflin-St Jeor equation (weight, height, age) — callers show an
 * onboarding/empty state in that case.
 */
import {
  ACTIVITY_FACTORS,
  calculateCalorieTarget,
  calculateMacros,
  mifflinStJeor,
  waterGuidanceMl,
  type ActivityLevel,
  type CalorieTarget,
  type Goal,
  type Sex,
} from "@fitfusion/core";

export interface Targets {
  bmr: number;
  tdee: number;
  calorie: CalorieTarget;
  macros: { proteinG: number; carbsG: number; fatG: number; fiberG: number };
  waterMl: number;
  /** The goal the targets were computed for (may be downgraded to maintain). */
  goal: Goal;
}

export function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function ageFromDob(dob: unknown): number | undefined {
  if (typeof dob !== "string") return undefined;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : undefined;
}

/**
 * Compute daily targets from a profile record (as returned by /api/auth/me
 * or /api/profile). All profile fields are read defensively.
 */
export function profileTargets(
  profile: Record<string, unknown>
): Targets | null {
  const weightKg = num(profile.weightKg, NaN);
  const heightCm = num(profile.heightCm, NaN);
  const age = ageFromDob(profile.dateOfBirth);
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || age === undefined) {
    return null;
  }

  const sex = (profile.sex as Sex) || "other";
  const activity = (profile.activityLevel as ActivityLevel) || "moderate";
  const goal = (profile.goal as Goal) || "maintain";

  const bmr = mifflinStJeor({ sex, weightKg, heightCm, ageYears: age });
  const tdee = bmr * (ACTIVITY_FACTORS[activity] ?? 1.55);
  const calorie = calculateCalorieTarget({
    tdee,
    goal,
    sex,
    flags: {
      isPregnant: Boolean(profile.isPregnant),
      isBreastfeeding: Boolean(profile.isBreastfeeding),
      eatingDisorderRisk: Boolean(profile.eatingDisorderRisk),
    },
  });
  const macroRes = calculateMacros({ calories: calorie.targetKcal, goal, weightKg });
  const waterMl = waterGuidanceMl({ weightKg, activityLevel: activity }).mlPerDay;

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calorie,
    macros: {
      proteinG: Math.round(macroRes.proteinG),
      carbsG: Math.round(macroRes.carbsG),
      fatG: Math.round(macroRes.fatG),
      fiberG: Math.round(macroRes.fiberG),
    },
    waterMl,
    goal,
  };
}
