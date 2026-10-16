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
  type DietScreenRow,
  type RecipeIngredientInput,
  type RecipeNutritionResult,
} from '@fitfusion/core';
import type { CustomRecipeIngredientInput } from '@fitfusion/core';

/** Nutrition resolution status stored alongside each resolved row. */
export type RowNutritionStatus = 'ok' | 'unknown' | 'incomplete';

/**
 * V21.5 (P3): where a resolved row came from — drives the vegetarian
 * diet-conflict screener (packages/core/src/diet-conflicts.ts).
 * 'catalogue' = trusted foodId lookup; 'known_zero' = explicit zero list;
 * 'declared' = user-declared nutrients; 'free_text' = unclassified free text.
 */
export type RowSource = 'catalogue' | 'known_zero' | 'declared' | 'free_text';

export interface ResolvedRow extends RecipeIngredientInput {
  nutritionStatus: RowNutritionStatus;
  note?: string;
  /**
   * V21.5 (P2): the CANONICAL catalogue name (`Food.name` when the row is
   * linked to a catalogue food; the declared name otherwise). The client
   * may supply any display `name` ("nutty spread"), but allergen screening
   * must never see the display alias as the truth — it sees this.
   */
  canonicalName: string;
  /**
   * V21.6: the catalogue food ID the row was resolved from (`ing.foodId`),
   * persisted into the stored JSON so the content hash carries stable
   * identity. Null for non-foodId rows (known_zero / declared / free_text).
   * Pre-v21.6 rows lack this field — the hash falls back to the normalized
   * display name for them.
   */
  foodId?: string | null;
  /** V21.5 (P2): the food's persisted aliases (FoodAlias), when foodId-linked. */
  aliases: string[];
  /**
   * V21.5 (P3): trusted Food.category name for foodId rows (e.g.
   * 'Chicken, Meat & Fish'). Null when unknown — never invented.
   */
  foodCategoryName?: string | null;
  /** V21.5 (P3): resolution source driving the diet-conflict screener. */
  rowSource?: RowSource;
}

/**
 * Minimal shape of a STORED ingredient row, parsed back from the
 * `Recipe.ingredients` JSON column. Pre-v21.5 rows carry only `name` (the
 * v21.4 display name); v21.5+ rows also carry `canonicalName` (+ `aliases`);
 * v21.6+ rows also carry `foodId`.
 */
export interface StoredIngredientRow {
  name: string;
  foodId?: string | null;
  canonicalName?: string | null;
  aliases?: string[] | null;
  /**
   * V21.5 (P3): trusted Food.category name / resolution source, persisted
   * inside the stored JSON by resolveIngredientRows. Absent on pre-v21.5
   * rows — the diet screener then falls back to the display name with no
   * trusted source (conservative).
   */
  foodCategoryName?: string | null;
  rowSource?: RowSource;
}

/**
 * V21.5 (P2): the names the allergen screener sees for one freshly resolved
 * row. foodId-linked rows screen the CANONICAL catalogue name + the food's
 * persisted aliases — the client-supplied display name is deliberately
 * excluded so renaming "Peanut Butter" to "nutty spread" cannot hide the
 * peanut. Free-text rows (no foodId) screen their declared name, the only
 * name available. NEVER a certified analysis — see ALLERGEN_CAVEAT.
 */
export function ingredientAllergenScreenNames(row: ResolvedRow): string[] {
  return [row.canonicalName, ...row.aliases];
}

/**
 * V21.5 (P2): the names the allergen screener sees for one STORED row.
 * Rows stored by v21.5+ screen their canonical name + aliases; legacy
 * rows (no canonicalName) fall back to the stored display name — the same
 * v21.4 semantics, upgraded to canonical screening on the next material
 * edit (P1 recheck).
 */
export function storedRowAllergenScreenNames(row: StoredIngredientRow): string[] {
  if (row.canonicalName) return [row.canonicalName, ...(row.aliases ?? [])];
  return [row.name];
}

/**
 * V21.5 (P2): the identity key a recheck decision compares per stored row —
 * the canonical name when we have one, else the stored display name. Using
 * the canonical key means a display-name-only rename does NOT count as a
 * material change (screening would return the identical canonical-based
 * result); it also means a v21.4 row whose display name hid an allergen
 * ("nutty spread") DOES trigger a recheck on its next ingredients edit,
 * because the canonical "Peanut Butter" differs from the stored display
 * name.
 */
export function storedRowAllergenKey(row: StoredIngredientRow): string {
  return (row.canonicalName ?? '').trim() || row.name;
}

/**
 * V21.5 (P3): build the diet-conflict screen input for resolved or stored
 * rows — `canonicalName ?? name` (P2's convention), the trusted food
 * category (foodId rows only), and the resolution source. Works for fresh
 * ResolvedRows and for StoredIngredientRows parsed back from the JSON
 * column; pre-v21.5 rows screen on the display name with no trusted
 * source (conservative: unfamiliar is never assumed vegetarian).
 */
export function toDietScreenRows(
  rows: Array<StoredIngredientRow> | null | undefined,
): DietScreenRow[] {
  return (rows ?? []).map((r) => ({
    name: r.name,
    canonicalName: r.canonicalName ?? null,
    foodCategoryName: r.foodCategoryName ?? null,
    catalogueMatch: r.rowSource === 'catalogue',
    knownZero: r.rowSource === 'known_zero',
  }));
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
      // V21.5 (P2): pull the food's persisted aliases too — screening runs
      // on canonicalName + aliases, never on the client display name.
      // V21.5 (P3): also pull the trusted Food.category name — the diet
      // screener treats an exact 'Chicken, Meat & Fish' as a meat signal.
      const food = await prisma.food.findUnique({
        where: { id: ing.foodId },
        include: {
          aliases: { select: { alias: true } },
          category: { select: { name: true } },
        },
      });
      if (!food) return { rows, missingFood: ing.name, warnings, nutritionIncomplete };
      const canonicalName = food.name;
      const aliases = (food.aliases ?? []).map((a) => a.alias);
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
          foodId: ing.foodId,
          canonicalName,
          aliases,
          foodCategoryName: food.category?.name ?? null,
          rowSource: 'catalogue',
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
        foodId: ing.foodId,
        canonicalName,
        aliases,
        foodCategoryName: food.category?.name ?? null,
        rowSource: 'catalogue',
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
          foodId: null,
          canonicalName: ing.name,
          aliases: [],
          foodCategoryName: null,
          rowSource: 'free_text',
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
          foodId: null,
          canonicalName: ing.name,
          aliases: [],
          foodCategoryName: null,
          rowSource: status === 'known_zero' ? 'known_zero' : 'declared',
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
