/**
 * Shared nutrition helpers for the (app)/nutrition routes.
 * Underscore prefix: not a Next.js route.
 */
import {
  ACTIVITY_FACTORS,
  calculateCalorieTarget,
  calculateMacros,
  mealContainsAllergen,
  mifflinStJeor,
  roundNutrients,
  sumNutrients,
  waterGuidanceMl,
} from '@fitfusion/core';
import type {
  ActivityLevel,
  Goal,
  MealType,
  MicroNutrients,
  Nutrients,
  SafetyFlags,
  Sex,
} from '@fitfusion/core';

export type { MealType, Nutrients };

export const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'morning_snack', label: 'Morning snack' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'afternoon_snack', label: 'Afternoon snack' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'extra', label: 'Extra' },
];

/** V18 Ramadan meal types (profile.ramadanMode on). Accepted by POST /api/diary. */
export const RAMADAN_MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: 'sehri', label: 'Sehri' },
  { value: 'iftar', label: 'Iftar' },
];

/** Meal-type options for logging UI: includes Sehri/Iftar when Ramadan mode is on. */
export function mealTypeOptions(ramadanMode: boolean): { value: MealType; label: string }[] {
  return ramadanMode ? [...MEAL_TYPES, ...RAMADAN_MEAL_TYPES] : MEAL_TYPES;
}

export function mealLabel(mealType: string): string {
  return (
    MEAL_TYPES.find((m) => m.value === mealType)?.label ??
    RAMADAN_MEAL_TYPES.find((m) => m.value === mealType)?.label ??
    mealType
  );
}

/** Local-date YYYY-MM-DD (no UTC shift). */
export function toYMD(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayYMD(): string {
  return toYMD(new Date());
}

export function addDaysYMD(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toYMD(dt);
}

/** Parse a YYYY-MM-DD as a local date (avoids the UTC-midnight shift of Date(string)). */
export function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatDayLabel(ymd: string): string {
  return parseYMD(ymd).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatWeekdayLong(ymd: string): string {
  return parseYMD(ymd).toLocaleDateString(undefined, { weekday: 'long' });
}

export interface DiaryEntry {
  id: string;
  date: string;
  mealType: MealType | string;
  foodId?: string | null;
  customName?: string | null;
  servings: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  /** V20: micro snapshot at log time (absent key = not tracked). */
  micros?: MicroNutrients | null;
  source?: string;
}

export function entryName(e: DiaryEntry): string {
  return e.customName?.trim() || 'Logged food';
}

/**
 * Normalize API list responses: accepts {key:[...]}, [...], {data:{key:[...]}},
 * or {data:[...]}.
 */
export function unwrapList<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj[key])) return obj[key] as T[];
    const nested = obj.data;
    if (nested && typeof nested === 'object') {
      const n = nested as Record<string, unknown>;
      if (Array.isArray(n[key])) return n[key] as T[];
      if (Array.isArray(nested)) return nested as T[];
    }
    // common wrappers: {scan}, {plan}, {recipe} are not lists; fall through
  }
  return [];
}

/** Normalize a single-object response: {key:{...}} | {...}. */
export function unwrapObject<T>(data: unknown, key: string): T | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (obj[key] && typeof obj[key] === 'object') return obj[key] as T;
    return obj as T;
  }
  return null;
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : fallback;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Flatten a diary-entry body into the shape POST /api/diary expects.
 *
 * The nutrition page builds entries with nutrients nested under a
 * `nutrients` key (`{ nutrients: { kcal, proteinG, ... } }`), but
 * DiaryEntrySchema requires them FLAT at the top level. Sending the nested
 * shape fails validation with "Invalid diary entry" — every add path
 * (search, manual, recipe, favorites) was broken by this. This helper
 * merges `nutrients` into the top level; callers keep their nested shape.
 */
export function toDiaryPayload(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const { nutrients, ...rest } = body;
  const flat: Record<string, unknown> = { ...rest };
  if (nutrients && typeof nutrients === 'object' && !Array.isArray(nutrients)) {
    for (const [k, v] of Object.entries(nutrients as Record<string, unknown>)) {
      // Never let a nested key clobber an explicit top-level field.
      if (!(k in flat)) flat[k] = v;
    }
  }
  return flat;
}

export function sumEntries(entries: DiaryEntry[]): Nutrients {
  return roundNutrients(
    sumNutrients(
      entries.map((e) => ({
        kcal: num(e.kcal),
        proteinG: num(e.proteinG),
        carbsG: num(e.carbsG),
        fatG: num(e.fatG),
        fiberG: num(e.fiberG),
      })),
    ),
  );
}

export interface ProfileLike {
  sex?: string | null;
  heightCm?: number | null;
  dateOfBirth?: string | null;
  activityLevel?: string | null;
  goal?: string | null;
  targetWeightKg?: number | null;
  allergies?: string[] | null;
  intolerances?: string[] | null;
  dietPreference?: string | null;
  mealsPerDay?: number | null;
  isPregnant?: boolean | null;
  isBreastfeeding?: boolean | null;
  eatingDisorderRisk?: boolean | null;
}

export interface Targets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  waterMl: number;
  weightLossDisabled: boolean;
  professionalGuidance?: string;
  /** true when any input fell back to a default (targets are approximate). */
  estimated: boolean;
  notes: string[];
}

const SEXES: Sex[] = ['male', 'female', 'other', 'prefer_not_to_say'];
const ACTIVITIES: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
const GOALS: Goal[] = ['lose', 'maintain', 'gain', 'improve_fitness', 'eat_healthier'];

function ageFromDob(dob?: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Derive daily calorie/macro/water targets from the user's profile +
 * latest weight, using @fitfusion/core (pure, deterministic).
 * Falls back to neutral defaults with `estimated: true` when data is missing.
 */
export function computeTargets(profile: ProfileLike | null, weightKg?: number | null): Targets {
  const notes: string[] = [];
  let estimated = false;

  const sex: Sex = profile?.sex && SEXES.includes(profile.sex as Sex) ? (profile.sex as Sex) : 'other';
  const activity: ActivityLevel =
    profile?.activityLevel && ACTIVITIES.includes(profile.activityLevel as ActivityLevel)
      ? (profile.activityLevel as ActivityLevel)
      : 'moderate';
  const goal: Goal =
    profile?.goal && GOALS.includes(profile.goal as Goal) ? (profile.goal as Goal) : 'maintain';

  const age = ageFromDob(profile?.dateOfBirth) ?? 30;
  if (ageFromDob(profile?.dateOfBirth) == null) {
    estimated = true;
    notes.push('Age not set — using 30 for estimates.');
  }
  const wKg = weightKg ?? profile?.targetWeightKg ?? 70;
  if (weightKg == null && profile?.targetWeightKg == null) {
    estimated = true;
    notes.push('Weight not set — using 70 kg for estimates.');
  }
  const heightCm = profile?.heightCm ?? 170;
  if (profile?.heightCm == null) {
    estimated = true;
    notes.push('Height not set — using 170 cm for estimates.');
  }

  const flags: SafetyFlags = {
    isMinor: age < 18,
    isPregnant: Boolean(profile?.isPregnant),
    isBreastfeeding: Boolean(profile?.isBreastfeeding),
    eatingDisorderRisk: Boolean(profile?.eatingDisorderRisk),
  };

  const bmr = mifflinStJeor({ sex, weightKg: wKg, heightCm, ageYears: age });
  const tdee = Math.round(bmr * ACTIVITY_FACTORS[activity]);
  const cal = calculateCalorieTarget({ tdee, goal, sex, flags, targetRateKgPerWeek: 0.5 });
  const macros = calculateMacros({ calories: cal.targetKcal, goal, weightKg: wKg });
  const water = waterGuidanceMl({ weightKg: wKg, activityLevel: activity });

  return {
    kcal: cal.targetKcal,
    proteinG: Math.round(macros.proteinG),
    carbsG: Math.round(macros.carbsG),
    fatG: Math.round(macros.fatG),
    fiberG: Math.round(macros.fiberG),
    waterMl: water.mlPerDay,
    weightLossDisabled: cal.weightLossDisabled,
    professionalGuidance: cal.professionalGuidance,
    estimated,
    notes: [...notes, ...macros.notes],
  };
}

/** Warn (never silently substitute) when a food name matches a user allergen. */
export function allergenHits(names: (string | null | undefined)[], allergies: string[]): string[] {
  const clean = names.filter((n): n is string => Boolean(n && n.trim()));
  if (clean.length === 0 || allergies.length === 0) return [];
  return mealContainsAllergen(clean, allergies);
}

/** New Idempotency-Key for every diary write (contract requirement). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
