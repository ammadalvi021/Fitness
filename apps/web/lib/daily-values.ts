/**
 * Reference Daily Values (DV) for micronutrient %DV display.
 *
 * SOURCE STANDARD: U.S. FDA Daily Values for nutrition labeling,
 * 21 CFR 101.36 (updated Nutrition Facts label, mandatory compliance
 * January 2020). These are the reference intakes printed on U.S. food
 * labels — a single population reference, NOT personalized requirements
 * (individual needs vary by age, sex, pregnancy, and medical conditions).
 *
 * Values (adult reference):
 *   Vitamin A 900 mcg RAE · Vitamin C 90 mg · Vitamin D 20 mcg ·
 *   Vitamin E 15 mg alpha-tocopherol · Vitamin K 120 mcg ·
 *   Calcium 1300 mg · Iron 18 mg · Magnesium 420 mg · Phosphorus 1250 mg ·
 *   Potassium 4700 mg · Sodium 2300 mg · Zinc 11 mg
 *
 * Every micro amount stored in the diary is normalized to the key's
 * standard unit (see MICRO_STANDARD_UNITS in @fitfusion/core), so %DV is
 * a plain ratio — no unit conversion at display time, no conversion bugs.
 */
import {
  MICRO_KEYS,
  MICRO_STANDARD_UNITS,
  scaleMicros,
  sumMicros,
  trackedMicroKeys,
  type MicroKey,
  type MicroNutrients,
  type MicroUnit,
  type MicroValue,
} from '@fitfusion/core';

export {
  MICRO_KEYS,
  MICRO_STANDARD_UNITS,
  scaleMicros,
  sumMicros,
  trackedMicroKeys,
  type MicroKey,
  type MicroNutrients,
  type MicroUnit,
  type MicroValue,
};

export interface DailyValue {
  /** Reference daily value, expressed in `unit`. */
  value: number;
  unit: MicroUnit;
  /** Short display label, e.g. "Vitamin D". */
  label: string;
}

export const DAILY_VALUES: Record<MicroKey, DailyValue> = {
  vitaminA: { value: 900, unit: 'mcg', label: 'Vitamin A' },
  vitaminC: { value: 90, unit: 'mg', label: 'Vitamin C' },
  vitaminD: { value: 20, unit: 'mcg', label: 'Vitamin D' },
  vitaminE: { value: 15, unit: 'mg', label: 'Vitamin E' },
  vitaminK: { value: 120, unit: 'mcg', label: 'Vitamin K' },
  calcium: { value: 1300, unit: 'mg', label: 'Calcium' },
  iron: { value: 18, unit: 'mg', label: 'Iron' },
  magnesium: { value: 420, unit: 'mg', label: 'Magnesium' },
  phosphorus: { value: 1250, unit: 'mg', label: 'Phosphorus' },
  potassium: { value: 4700, unit: 'mg', label: 'Potassium' },
  sodium: { value: 2300, unit: 'mg', label: 'Sodium' },
  zinc: { value: 11, unit: 'mg', label: 'Zinc' },
};

/**
 * % of the reference Daily Value for a tracked amount.
 * Returns null when the amount is not tracked (caller renders "not tracked").
 */
export function pctDailyValue(key: MicroKey, amount: number | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  const dv = DAILY_VALUES[key];
  if (!dv || dv.value <= 0) return null;
  return (amount / dv.value) * 100;
}

/** "12 mg" / "450 mcg" for display. */
export function formatMicroAmount(value: MicroValue): string {
  const rounded = Math.abs(value.amount) >= 100 ? Math.round(value.amount) : Math.round(value.amount * 10) / 10;
  return `${rounded.toLocaleString()} ${value.unit}`;
}

/** Sum micro snapshots across diary entries (day totals). Absent key = not tracked. */
export function sumEntryMicros(entries: { micros?: MicroNutrients | null }[]): MicroNutrients {
  return sumMicros(entries.map((e) => e.micros ?? null));
}
