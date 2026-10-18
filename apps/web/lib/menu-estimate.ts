/**
 * Pure nutrition-estimate helper for restaurant menu items whose nutrition is
 * NOT published by the restaurant (nutritionStatus 'calculated_estimate').
 *
 * estimateFromRecipe sums per-ingredient nutrients, optionally adds an explicit
 * cooking-oil allowance for frying, and returns a HONEST range
 * (kcalLow / kcalBest / kcalHigh) plus the assumptions that justify the range.
 *
 * The range is widened when key inputs are missing (e.g. frying with an
 * unquantified oil amount) so uncertainty is visible, not hidden.
 *
 * NULL VS ZERO (v21.8 P5): a missing value and a genuine zero are DIFFERENT
 * facts and are never conflated:
 * - `null` / `undefined` (or NaN) for kcal or a macro means UNKNOWN — the
 *   data was never supplied. The row is reported in `problems` (naming the
 *   missing fields) and the estimate is incomplete.
 * - `0` means KNOWN ZERO — the source asserts the value is zero (e.g. water
 *   at 0 kcal/100 g from a trusted source). It is accepted as real data and
 *   the estimate can be complete.
 * - Negative numbers are invalid data, never silently clamped.
 *
 * COMPLETENESS (v21.8 P5): completeness is tracked INDEPENDENTLY per
 * nutrient — `fields` reports known/unknown for calories, protein, carbs,
 * fat, and fiber. `complete` is true only when every non-blank ingredient
 * row was fully resolvable (valid quantity, valid calorie data, and known
 * data for every macro the estimator sums). When `complete` is false the
 * numbers are a PARTIAL subtotal and must never be presented as the dish
 * total — the admin publish path (`applyEstimate`) refuses them.
 *
 * Frying without quantified oil stays `complete: true` by design (v21.8 P6):
 * the unknown absorbed oil is honestly accounted for by widening the range
 * to ±20% and recording the assumption — the range, not the point total,
 * is the honest answer there. `fields` therefore reflects row-level data;
 * the oil caveat lives in `assumptions`.
 *
 * Honesty rule: invalid ingredient rows are NEVER silently dropped. Any row
 * with a name but missing/invalid quantity or missing/invalid calorie data
 * is reported in `problems` and the result is marked `complete: false` —
 * the totals then cover only the valid rows and must not be presented as the
 * dish total. Only truly blank placeholder rows are skipped without comment.
 */

export interface EstimateIngredient {
  name: string;
  /** grams of this ingredient in the portion being estimated */
  grams: number;
  /**
   * kcal per 100 g of the ingredient (as prepared / raw, noted in assumptions).
   * Omitted / `null` / `undefined` = unknown (missing data);
   * `0` = known zero (e.g. water).
   */
  kcalPer100g?: number | null;
  /**
   * Per-100 g macros. `null`/`undefined` = unknown; `0` = known zero.
   * Unknown macros on an otherwise valid row mark the estimate incomplete
   * (the macro totals would otherwise masquerade missing data as zero).
   */
  proteinPer100g?: number | null;
  carbsPer100g?: number | null;
  fatPer100g?: number | null;
  fiberPer100g?: number | null;
}

export interface RecipeEstimateInput {
  /** Ingredients making up the estimated portion. */
  ingredients: EstimateIngredient[];
  /** Serving weight in grams the estimate is scaled to. */
  portionGrams: number;
  /** How the dish is cooked, e.g. 'grilled', 'fried', 'steamed', 'baked'. */
  cookingMethod?: string;
  /**
   * Explicit cooking-oil allowance in grams (absorbed oil for frying).
   * Default 0 — when frying and this is 0, the range is widened and an
   * assumption is recorded instead of guessing silently.
   */
  oilGrams?: number;
}

/** Nutrients whose completeness is tracked independently. */
export type NutrientField = 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber';

/** Per-nutrient data status: 'unknown' = never supplied (null/undefined/NaN). */
export type FieldStatus = 'known' | 'unknown';

/**
 * One ingredient row that could not be fully used in the estimate.
 * When any problem exists, the estimate is marked incomplete and its totals
 * must never be presented as the dish total.
 */
export interface EstimateProblem {
  /** 1-based row number, matching what the user sees in the form. */
  row: number;
  /** Ingredient name as entered (may be '' for unnamed rows). */
  ingredient: string;
  /** What the admin must correct (which field, and why). */
  reason: string;
  /**
   * Which nutrition fields were missing or invalid on this row
   * (subset of NutrientField; [] for quantity problems). Lets the admin
   * see at a glance what data each row still needs.
   */
  fields: NutrientField[];
}

export interface RecipeEstimate {
  kcalLow: number;
  kcalBest: number;
  kcalHigh: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  assumptions: string[];
  /**
   * True only when every non-blank ingredient row was fully resolvable
   * (valid quantity, valid calorie data, known macros). When false, the
   * numbers above are a PARTIAL subtotal of the valid rows — do not
   * present them as the dish's nutrition.
   */
  complete: boolean;
  /** Per-row reasons; empty when complete is true. */
  problems: EstimateProblem[];
  /**
   * Per-nutrient completeness, tracked independently: 'unknown' when any
   * contributing row lacked that nutrient's data (null/undefined/NaN).
   * A genuine 0 is 'known'.
   */
  fields: Record<NutrientField, FieldStatus>;
}

/** Cooking oil: ~884 kcal / 100 g. */
const OIL_KCAL_PER_100G = 884;

const FRY_KEYWORDS = ['fry', 'fried', 'deep-fry', 'deep fry', 'saut', 'wok', 'karahi', 'tarka'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Genuine known value: finite and non-negative. 0 counts as known. */
function isKnownValue(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** Missing data: null/undefined/NaN (anything that is not a usable number). */
function isMissing(v: number | null | undefined): boolean {
  return v == null || !Number.isFinite(v as number);
}

const MACRO_FIELDS: ReadonlyArray<{
  key: Exclude<NutrientField, 'calories'>;
  label: string;
  get: (i: EstimateIngredient) => number | null | undefined;
}> = [
  { key: 'protein', label: 'protein', get: (i) => i.proteinPer100g },
  { key: 'carbs', label: 'carbs', get: (i) => i.carbsPer100g },
  { key: 'fat', label: 'fat', get: (i) => i.fatPer100g },
  { key: 'fiber', label: 'fiber', get: (i) => i.fiberPer100g },
];

export function estimateFromRecipe(input: RecipeEstimateInput): RecipeEstimate {
  const problems: EstimateProblem[] = [];
  const valid: EstimateIngredient[] = [];

  // Classify EVERY row instead of silently dropping the bad ones: any named
  // row with missing/invalid data marks the whole estimate incomplete, so a
  // partial subtotal can never masquerade as the complete dish nutrition.
  // Only truly blank placeholder rows (no name, no quantity, no data) are
  // skipped without comment.
  const rows = input.ingredients ?? [];
  rows.forEach((i, idx) => {
    const row = idx + 1;
    if (!i) return; // defensive: treat a null entry as a blank row
    const name = (i.name ?? '').trim();
    const grams = i.grams;
    const kcal = i.kcalPer100g;
    const hasQuantity = Number.isFinite(grams) && (grams as number) !== 0;
    // For blank-row detection only: an unnamed row whose kcal field holds
    // the form's 0 default is still a placeholder, not data.
    const hasData = Number.isFinite(kcal) && (kcal as number) !== 0;

    if (!name) {
      if (hasQuantity || hasData) {
        problems.push({
          row,
          ingredient: '',
          reason:
            'Row has a quantity or calorie value but no ingredient name — add a name or remove the row.',
          fields: [],
        });
      }
      return;
    }
    const label = `"${name}"`;
    if (!Number.isFinite(grams)) {
      problems.push({
        row,
        ingredient: name,
        reason: `Quantity for ${label} is missing or not a number — enter the amount in grams.`,
        fields: [],
      });
      return;
    }
    if ((grams as number) <= 0) {
      problems.push({
        row,
        ingredient: name,
        reason: `Quantity for ${label} is not a positive gram amount (got ${grams}) — enter grams; unquantified items like "oil to taste" cannot be estimated until weighed.`,
        fields: [],
      });
      return;
    }
    // NULL VS ZERO: null/undefined/NaN kcal = unknown (missing data);
    // 0 = known zero and fully valid; negatives are invalid.
    if (isMissing(kcal)) {
      problems.push({
        row,
        ingredient: name,
        reason: `No calorie data for ${label} — enter kcal per 100 g, or the ingredient cannot be included in the estimate.`,
        fields: ['calories'],
      });
      return;
    }
    if ((kcal as number) < 0) {
      problems.push({
        row,
        ingredient: name,
        reason: `Calorie data for ${label} is invalid (${kcal}) — enter kcal per 100 g as 0 or a positive number (0 means a known zero, e.g. water).`,
        fields: ['calories'],
      });
      return;
    }
    // The row contributes to the sums; now check macro completeness. A
    // missing macro here would otherwise be silently summed as 0 and
    // published as data, so it is a problem naming the missing fields.
    const missingMacros: NutrientField[] = [];
    const invalidMacros: NutrientField[] = [];
    for (const m of MACRO_FIELDS) {
      const v = m.get(i);
      if (isMissing(v)) missingMacros.push(m.key);
      else if ((v as number) < 0) invalidMacros.push(m.key);
    }
    if (missingMacros.length > 0 || invalidMacros.length > 0) {
      const parts: string[] = [];
      if (missingMacros.length > 0) parts.push(`no ${missingMacros.join(', ')} data`);
      if (invalidMacros.length > 0)
        parts.push(`invalid (negative) ${invalidMacros.join(', ')} data`);
      problems.push({
        row,
        ingredient: name,
        reason:
          `No usable macro data for ${label} (${parts.join('; ')}) — enter per-100 g values ` +
          `(0 is allowed for a genuine zero); the estimate cannot be marked complete while any field is unknown.`,
        fields: [...missingMacros, ...invalidMacros],
      });
    }
    valid.push(i);
  });

  const complete = problems.length === 0;
  const method = (input.cookingMethod ?? '').trim();
  const oilGrams = Number.isFinite(input.oilGrams) && (input.oilGrams as number) > 0
    ? (input.oilGrams as number)
    : 0;

  const assumptions: string[] = [];

  if (!complete) {
    assumptions.push(
      `INCOMPLETE: ${problems.length} ingredient row(s) could not be resolved — totals below cover only the ${valid.length} valid row(s) and are NOT the dish total;`,
    );
    for (const p of problems) {
      assumptions.push(
        `Row ${p.row}${p.ingredient ? ` ("${p.ingredient}")` : ''}: ${p.reason}`,
      );
    }
  }

  // Per-nutrient completeness over the contributing rows: a nutrient is
  // 'known' only when every contributing row supplied a genuine value
  // (a real 0 counts as known; null/undefined/NaN counts as unknown).
  const fields: Record<NutrientField, FieldStatus> = {
    calories: 'known',
    protein: 'known',
    carbs: 'known',
    fat: 'known',
    fiber: 'known',
  };
  for (const i of valid) {
    if (!isKnownValue(i.kcalPer100g)) fields.calories = 'unknown';
    if (!isKnownValue(i.proteinPer100g)) fields.protein = 'unknown';
    if (!isKnownValue(i.carbsPer100g)) fields.carbs = 'unknown';
    if (!isKnownValue(i.fatPer100g)) fields.fat = 'unknown';
    if (!isKnownValue(i.fiberPer100g)) fields.fiber = 'unknown';
  }

  // Base sums from the valid ingredient rows only. Unknown macro values on
  // problem rows are sanitized to 0 here (they are reported in `problems`
  // and the estimate is incomplete, so they must not poison the sums).
  const ingredients = valid;
  let kcal = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  let fiberG = 0;
  let listedGrams = 0;
  for (const i of ingredients) {
    const f = i.grams / 100;
    kcal += f * (isKnownValue(i.kcalPer100g) ? i.kcalPer100g : 0);
    proteinG += f * (isKnownValue(i.proteinPer100g) ? i.proteinPer100g : 0);
    carbsG += f * (isKnownValue(i.carbsPer100g) ? i.carbsPer100g : 0);
    fatG += f * (isKnownValue(i.fatPer100g) ? i.fatPer100g : 0);
    fiberG += f * (isKnownValue(i.fiberPer100g) ? i.fiberPer100g : 0);
    listedGrams += i.grams;
  }

  assumptions.push(
    `Sum of ${ingredients.length} listed ingredient(s) using generic per-100 g values;`,
  );

  // Scale to the stated portion weight when the ingredient list doesn't match it.
  const portionGrams = input.portionGrams;
  if (Number.isFinite(portionGrams) && portionGrams > 0 && listedGrams > 0) {
    const ratio = portionGrams / listedGrams;
    if (Math.abs(ratio - 1) > 0.01) {
      kcal *= ratio;
      proteinG *= ratio;
      carbsG *= ratio;
      fatG *= ratio;
      fiberG *= ratio;
      assumptions.push(
        `Scaled by ${ratio.toFixed(2)}× to match the stated portion weight (${portionGrams} g vs ${Math.round(listedGrams)} g listed);`,
      );
    }
  } else if (!Number.isFinite(portionGrams) || portionGrams <= 0) {
    assumptions.push('No portion weight given — totals are for the listed ingredient amounts only;');
  }

  const methodLower = method.toLowerCase();
  const isFry = FRY_KEYWORDS.some((k) => methodLower.includes(k));
  if (method) {
    assumptions.push(`Cooking method assumed: "${method}";`);
  }

  // Cooking-oil handling (explicit parameter only — never silently guessed).
  if (isFry) {
    if (oilGrams > 0) {
      const oilKcal = (oilGrams / 100) * OIL_KCAL_PER_100G;
      const oilFatG = (oilGrams / 100) * 100;
      kcal += oilKcal;
      fatG += oilFatG;
      assumptions.push(
        `Added ${oilGrams} g absorbed cooking oil (~${Math.round(oilKcal)} kcal, ${OIL_KCAL_PER_100G} kcal/100 g);`,
      );
    } else {
      assumptions.push(
        'Fried dish with no quantified oil — range widened because absorbed oil is unknown;',
      );
    }
  } else if (oilGrams > 0) {
    const oilKcal = (oilGrams / 100) * OIL_KCAL_PER_100G;
    kcal += oilKcal;
    fatG += oilGrams;
    assumptions.push(`Added ${oilGrams} g cooking oil (~${Math.round(oilKcal)} kcal);`);
  }

  assumptions.push(
    'Sauces, garnishes, and seasoning not itemized; treat as an estimate, not a label value.',
  );

  // Range width: baseline ±15%; widen to ±20% for fried-without-oil and when
  // the portion had to be scaled by more than 50%.
  let spread = 0.15;
  const scaledHeavily =
    listedGrams > 0 &&
    Number.isFinite(portionGrams) &&
    portionGrams > 0 &&
    Math.abs(portionGrams / listedGrams - 1) > 0.5;
  if (isFry && oilGrams === 0) spread = 0.2;
  if (scaledHeavily) spread = Math.max(spread, 0.2);

  const kcalBest = round1(kcal);
  return {
    kcalLow: round1(kcal * (1 - spread)),
    kcalBest,
    kcalHigh: round1(kcal * (1 + spread)),
    proteinG: round1(proteinG),
    carbsG: round1(carbsG),
    fatG: round1(fatG),
    fiberG: round1(fiberG),
    assumptions,
    complete,
    problems,
    fields,
  };
}
