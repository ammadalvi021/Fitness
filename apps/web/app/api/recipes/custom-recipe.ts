/**
 * Shared custom-recipe helpers (NOT a route): resolve ingredient rows to
 * per-100-g nutrient values and compute totals. Used by POST and PATCH.
 *
 * P1 (v21.2): per-100-g conversion uses the canonical serving weight
 *   (Food.servingWeightG → servingUnit gram annotation → mass/volume
 *   normalization — packages/core/src/serving-weight.ts). The old
 *   `100 / food.servingSize` broke for count servings (chapati) and volume
 *   servings (milk). When the serving weight is unknown the row's nutrition
 *   is marked INCOMPLETE (never guessed) and the recipe needsReview.
 * P4 (v21.2): rows without a trusted foodId are classified by
 *   packages/core/src/custom-ingredients.ts — known-zero (water, salt,
 *   explicit spice list), declared (all 5 nutrients + basis, validated by
 *   zod), or unknown (flagged "nutrition unknown", forces needsReview).
 */
import { prisma } from '@fitfusion/db';
import {
  classifyCustomIngredient,
  per100gFactor,
  computeRecipeNutrition,
  type RecipeIngredientInput,
  type RecipeNutritionResult,
} from '@fitfusion/core';
import type { CustomRecipeIngredientInput } from '@fitfusion/core';

/** Nutrition resolution status stored alongside each resolved row. */
export type RowNutritionStatus = 'ok' | 'unknown' | 'incomplete';

export interface ResolvedRow extends RecipeIngredientInput {
  nutritionStatus: RowNutritionStatus;
  note?: string;
}

export interface ResolvedIngredients {
  rows: ResolvedRow[];
  missingFood?: string;
  /** Surfaced warnings — the route returns these to the client. */
  warnings: string[];
  /** True when any row is unknown/incomplete → recipe needsReview. */
  nutritionIncomplete: boolean;
}

export async function resolveIngredientRows(
  ingredients: CustomRecipeIngredientInput[],
): Promise<ResolvedIngredients> {
  const rows: ResolvedRow[] = [];
  const warnings: string[] = [];
  let nutritionIncomplete = false;

  for (const ing of ingredients) {
    if (ing.foodId) {
      const food = await prisma.food.findUnique({ where: { id: ing.foodId } });
      if (!food) return { rows, missingFood: ing.name, warnings, nutritionIncomplete };
      // P1: canonical serving weight — never `100 / servingSize` blindly.
      const { factor, detail, warning } = per100gFactor({
        name: food.name,
        servingSize: food.servingSize,
        servingUnit: food.servingUnit,
        servingWeightG: food.servingWeightG ?? null,
      });
      if (factor == null) {
        // Serving weight unknown/ambiguous: INCOMPLETE, never guessed.
        nutritionIncomplete = true;
        const msg = warning ?? `${food.name}: serving weight unknown — nutrition incomplete.`;
        warnings.push(msg);
        rows.push({
          name: ing.name.trim() || food.name,
          grams: ing.grams,
          kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
          nutritionStatus: 'incomplete',
          note: msg,
        });
        continue;
      }
      if (warning) warnings.push(warning);
      rows.push({
        name: ing.name.trim() || food.name,
        grams: ing.grams,
        kcal: food.kcal * factor,
        proteinG: food.proteinG * factor,
        carbsG: food.carbsG * factor,
        fatG: food.fatG * factor,
        fiberG: food.fiberG * factor,
        nutritionStatus: 'ok',
        note: detail,
      });
    } else {
      // P4: classify the non-foodId row — never silently zero it.
      const { status, warnings: cw } = classifyCustomIngredient(ing.name, {
        kcal: ing.kcal,
        proteinG: ing.proteinG,
        carbsG: ing.carbsG,
        fatG: ing.fatG,
        fiberG: ing.fiberG,
        basis: ing.basis,
      });
      if (status === 'unknown') {
        nutritionIncomplete = true;
        warnings.push(...cw);
        rows.push({
          name: ing.name,
          grams: ing.grams,
          kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
          nutritionStatus: 'unknown',
          note: `"${ing.name}": nutrition unknown — no catalogue food and no declared nutrients (basis ${ing.basis ?? 'none'}).`,
        });
      } else {
        // known_zero → zeros; declared → the declared per-100-g values
        // (zod guarantees all five + basis when any are present).
        warnings.push(...cw);
        rows.push({
          name: ing.name,
          grams: ing.grams,
          kcal: status === 'known_zero' ? 0 : (ing.kcal ?? 0),
          proteinG: status === 'known_zero' ? 0 : (ing.proteinG ?? 0),
          carbsG: status === 'known_zero' ? 0 : (ing.carbsG ?? 0),
          fatG: status === 'known_zero' ? 0 : (ing.fatG ?? 0),
          fiberG: status === 'known_zero' ? 0 : (ing.fiberG ?? 0),
          nutritionStatus: 'ok',
          note: status === 'known_zero'
            ? `"${ing.name}" is on the explicit known-zero list.`
            : `"${ing.name}": declared nutrients (basis: ${ing.basis}).`,
        });
      }
    }
  }
  return { rows, warnings, nutritionIncomplete };
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
