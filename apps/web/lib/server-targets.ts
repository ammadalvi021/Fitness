/**
 * Server-side nutrition target computation from Profile + latest weight
 * measurement. Wraps @fitfusion/core energy functions with graceful
 * fallbacks when profile data is incomplete (targets are still returned
 * and the assumptions are surfaced to the caller).
 */
import { prisma } from '@fitfusion/db';
import type { Profile } from '@fitfusion/db';
import {
  ACTIVITY_FACTORS,
  calculateCalorieTarget,
  calculateMacros,
  kgFromLb,
  mifflinStJeor,
  waterGuidanceMl,
} from '@fitfusion/core';
import type { ActivityLevel, Goal, Sex } from '@fitfusion/core';

const SEXES: Sex[] = ['male', 'female', 'other', 'prefer_not_to_say'];
const ACTIVITY_LEVELS: ActivityLevel[] = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
];
const GOALS: Goal[] = [
  'lose',
  'maintain',
  'gain',
  'improve_fitness',
  'eat_healthier',
];

export function ageYearsFromDob(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 0 ? age : null;
}

export interface TargetSummary {
  calorieTarget: number;
  tdee: number | null;
  macros: {
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    notes: string[];
  };
  waterMl: number | null;
  warnings: string[];
  assumptions: string[];
  ageYears: number | null;
  weightLossDisabled: boolean;
  professionalGuidance?: string;
}

function weightKgFromMeasurement(
  m: { value: number; unit: string } | null,
): number | null {
  if (!m) return null;
  const unit = m.unit.toLowerCase();
  if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') {
    return kgFromLb(m.value);
  }
  return m.value;
}

export async function computeTargets(
  userId: string,
  profile: Profile | null,
): Promise<TargetSummary> {
  const assumptions: string[] = [];
  const warnings: string[] = [];

  const latestWeight = await prisma.measurement.findFirst({
    where: { userId, type: 'weight' },
    orderBy: { recordedAt: 'desc' },
  });
  const weightKg = weightKgFromMeasurement(
    latestWeight
      ? { value: latestWeight.value, unit: latestWeight.unit }
      : null,
  );

  const sex: Sex | null =
    profile?.sex && (SEXES as string[]).includes(profile.sex)
      ? (profile.sex as Sex)
      : null;
  const heightCm = profile?.heightCm ?? null;
  const ageYears = ageYearsFromDob(profile?.dateOfBirth ?? null);
  const activityLevel: ActivityLevel =
    profile?.activityLevel &&
    (ACTIVITY_LEVELS as string[]).includes(profile.activityLevel)
      ? (profile.activityLevel as ActivityLevel)
      : 'moderate';
  const goal: Goal =
    profile?.goal && (GOALS as string[]).includes(profile.goal)
      ? (profile.goal as Goal)
      : 'maintain';

  const flags = {
    isMinor: ageYears !== null && ageYears < 18,
    isPregnant: Boolean(profile?.isPregnant),
    isBreastfeeding: Boolean(profile?.isBreastfeeding),
    eatingDisorderRisk: Boolean(profile?.eatingDisorderRisk),
    medicalCondition: Boolean(
      profile?.healthLimitations && profile.healthLimitations.trim().length > 0,
    ),
  };

  let tdee: number | null = null;
  if (weightKg && heightCm && ageYears !== null && sex) {
    tdee = Math.round(
      mifflinStJeor({ sex, weightKg, heightCm, ageYears }) *
        ACTIVITY_FACTORS[activityLevel],
    );
  } else {
    assumptions.push(
      'Weight, height, age, or sex is missing — using a 2000 kcal default target until your profile is complete.',
    );
  }

  const target = calculateCalorieTarget({
    // When TDEE is unknown, evaluate the safety rules against a 2000 kcal
    // maintenance baseline; the reported target stays the 2000 default.
    tdee: tdee ?? 2000,
    goal,
    sex: sex ?? 'other',
    flags,
  });
  const calorieTarget = tdee === null ? 2000 : target.targetKcal;
  warnings.push(...target.warnings);
  assumptions.push(...target.assumptions);

  // V20 Feature 1: user-set calorie target override (set from the
  // adaptive-TDEE dashboard card). Same 1200–6000 bounds as the validator.
  const overrideRaw = profile?.calorieTargetOverrideKcal;
  const overrideKcal =
    typeof overrideRaw === 'number' &&
    Number.isFinite(overrideRaw) &&
    overrideRaw >= 1200 &&
    overrideRaw <= 6000
      ? Math.round(overrideRaw)
      : null;
  if (overrideKcal !== null) {
    assumptions.push(
      `Using your manually set daily calorie target of ${overrideKcal.toLocaleString()} kcal/day instead of the calculated target.`,
    );
  }
  const effectiveCalorieTarget = overrideKcal ?? calorieTarget;

  const macros = calculateMacros({
    calories: effectiveCalorieTarget,
    goal,
    weightKg: weightKg ?? 70,
  });

  let waterMl: number | null = null;
  if (weightKg) {
    waterMl = waterGuidanceMl({ weightKg, activityLevel }).mlPerDay;
  }

  return {
    calorieTarget: effectiveCalorieTarget,
    tdee,
    macros,
    waterMl,
    warnings,
    assumptions,
    ageYears,
    weightLossDisabled: target.weightLossDisabled,
    professionalGuidance: target.professionalGuidance,
  };
}
