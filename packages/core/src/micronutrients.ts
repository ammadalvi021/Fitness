/**
 * Micronutrients — canonical micro keys, standard units, pure helpers, zod schema.
 *
 * Design (justified): micros are a heterogeneous, sparsely-present dataset.
 * USDA reports a different subset per food (branded foods often report only
 * a few); seeded/local foods report none. A typed JSON column (see
 * packages/db/prisma/schema.prisma `Food.micros` / `DiaryEntry.micros`)
 * stores a FIXED-schema object keyed by the MicroKey list below — absent
 * key = "not tracked", never 0. This is deliberately NOT a junk drawer:
 * keys are closed (zod .strict() rejects unknown keys), units are fixed per
 * key, and every entry is a {amount, unit} pair in the key's standard unit.
 *
 * HONESTY RULE (binding): never invent values. Missing micro data is
 * represented by absence (undefined), and UI must render "not tracked",
 * never 0%.
 */
import { z } from 'zod';

/** Closed set of tracked micronutrients. */
export const MICRO_KEYS = [
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminK',
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'potassium',
  'sodium',
  'zinc',
] as const;
export type MicroKey = (typeof MICRO_KEYS)[number];

/** The only units a micro value may be stored in — one per key, fixed. */
export type MicroUnit = 'mcg' | 'mg';

/**
 * Standard storage unit per key. All values for a key MUST be expressed in
 * this unit (USDA rows in other units are converted only when the
 * conversion is exact — mg↔mcg — or dropped, never guessed).
 */
export const MICRO_STANDARD_UNITS: Record<MicroKey, MicroUnit> = {
  vitaminA: 'mcg',
  vitaminC: 'mg',
  vitaminD: 'mcg',
  vitaminE: 'mg',
  vitaminK: 'mcg',
  calcium: 'mg',
  iron: 'mg',
  magnesium: 'mg',
  phosphorus: 'mg',
  potassium: 'mg',
  sodium: 'mg',
  zinc: 'mg',
};

/** One tracked micro value: amount expressed in the key's standard unit. */
export interface MicroValue {
  amount: number;
  unit: MicroUnit;
}

/**
 * Per-food / per-entry micro snapshot. Absent key = not tracked.
 * (Never store 0 to mean "unknown".)
 */
export type MicroNutrients = Partial<Record<MicroKey, MicroValue>>;

const MicroValueSchema = z.object({
  amount: z.number().finite().nonnegative(),
  unit: z.enum(['mcg', 'mg']),
});

/**
 * Closed-shape micro payload for diary input. Unknown keys are rejected
 * (strict), and a superRefine rejects values whose unit is not the key's
 * standard unit — a wrong-unit value would silently corrupt %DV math by
 * ×1000, so it must fail validation instead of being "fixed" silently.
 */
export const MicrosSchema = z
  .object({
    vitaminA: MicroValueSchema.optional(),
    vitaminC: MicroValueSchema.optional(),
    vitaminD: MicroValueSchema.optional(),
    vitaminE: MicroValueSchema.optional(),
    vitaminK: MicroValueSchema.optional(),
    calcium: MicroValueSchema.optional(),
    iron: MicroValueSchema.optional(),
    magnesium: MicroValueSchema.optional(),
    phosphorus: MicroValueSchema.optional(),
    potassium: MicroValueSchema.optional(),
    sodium: MicroValueSchema.optional(),
    zinc: MicroValueSchema.optional(),
  })
  .strict()
  .superRefine((obj, ctx) => {
    for (const key of MICRO_KEYS) {
      const v = obj[key];
      if (v && v.unit !== MICRO_STANDARD_UNITS[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key, 'unit'],
          message: `${key} must be expressed in ${MICRO_STANDARD_UNITS[key]} (got ${v.unit})`,
        });
      }
    }
  })
  .optional();

export type MicrosInput = z.infer<typeof MicrosSchema>;

/** Round to 3 decimals — micro amounts are small; 1-decimal would erase them. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Scale a per-serving micro snapshot by a serving multiplier. */
export function scaleMicros(micros: MicroNutrients | null | undefined, factor: number): MicroNutrients | null {
  if (!micros) return null;
  const out: MicroNutrients = {};
  for (const key of MICRO_KEYS) {
    const v = micros[key];
    if (v && Number.isFinite(v.amount) && v.amount >= 0) {
      out[key] = { amount: round3(v.amount * factor), unit: v.unit };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Sum micro snapshots across entries. A key is present in the result only
 * when at least one entry tracked it — absent = "not tracked" for the day,
 * never 0.
 */
export function sumMicros(list: (MicroNutrients | null | undefined)[]): MicroNutrients {
  const totals: Record<MicroKey, number> = {
    vitaminA: 0, vitaminC: 0, vitaminD: 0, vitaminE: 0, vitaminK: 0,
    calcium: 0, iron: 0, magnesium: 0, phosphorus: 0, potassium: 0,
    sodium: 0, zinc: 0,
  };
  const tracked = new Set<MicroKey>();
  for (const m of list) {
    if (!m) continue;
    for (const key of MICRO_KEYS) {
      const v = m[key];
      if (v && Number.isFinite(v.amount) && v.amount >= 0) {
        totals[key] += v.amount;
        tracked.add(key);
      }
    }
  }
  const out: MicroNutrients = {};
  for (const key of tracked) {
    out[key] = { amount: round3(totals[key]), unit: MICRO_STANDARD_UNITS[key] };
  }
  return out;
}

/** Names of keys actually tracked in a snapshot (for "N of 12 tracked" UIs). */
export function trackedMicroKeys(micros: MicroNutrients | null | undefined): MicroKey[] {
  if (!micros) return [];
  return MICRO_KEYS.filter((k) => micros[k] != null);
}
