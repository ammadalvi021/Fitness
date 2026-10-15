/**
 * v21.2 regression: recipe serving scaling (Worker B).
 *
 * Defect: the recipe detail page computed `factor = selectedServings /
 * recipe.servings` and multiplied the ALREADY-PER-SERVING nutrient values by
 * it — double scaling. The same bad math shipped in diary logging and
 * meal-plan additions, and the diary payload was additionally nested (so it
 * 400d against DiaryEntrySchema).
 *
 * Contract under test (apps/web/lib/recipe-servings.ts):
 * - kcalPerServing / macros are for ONE portion; nutrition for N servings =
 *   per-serving × N, never × (N / yield) again.
 * - Ingredient grams are stored for the ORIGINAL yield; displayed quantities
 *   scale by (selectedYield / originalYield).
 * - Diary payload: flat shape, servings = servings eaten (default 1),
 *   totals = per-serving × servings eaten.
 *
 * Fixture: the real seeded 'Peshawari Chicken Karahi' — 4 portions,
 * perServing { kcal: 390.7, proteinG: 37.5, carbsG: 8.1, fatG: 22.2,
 * fiberG: 1.9 }, chicken thigh 800 g for the original yield.
 */
import { describe, expect, it } from 'vitest';
import { DiaryEntrySchema } from '@fitfusion/core';
import {
  buildPlanMealAddition,
  buildRecipeDiaryPayload,
  clampServings,
  nutritionForServings,
  perServingFromRecipe,
  scaleIngredientGrams,
  yieldFactor,
  type PlanRecipeInput,
} from '../../lib/recipe-servings';

const PER_SERVING = { kcal: 390.7, proteinG: 37.5, carbsG: 8.1, fatG: 22.2, fiberG: 1.9 };
const ORIGINAL_YIELD = 4;
const CHICKEN_GRAMS = 800; // for the original 4-portion yield

function karahi(): PlanRecipeInput {
  return {
    id: 'r-karahi',
    title: 'Peshawari Chicken Karahi',
    servings: ORIGINAL_YIELD,
    perServing: { ...PER_SERVING },
    ingredients: [
      { name: 'Chicken thigh (raw)', quantity: '800 g', grams: 800 },
      { name: 'Tomato', quantity: '5 medium', grams: 500 },
      { name: 'Ghee', quantity: '2 tbsp', grams: 30 },
    ],
    prepMin: 15,
    cookMin: 30,
    instructions: ['Cook it.'],
    tags: ['high-protein'],
    cuisine: 'Pakistani',
    dietCategory: 'non_vegetarian',
    imageUrl: null,
  };
}

describe('nutritionForServings — per-serving × N, never × N/yield', () => {
  it('1 serving returns the per-serving values unchanged', () => {
    expect(nutritionForServings(PER_SERVING, 1)).toEqual(PER_SERVING);
  });

  it('2 servings doubles every nutrient', () => {
    expect(nutritionForServings(PER_SERVING, 2)).toEqual({
      kcal: 781.4,
      proteinG: 75,
      carbsG: 16.2,
      fatG: 44.4,
      fiberG: 3.8,
    });
  });

  it('4 servings (full batch) quadruples — NOT the per-serving values', () => {
    const totals = nutritionForServings(PER_SERVING, 4);
    expect(totals).toEqual({
      kcal: 1562.8,
      proteinG: 150,
      carbsG: 32.4,
      fatG: 88.8,
      fiberG: 7.6,
    });
    // The old bug showed 390.7 kcal for the whole 4-portion batch here.
    expect(totals.kcal).not.toBe(PER_SERVING.kcal);
  });

  it('clamps sub-minimum servings to 0.25', () => {
    expect(nutritionForServings(PER_SERVING, 0).kcal).toBe(97.7);
  });
});

describe('yieldFactor + scaleIngredientGrams — ingredients scale by selectedYield/originalYield', () => {
  it.each([
    { selected: 1, factor: 0.25, chicken: 200 },
    { selected: 2, factor: 0.5, chicken: 400 },
    { selected: 4, factor: 1, chicken: 800 },
  ])('selecting $selected servings of a 4-portion recipe', ({ selected, factor, chicken }) => {
    expect(yieldFactor(selected, ORIGINAL_YIELD)).toBe(factor);
    expect(scaleIngredientGrams(CHICKEN_GRAMS, factor)).toBe(chicken);
  });

  it('never touches nutrient math (factor is not applied to per-serving values)', () => {
    const f = yieldFactor(2, ORIGINAL_YIELD);
    // Deliberately assert the WRONG (old) formula differs from the right one:
    // perServing × factor is the double-scaling bug; per-serving × N is correct.
    expect(PER_SERVING.kcal * f).toBe(195.35);
    expect(nutritionForServings(PER_SERVING, 2).kcal).toBe(781.4);
  });
});

describe('buildRecipeDiaryPayload — servings eaten (default 1), flat, totals = displayed', () => {
  const base = {
    recipeId: 'r-karahi',
    title: 'Peshawari Chicken Karahi',
    perServing: PER_SERVING,
    date: '2026-10-13',
    mealType: 'dinner',
  };

  it('defaults concept: 1 serving eaten logs exactly the per-serving values', () => {
    const payload = buildRecipeDiaryPayload({ ...base, servingsEaten: 1 });
    expect(payload).toMatchObject({
      servings: 1,
      kcal: 390.7,
      proteinG: 37.5,
      carbsG: 8.1,
      fatG: 22.2,
      fiberG: 1.9,
      customName: 'Peshawari Chicken Karahi',
      source: 'recipe',
    });
  });

  it('2 servings eaten doubles the totals', () => {
    const payload = buildRecipeDiaryPayload({ ...base, servingsEaten: 2 });
    expect(payload).toMatchObject({ servings: 2, kcal: 781.4, proteinG: 75 });
  });

  it('emits the FLAT DiaryEntrySchema shape (nested `nutrients` 400s)', () => {
    const payload = buildRecipeDiaryPayload({ ...base, servingsEaten: 1 });
    expect(payload).not.toHaveProperty('nutrients');
    expect(payload).toHaveProperty('kcal');
    expect(DiaryEntrySchema.safeParse(payload).success).toBe(true);
  });

  it('stored totals equal the displayed serving totals', () => {
    for (const eaten of [1, 2, 4]) {
      const payload = buildRecipeDiaryPayload({ ...base, servingsEaten: eaten });
      const displayed = nutritionForServings(PER_SERVING, eaten);
      expect(payload.kcal).toBe(displayed.kcal);
      expect(payload.proteinG).toBe(displayed.proteinG);
      expect(payload.carbsG).toBe(displayed.carbsG);
      expect(payload.fatG).toBe(displayed.fatG);
      expect(payload.fiberG).toBe(displayed.fiberG);
    }
  });

  it('never logs the whole batch by default (4-portion recipe ≠ 4 servings)', () => {
    const payload = buildRecipeDiaryPayload({ ...base, servingsEaten: 1 });
    expect(payload.servings).toBe(1);
    expect(payload.kcal).toBe(390.7); // not 1562.8
  });
});

describe('buildPlanMealAddition — nutrients per 1 serving, scaledNutrients = × servings', () => {
  it('2 selected servings: scaledNutrients = 2 × per-serving (not × 2/4)', () => {
    const meal = buildPlanMealAddition(karahi(), 2, 'dinner');
    expect(meal.servings).toBe(2);
    // nutrients stays per 1 serving (plans-page contract)
    expect(meal.nutrients).toEqual(PER_SERVING);
    // scaledNutrients matches servings — the old bug produced 195.35 here
    expect(meal.scaledNutrients).toEqual({
      kcal: 781.4,
      proteinG: 75,
      carbsG: 16.2,
      fatG: 44.4,
      fiberG: 3.8,
    });
  });

  it('scales ingredient grams to the selected yield, keeps household strings', () => {
    const meal = buildPlanMealAddition(karahi(), 2, 'dinner') as {
      ingredients: { name: string; quantity: string; grams?: number }[];
    };
    const chicken = meal.ingredients.find((i) => i.name.startsWith('Chicken'))!;
    expect(chicken.grams).toBe(400); // 800 g × 2/4
    expect(chicken.quantity).toBe('800 g'); // free-text household string stays as stored
  });

  it('full yield: scaledNutrients = 4 × per-serving', () => {
    const meal = buildPlanMealAddition(karahi(), 4, 'dinner') as {
      scaledNutrients: { kcal: number };
    };
    expect(meal.scaledNutrients.kcal).toBe(1562.8);
  });
});

describe('clampServings', () => {
  it('floors at 0.25', () => {
    expect(clampServings(0)).toBe(0.25);
    expect(clampServings(-3)).toBe(0.25);
  });

  it('falls back to 1 for non-finite input', () => {
    expect(clampServings(NaN)).toBe(1);
    expect(clampServings(Infinity)).toBe(1);
  });

  it('passes valid counts through', () => {
    expect(clampServings(2.5)).toBe(2.5);
  });
});

/**
 * v21.4: perServingFromRecipe is what the diary API recalculates from —
 * the stored recipe's per-serving values mapped verbatim onto the
 * authoritative ServingNutrients contract (no yield division here).
 */
describe('perServingFromRecipe', () => {
  it('maps stored recipe per-serving fields onto the serving contract', () => {
    const per = perServingFromRecipe({
      kcalPerServing: 390.7,
      proteinPerServing: 37.5,
      carbsPerServing: 8.1,
      fatPerServing: 22.2,
      fiberPerServing: 1.9,
    });
    expect(per).toEqual({ kcal: 390.7, proteinG: 37.5, carbsG: 8.1, fatG: 22.2, fiberG: 1.9 });
    // The totals the API stores for 2 servings eaten:
    expect(nutritionForServings(per, 2)).toEqual({
      kcal: 781.4,
      proteinG: 75,
      carbsG: 16.2,
      fatG: 44.4,
      fiberG: 3.8,
    });
  });
});
