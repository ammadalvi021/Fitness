/**
 * Recipe-import SHARED helpers — client-safe.
 *
 * Pure functions and types used by the /recipes/import review UI and the
 * review→save payload builder. This module MUST stay free of node:* imports
 * and server-only packages (@fitfusion/ai reads AI_API_KEY) so the client
 * component can bundle it.
 */
export interface ImportedRecipeIngredient {
  name: string;
  /** Numeric amount as stated on the page; null when the page gives none. */
  quantity: number | null;
  /** Unit as stated on the page; null when none. */
  unit: string | null;
}

export interface ImportedRecipe {
  title: string;
  ingredients: ImportedRecipeIngredient[];
  servings: number;
  instructions: string[];
  sourceUrl: string;
}

/**
 * Approximate unit → gram multipliers used ONLY to prefill the review
 * screen's grams field (the user edits before saving). Clearly
 * approximate — never treated as verified nutrition.
 */
export const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  mg: 0.001,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  pound: 453.6,
  pounds: 453.6,
  ml: 1,
  milliliter: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  cup: 240,
  cups: 240,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  pinch: 0.5,
  dash: 0.6,
  clove: 5,
  cloves: 5,
  slice: 30,
  slices: 30,
  piece: 50,
  pieces: 50,
  can: 400,
  cans: 400,
};

/** Guess grams from an imported quantity+unit; null when not parseable. */
export function guessGrams(
  quantity: number | null,
  unit: string | null,
): number | null {
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const u = (unit ?? '').trim().toLowerCase();
  if (!u) return null;
  const factor = UNIT_TO_GRAMS[u];
  if (factor === undefined) return null;
  return Math.round(quantity * factor * 10) / 10;
}

export interface ImportReviewIngredient {
  name: string;
  quantity: string;
  unit: string;
  grams: string;
}

export interface ImportReviewState {
  title: string;
  servings: string;
  ingredients: ImportReviewIngredient[];
  instructions: string;
  dietCategory: 'vegetarian' | 'non_vegetarian';
}

/** Turn an imported recipe into the editable review state (grams prefilled). */
export function recipeToReview(recipe: ImportedRecipe): ImportReviewState {
  return {
    title: recipe.title,
    servings: String(recipe.servings),
    ingredients: recipe.ingredients.map((i) => {
      const g = guessGrams(i.quantity, i.unit);
      return {
        name: i.name,
        quantity: i.quantity !== null ? String(i.quantity) : '',
        unit: i.unit ?? '',
        grams: g !== null ? String(g) : '',
      };
    }),
    instructions: recipe.instructions.join('\n'),
    dietCategory: 'vegetarian',
  };
}

/**
 * Validate the review state; returns a friendly error or null when OK.
 */
export function validateReview(review: ImportReviewState): string | null {
  if (!review.title.trim()) return 'Give your recipe a title.';
  const complete = review.ingredients.filter(
    (r) => r.name.trim() && Number(r.grams) > 0,
  );
  if (complete.length === 0) {
    return 'Add grams for at least one ingredient before saving.';
  }
  const portions = Math.floor(Number(review.servings) || 0);
  if (portions < 1 || portions > 100) {
    return 'Servings must be between 1 and 100.';
  }
  return null;
}

/**
 * Build the POST /api/recipes payload from the reviewed state. Goes through
 * the EXISTING custom-recipe save path, so server-side nutrition math
 * (water = 0 kcal, per-portion from ingredients × grams) stays consistent.
 * Incomplete rows (no name or no grams) are dropped; user edits are
 * preserved verbatim.
 */
export function buildCustomRecipePayload(review: ImportReviewState): {
  name: string;
  ingredients: Array<{ name: string; grams: number }>;
  portions: number;
  instructions: string[];
  dietCategory: 'vegetarian' | 'non_vegetarian';
} {
  const ingredients = review.ingredients
    .filter((r) => r.name.trim() && Number(r.grams) > 0)
    .map((r) => ({ name: r.name.trim(), grams: Number(r.grams) }));
  const instructions = review.instructions
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const portions = Math.max(
    1,
    Math.min(100, Math.floor(Number(review.servings) || 1)),
  );
  return {
    name: review.title.trim(),
    ingredients,
    portions,
    instructions,
    dietCategory: review.dietCategory,
  };
}
