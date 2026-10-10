/**
 * Energy math: activity factors, Mifflin-St Jeor BMR, and calorie targets.
 *
 * Safety rules (non-negotiable, from CONTRACT.md):
 * - Any of isMinor / isPregnant / isBreastfeeding / eatingDisorderRisk /
 *   medicalCondition => weightLossDisabled = true, targetKcal = round(tdee),
 *   professionalGuidance set, NO deficit prescribed; goal 'lose' is treated
 *   as 'maintain' with an explanation.
 * - Else goal 'lose': deficit = min(20% of TDEE, targetRateKgPerWeek * 1100
 *   kcal/day, hard cap 750); floor 1500 kcal (male) / 1200 kcal
 *   (female/other) unless userOverrideKcal is provided (then the override is
 *   accepted and a warning is added).
 * - Goal 'gain': +300 kcal surplus. 'maintain' / 'improve_fitness' /
 *   'eat_healthier': TDEE.
 */

import type { ActivityLevel, Goal, SafetyFlags, Sex } from './types.js';

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export function mifflinStJeor(o: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}): number {
  const { sex, weightKg, heightCm, ageYears } = o;
  // male: 10w + 6.25h − 5a + 5 ; female: 10w + 6.25h − 5a − 161
  const male = 10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5;
  const female = 10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161;
  if (sex === 'male') return male;
  if (sex === 'female') return female;
  // 'other' / 'prefer_not_to_say': average of the two formulas
  return (male + female) / 2;
}

export interface CalorieTarget {
  targetKcal: number;
  deficitKcal: number;
  warnings: string[];
  weightLossDisabled: boolean;
  professionalGuidance?: string;
  assumptions: string[];
}

const PROFESSIONAL_GUIDANCE =
  'Please consult a qualified health professional for personalized guidance.';

const SAFE_FLOOR_MALE = 1500;
const SAFE_FLOOR_FEMALE_OTHER = 1200;
const MAX_DEFICIT_KCAL = 750;
const KCAL_PER_KG_PER_WEEK = 1100; // ~7700 kcal/kg ÷ 7 days

function activeFlagNames(flags: SafetyFlags): string[] {
  const names: string[] = [];
  if (flags.isMinor) names.push('minor (under 18)');
  if (flags.isPregnant) names.push('pregnancy');
  if (flags.isBreastfeeding) names.push('breastfeeding');
  if (flags.eatingDisorderRisk) names.push('eating-disorder risk');
  if (flags.medicalCondition) names.push('medical condition');
  return names;
}

export function calculateCalorieTarget(o: {
  tdee: number;
  goal: Goal;
  sex: Sex;
  flags: SafetyFlags;
  /** Default 0.5 kg/week. */
  targetRateKgPerWeek?: number;
  /** Explicit user override; requires an acknowledged warning. */
  userOverrideKcal?: number | null;
}): CalorieTarget {
  const { tdee, goal, sex, flags } = o;
  const warnings: string[] = [];
  const assumptions: string[] = [];

  const triggered = activeFlagNames(flags);

  // ---- Safety branch: weight loss disabled ----
  if (triggered.length > 0) {
    const targetKcal = Math.round(tdee);
    if (goal === 'lose') {
      warnings.push(
        `Weight loss is disabled because of: ${triggered.join(', ')}. ` +
          `Your 'lose' goal has been treated as 'maintain' — no calorie deficit ` +
          `has been prescribed. Your target is set to your estimated maintenance ` +
          `(${targetKcal} kcal/day).`,
      );
    } else {
      warnings.push(
        `No calorie deficit prescribed because of: ${triggered.join(', ')}. ` +
          `Your target is set to your estimated maintenance (${targetKcal} kcal/day).`,
      );
    }
    assumptions.push(
      `TDEE ${tdee} kcal/day (provided) → maintenance target ${targetKcal} kcal/day (rounded).`,
    );
    return {
      targetKcal,
      deficitKcal: 0,
      warnings,
      weightLossDisabled: true,
      professionalGuidance: PROFESSIONAL_GUIDANCE,
      assumptions,
    };
  }

  const override =
    o.userOverrideKcal != null &&
    Number.isFinite(o.userOverrideKcal) &&
    o.userOverrideKcal > 0
      ? Math.round(o.userOverrideKcal)
      : null;

  // ---- Goal: gain ----
  if (goal === 'gain') {
    const base = Math.round(tdee) + 300;
    const targetKcal = override ?? base;
    if (override != null) {
      warnings.push(
        `Using your explicit override of ${override} kcal/day instead of the calculated ${base} kcal/day.`,
      );
    }
    assumptions.push(
      `Target = round(TDEE ${tdee}) + 300 kcal/day surplus for gradual weight gain = ${base} kcal/day.`,
    );
    return {
      targetKcal,
      deficitKcal: 0,
      warnings,
      weightLossDisabled: false,
      assumptions,
    };
  }

  // ---- Goals: maintain / improve_fitness / eat_healthier ----
  if (goal !== 'lose') {
    const base = Math.round(tdee);
    const targetKcal = override ?? base;
    if (override != null) {
      warnings.push(
        `Using your explicit override of ${override} kcal/day instead of the calculated ${base} kcal/day.`,
      );
    }
    assumptions.push(
      `Target = round(TDEE ${tdee}) = ${base} kcal/day (maintenance; no deficit or surplus).`,
    );
    return {
      targetKcal,
      deficitKcal: 0,
      warnings,
      weightLossDisabled: false,
      assumptions,
    };
  }

  // ---- Goal: lose ----
  const rate = o.targetRateKgPerWeek ?? 0.5;
  const pctDeficit = 0.2 * tdee;
  const rateDeficit = rate * KCAL_PER_KG_PER_WEEK;
  const deficit = Math.round(
    Math.min(pctDeficit, rateDeficit, MAX_DEFICIT_KCAL),
  );
  assumptions.push(
    `Deficit ${deficit} kcal/day = min(20% of TDEE [${Math.round(pctDeficit)}], ` +
      `rate-based [${rate} kg/week × ${KCAL_PER_KG_PER_WEEK} = ${Math.round(rateDeficit)}], ` +
      `hard cap ${MAX_DEFICIT_KCAL}).`,
  );

  const floor = sex === 'male' ? SAFE_FLOOR_MALE : SAFE_FLOOR_FEMALE_OTHER;
  assumptions.push(
    `Safe minimum floor is ${floor} kcal/day (${sex === 'male' ? 'male' : 'female/other'}).`,
  );

  let targetKcal = Math.round(tdee) - deficit;
  let deficitKcal = deficit;

  if (targetKcal < floor) {
    if (override != null) {
      targetKcal = override;
      deficitKcal = Math.max(0, Math.round(tdee) - override);
      warnings.push(
        `Your chosen target of ${override} kcal/day is below the safe minimum of ` +
          `${floor} kcal/day. It has been accepted as your explicit override, but ` +
          `such low intakes can be unsafe — ${PROFESSIONAL_GUIDANCE}`,
      );
      assumptions.push(
        `Calculated target ${Math.round(tdee) - deficit} kcal/day was below the ${floor} ` +
          `kcal/day floor; explicit user override ${override} kcal/day accepted with warning.`,
      );
    } else {
      warnings.push(
        `The calculated target of ${Math.round(tdee) - deficit} kcal/day was below the ` +
          `safe minimum of ${floor} kcal/day, so your target has been raised to the ` +
          `floor (${floor} kcal/day).`,
      );
      assumptions.push(
        `Calculated target ${Math.round(tdee) - deficit} kcal/day was below the ${floor} ` +
          `kcal/day floor; target raised to floor.`,
      );
      targetKcal = floor;
      deficitKcal = Math.round(tdee) - floor;
    }
  } else if (override != null) {
    targetKcal = override;
    deficitKcal = Math.max(0, Math.round(tdee) - override);
    warnings.push(
      `Using your explicit override of ${override} kcal/day instead of the calculated ` +
        `${Math.round(tdee) - deficit} kcal/day.`,
    );
    assumptions.push(
      `Explicit user override ${override} kcal/day applied (above the ${floor} kcal/day floor).`,
    );
  } else {
    assumptions.push(
      `Target = round(TDEE ${tdee}) − deficit ${deficit} = ${targetKcal} kcal/day.`,
    );
  }

  return {
    targetKcal,
    deficitKcal,
    warnings,
    weightLossDisabled: false,
    assumptions,
  };
}
