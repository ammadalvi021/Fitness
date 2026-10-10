import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_MEALS,
  MEAL_TYPE_ORDER,
  generateWeeklyPlan,
  regenerateMeal,
  scaleMealServings,
  swapMealsBetweenDays,
} from './plans.js';
import { sumNutrients } from './nutrition.js';

const TARGET = 2200;

function filteredPlan() {
  return generateWeeklyPlan({
    meals: DEFAULT_TEMPLATE_MEALS,
    calorieTarget: TARGET,
    dietPreference: 'vegetarian',
    allergies: ['peanut'],
    dislikedIngredients: ['salmon'],
    seed: 7,
  });
}

describe('DEFAULT_TEMPLATE_MEALS', () => {
  it('has ~24 meals covering all 6 meal types', () => {
    expect(DEFAULT_TEMPLATE_MEALS.length).toBeGreaterThanOrEqual(20);
    const types = new Set(DEFAULT_TEMPLATE_MEALS.map((m) => m.mealType));
    expect([...types].sort()).toEqual([...MEAL_TYPE_ORDER].sort());
    for (const t of MEAL_TYPE_ORDER) {
      expect(
        DEFAULT_TEMPLATE_MEALS.filter((m) => m.mealType === t).length,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('has valid nutrients and labels on every meal', () => {
    for (const m of DEFAULT_TEMPLATE_MEALS) {
      expect(m.nutrients.kcal).toBeGreaterThan(0);
      expect(m.ingredients.length).toBeGreaterThan(0);
      expect(['vegetarian', 'non_vegetarian']).toContain(m.dietCategory);
    }
  });
});

describe('generateWeeklyPlan', () => {
  it('is deterministic: same seed -> identical plan', () => {
    const opts = {
      meals: DEFAULT_TEMPLATE_MEALS,
      calorieTarget: TARGET,
      dietPreference: 'flexible' as const,
      seed: 123,
    };
    const a = generateWeeklyPlan(opts);
    const b = generateWeeklyPlan(opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is deterministic with the default seed', () => {
    const a = generateWeeklyPlan({ meals: DEFAULT_TEMPLATE_MEALS, calorieTarget: TARGET });
    const b = generateWeeklyPlan({ meals: DEFAULT_TEMPLATE_MEALS, calorieTarget: TARGET });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces 7 days', () => {
    const plan = filteredPlan();
    expect(plan).toHaveLength(7);
    expect(plan.map((d) => d.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('never includes diet-violating, allergen, or disliked meals', () => {
    const plan = filteredPlan();
    for (const day of plan) {
      for (const meal of day.meals) {
        const template = DEFAULT_TEMPLATE_MEALS.find((t) => t.id === meal.templateId);
        expect(template).toBeDefined();
        expect(template!.dietCategory).toBe('vegetarian');
        const names = template!.ingredients.map((i) => i.name.toLowerCase());
        expect(names.some((n) => n.includes('peanut'))).toBe(false);
        expect(names.some((n) => n.includes('salmon'))).toBe(false);
      }
    }
  });

  it('lands each day within ~15% of the calorie target', () => {
    const plan = filteredPlan();
    for (const day of plan) {
      const diff = Math.abs(day.totals.kcal - TARGET) / TARGET;
      expect(diff).toBeLessThanOrEqual(0.15);
    }
  });

  it('day totals match the sum of scaled meals', () => {
    const plan = filteredPlan();
    for (const day of plan) {
      const sum = sumNutrients(day.meals.map((m) => m.nutrients));
      expect(day.totals.kcal).toBeCloseTo(sum.kcal, 1);
      expect(day.totals.proteinG).toBeCloseTo(sum.proteinG, 1);
      expect(day.totals.carbsG).toBeCloseTo(sum.carbsG, 1);
      expect(day.totals.fatG).toBeCloseTo(sum.fatG, 1);
      expect(day.totals.fiberG).toBeCloseTo(sum.fiberG, 1);
    }
  });
});

describe('regenerateMeal', () => {
  it('replaces the meal with a different template and re-scales the day', () => {
    const plan = filteredPlan();
    const day = plan[0];
    const before = day.meals.find((m) => m.mealType === 'lunch')!;
    const next = regenerateMeal(day, 0, 'lunch', DEFAULT_TEMPLATE_MEALS, TARGET);
    const after = next.meals.find((m) => m.mealType === 'lunch')!;
    expect(after.templateId).not.toBe(before.templateId);
    expect(after.mealType).toBe('lunch');
    const diff = Math.abs(next.totals.kcal - TARGET) / TARGET;
    expect(diff).toBeLessThanOrEqual(0.15);
    // input not mutated
    expect(day.meals.find((m) => m.mealType === 'lunch')!.templateId).toBe(
      before.templateId,
    );
  });
});

describe('swapMealsBetweenDays', () => {
  it('swaps two meals and recomputes totals without mutating input', () => {
    const plan = filteredPlan();
    const aId = plan[0].meals[0].templateId;
    const bId = plan[1].meals[1].templateId;
    const next = swapMealsBetweenDays(plan, 0, 0, 1, 1);
    expect(next[0].meals[0].templateId).toBe(bId);
    expect(next[1].meals[1].templateId).toBe(aId);
    expect(plan[0].meals[0].templateId).toBe(aId);
    for (const d of [next[0], next[1]]) {
      const sum = sumNutrients(d.meals.map((m) => m.nutrients));
      expect(d.totals.kcal).toBeCloseTo(sum.kcal, 1);
    }
  });

  it('throws on out-of-range indices', () => {
    const plan = filteredPlan();
    expect(() => swapMealsBetweenDays(plan, 0, 99, 1, 0)).toThrow(RangeError);
  });
});

describe('scaleMealServings', () => {
  it('scales nutrients and ingredient grams proportionally', () => {
    const plan = filteredPlan();
    const meal = plan[0].meals[0];
    const doubled = scaleMealServings(meal, meal.servings * 2);
    expect(doubled.servings).toBeCloseTo(meal.servings * 2, 10);
    expect(doubled.nutrients.kcal).toBeCloseTo(meal.nutrients.kcal * 2, 6);
    expect(doubled.ingredients[0].grams).toBeCloseTo(
      meal.ingredients[0].grams * 2,
      6,
    );
    expect(doubled.templateId).toBe(meal.templateId);
  });

  it('throws on non-positive servings', () => {
    const plan = filteredPlan();
    expect(() => scaleMealServings(plan[0].meals[0], 0)).toThrow(RangeError);
  });
});
