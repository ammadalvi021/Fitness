/**
 * Recipe serving math — single source of truth for the recipe detail page.
 *
 * SERVING CONTRACT (v21.2):
 * - `kcalPerServing` / `proteinPerServing` / `carbsPerServing` /
 *   `fatPerServing` / `fiberPerServing` are nutrients for ONE recipe portion.
 *   Nutrition for N servings = per-serving nutrition × N. Never multiply or
 *   divide an already-per-serving value by the yield factor again.
 * - Ingredient `grams` are stored for the ORIGINAL recipe yield; displayed
 *   quantities scale by (selectedYield / originalYield) — the yield factor is
 *   for ingredient quantities ONLY, never for nutrients.
 * - Diary logging uses a "servings eaten" count (default 1). Stored diary
 *   totals must equal servingsEaten × per-serving.
 *
 * Pure functions (no DOM, no network) so the contract is unit-testable.
 */

export interface ServingNutrients {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

export interface RecipeIngredientQty {
  name: string;
  quantity: string;
  grams?: number;
}

/** Smallest selectable serving step on the recipe page. */
export const MIN_SERVINGS = 0.25;

/** Round to 1 decimal place, matching the page's round1 helper. */
export function round1dp(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Clamp a user-entered serving count. Non-finite input falls back to 1
 * (same as the page's `num(value, 1)`), everything else floors at 0.25.
 */
export function clampServings(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(MIN_SERVINGS, n);
}

/**
 * Yield factor for INGREDIENT QUANTITIES only:
 * (selectedYield / originalYield). Applying this to nutrients is the
 * double-scaling bug — nutrients use nutritionForServings instead.
 */
export function yieldFactor(selectedYield: number, originalYield: number): number {
  return clampServings(selectedYield) / Math.max(MIN_SERVINGS, originalYield);
}

/**
 * Nutrition totals for N selected servings: per-serving × N.
 * The per-serving values are NEVER divided by the recipe yield here.
 */
export function nutritionForServings(
  perServing: ServingNutrients,
  servings: number,
): ServingNutrients {
  const n = clampServings(servings);
  return {
    kcal: round1dp(perServing.kcal * n),
    proteinG: round1dp(perServing.proteinG * n),
    carbsG: round1dp(perServing.carbsG * n),
    fatG: round1dp(perServing.fatG * n),
    fiberG: round1dp(perServing.fiberG * n),
  };
}

/** Scale one ingredient's gram quantity by the yield factor (display only). */
export function scaleIngredientGrams(grams: number, factor: number): number {
  return Math.round(grams * factor);
}

/**
 * Per-serving nutrients straight from a stored Recipe row (the values the
 * server recalculates diary/PATCH totals from — the authoritative contract
 * above, never client-supplied totals).
 */
export function perServingFromRecipe(recipe: {
  kcalPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  fiberPerServing: number;
}): ServingNutrients {
  return {
    kcal: recipe.kcalPerServing,
    proteinG: recipe.proteinPerServing,
    carbsG: recipe.carbsPerServing,
    fatG: recipe.fatPerServing,
    fiberG: recipe.fiberPerServing,
  };
}

export interface RecipeDiaryInput {
  recipeId: string;
  title: string;
  /** Servings actually eaten — defaults to 1 on the page, never the whole batch. */
  servingsEaten: number;
  perServing: ServingNutrients;
  date: string; // YYYY-MM-DD
  mealType: string;
}

/**
 * Build the POST /api/diary body for a recipe log.
 *
 * FLAT shape: DiaryEntrySchema requires top-level `kcal` (a nested
 * `nutrients` object is stripped and the request 400s). `servings` is the
 * servings EATEN; totals = per-serving × servingsEaten. Since v21.4 the
 * server RESOLVES the recipeId and RECALCULATES these totals server-side
 * from the stored recipe (same formula, authoritative), so the emitted
 * totals are a preview only — client totals are never trusted on this path.
 */
export function buildRecipeDiaryPayload(input: RecipeDiaryInput): Record<string, unknown> {
  const servings = clampServings(input.servingsEaten);
  const totals = nutritionForServings(input.perServing, servings);
  return {
    date: input.date,
    mealType: input.mealType,
    recipeId: input.recipeId,
    customName: input.title,
    servings,
    kcal: totals.kcal,
    proteinG: totals.proteinG,
    carbsG: totals.carbsG,
    fatG: totals.fatG,
    fiberG: totals.fiberG,
    source: 'recipe',
  };
}

export interface PlanRecipeInput {
  id: string;
  title: string;
  /** Original recipe yield (what `servings` the ingredient grams are stored for). */
  servings: number;
  perServing: ServingNutrients;
  ingredients: RecipeIngredientQty[];
  prepMin: number;
  cookMin: number;
  instructions: string[];
  tags: string[];
  cuisine?: string | null;
  dietCategory?: string | null;
  imageUrl?: string | null;
}

/**
 * Build the meal-plan addition object stored in localStorage by the recipe
 * page. Contract (matches the plans page normalizer):
 * - `nutrients` is per 1 serving;
 * - `scaledNutrients` = per-serving × servings (never × servings/yield);
 * - ingredient grams are scaled to the selected yield for consistency with
 *   the recipe page's shopping list (household `quantity` strings are
 *   free-text and stay as stored).
 */
export function buildPlanMealAddition(
  recipe: PlanRecipeInput,
  selectedServings: number,
  mealType: string,
): Record<string, unknown> {
  const s = clampServings(selectedServings);
  const factor = yieldFactor(s, recipe.servings);
  return {
    id: `recipe-${recipe.id}`,
    name: recipe.title,
    mealType,
    ingredients: recipe.ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      grams: i.grams != null ? scaleIngredientGrams(i.grams, factor) : undefined,
    })),
    nutrients: { ...recipe.perServing }, // per 1 serving (contract)
    servings: s,
    scaledNutrients: nutritionForServings(recipe.perServing, s),
    prepMin: recipe.prepMin,
    cookMin: recipe.cookMin,
    instructions: recipe.instructions,
    tags: recipe.tags,
    cuisine: recipe.cuisine ?? undefined,
    dietCategory: recipe.dietCategory ?? '',
    labels: recipe.tags,
    imageUrl: recipe.imageUrl ?? undefined,
  };
}
