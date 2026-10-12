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
 */

export interface EstimateIngredient {
  name: string;
  /** grams of this ingredient in the portion being estimated */
  grams: number;
  /** kcal per 100 g of the ingredient (as prepared / raw, noted in assumptions) */
  kcalPer100g: number;
  proteinPer100g?: number;
  carbsPer100g?: number;
  fatPer100g?: number;
  fiberPer100g?: number;
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

export interface RecipeEstimate {
  kcalLow: number;
  kcalBest: number;
  kcalHigh: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  assumptions: string[];
}

/** Cooking oil: ~884 kcal / 100 g. */
const OIL_KCAL_PER_100G = 884;

const FRY_KEYWORDS = ['fry', 'fried', 'deep-fry', 'deep fry', 'saut', 'wok', 'karahi', 'tarka'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function estimateFromRecipe(input: RecipeEstimateInput): RecipeEstimate {
  const ingredients = (input.ingredients ?? []).filter(
    (i) => i && Number.isFinite(i.grams) && i.grams > 0 && Number.isFinite(i.kcalPer100g),
  );
  const method = (input.cookingMethod ?? '').trim();
  const oilGrams = Number.isFinite(input.oilGrams) && (input.oilGrams as number) > 0
    ? (input.oilGrams as number)
    : 0;

  const assumptions: string[] = [];

  // Base sums from the ingredient list.
  let kcal = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  let fiberG = 0;
  let listedGrams = 0;
  for (const i of ingredients) {
    const f = i.grams / 100;
    kcal += f * i.kcalPer100g;
    proteinG += f * (i.proteinPer100g ?? 0);
    carbsG += f * (i.carbsPer100g ?? 0);
    fatG += f * (i.fatPer100g ?? 0);
    fiberG += f * (i.fiberPer100g ?? 0);
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
  };
}
