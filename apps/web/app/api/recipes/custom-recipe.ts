/**
 * Shared custom-recipe helpers (NOT a route): resolve ingredient rows to
 * per-100-g nutrient values and compute totals. Used by POST and PATCH.
 */
import { prisma } from '@fitfusion/db';
import {
  computeRecipeNutrition,
  type RecipeIngredientInput,
  type RecipeNutritionResult,
} from '@fitfusion/core';
import type { CustomRecipeIngredientInput } from '@fitfusion/core';

/**
 * Resolve ingredient rows: rows with `foodId` get per-100-g nutrients derived
 * from the catalogue food (server-trusted); rows with explicit values use
 * those; name-only rows (salt, water, spices) contribute 0 — the server
 * never invents nutrition.
 */
export async function resolveIngredientRows(
  ingredients: CustomRecipeIngredientInput[],
): Promise<{ rows: RecipeIngredientInput[]; missingFood?: string }> {
  const rows: RecipeIngredientInput[] = [];
  for (const ing of ingredients) {
    if (ing.foodId) {
      const food = await prisma.food.findUnique({ where: { id: ing.foodId } });
      if (!food) return { rows, missingFood: ing.name };
      const factor = food.servingSize > 0 ? 100 / food.servingSize : 0;
      rows.push({
        name: ing.name.trim() || food.name,
        grams: ing.grams,
        kcal: food.kcal * factor,
        proteinG: food.proteinG * factor,
        carbsG: food.carbsG * factor,
        fatG: food.fatG * factor,
        fiberG: food.fiberG * factor,
      });
    } else {
      rows.push({
        name: ing.name,
        grams: ing.grams,
        kcal: ing.kcal ?? 0,
        proteinG: ing.proteinG ?? 0,
        carbsG: ing.carbsG ?? 0,
        fatG: ing.fatG ?? 0,
        fiberG: ing.fiberG ?? 0,
      });
    }
  }
  return { rows };
}

export function recipeNutrition(
  rows: RecipeIngredientInput[],
  portions: number,
): RecipeNutritionResult {
  return computeRecipeNutrition(rows, portions);
}

/** Normalize client instructions (string[]) into the stored [{step,text}] shape. */
export function toInstructionSteps(instructions?: string[]) {
  return (instructions ?? []).map((text, i) => ({ step: i + 1, text }));
}
