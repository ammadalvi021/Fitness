/**
 * Meal planning: template meals, deterministic weekly plan generation,
 * meal regeneration, swaps, and serving scaling. Pure functions, no I/O.
 *
 * Determinism: generateWeeklyPlan uses a seeded PRNG (mulberry32); the same
 * inputs + seed always produce the identical plan.
 */

import { mealContainsAllergen, validateMealAgainstProfile } from './allergy.js';
import { round1, roundNutrients, scaleNutrients, sumNutrients } from './nutrition.js';
import type { MealType, Nutrients } from './types.js';

export interface MealIngredient {
  /** Display name, e.g. "Rolled oats". */
  name: string;
  /** Human quantity for 1 serving, e.g. "1/2 cup". */
  quantity: string;
  /** Grams for 1 serving. */
  grams: number;
}

export interface TemplateMeal {
  id: string;
  name: string;
  mealType: MealType;
  /** Per 1 serving. */
  ingredients: MealIngredient[];
  /** Per 1 serving. */
  nutrients: Nutrients;
  prepMin: number;
  cookMin: number;
  instructions: string[];
  tags: string[];
  cuisine?: string;
  dietCategory: 'vegetarian' | 'non_vegetarian';
  labels: string[];
}

export interface PlannedMealIngredient {
  name: string;
  quantity: string;
  /** Grams scaled to the planned servings. */
  grams: number;
}

export interface PlannedMeal {
  templateId: string;
  name: string;
  mealType: MealType;
  servings: number;
  /** Scaled to servings. */
  nutrients: Nutrients;
  /** Grams scaled to servings. */
  ingredients: PlannedMealIngredient[];
}

export interface DayPlan {
  dayIndex: number;
  targetKcal: number;
  meals: PlannedMeal[];
  totals: Nutrients;
}

export interface WeeklyPlanOptions {
  meals: TemplateMeal[];
  calorieTarget: number;
  dietPreference?: string;
  allergies?: string[];
  dislikedIngredients?: string[];
  seed?: number;
}

/** Default seed — the plan is identical for identical inputs. */
export const DEFAULT_SEED = 42;

export const MEAL_TYPE_ORDER: MealType[] = [
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'extra',
];

/** Seeded PRNG (mulberry32) for deterministic plan generation. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toPlannedMeal(t: TemplateMeal, servings: number): PlannedMeal {
  const base: PlannedMeal = {
    templateId: t.id,
    name: t.name,
    mealType: t.mealType,
    servings: 1,
    nutrients: { ...t.nutrients },
    ingredients: t.ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      grams: i.grams,
    })),
  };
  return scaleMealServings(base, servings);
}

/**
 * Scale a planned meal to a new serving count. Nutrients and ingredient grams
 * scale proportionally; quantity display strings are unchanged.
 */
export function scaleMealServings(
  meal: PlannedMeal,
  servings: number,
): PlannedMeal {
  if (!(servings > 0)) {
    throw new RangeError('scaleMealServings: servings must be > 0');
  }
  if (!(meal.servings > 0)) {
    throw new RangeError('scaleMealServings: meal.servings must be > 0');
  }
  const factor = servings / meal.servings;
  return {
    ...meal,
    servings,
    nutrients: scaleNutrients(meal.nutrients, meal.servings, servings),
    ingredients: meal.ingredients.map((i) => ({
      ...i,
      grams: round1(i.grams * factor),
    })),
  };
}

interface ScaledDay {
  dayIndex: number;
  targetKcal: number;
  meals: PlannedMeal[];
}

/** Uniformly scale a day's servings so the day lands near the kcal target. */
function scaleDayToTarget(day: ScaledDay): DayPlan {
  const baseKcal = sumNutrients(day.meals.map((m) => m.nutrients)).kcal;
  let meals = day.meals;
  if (baseKcal > 0 && day.targetKcal > 0) {
    const factor = day.targetKcal / baseKcal;
    meals = day.meals.map((m) =>
      scaleMealServings(m, Math.max(0.25, Math.round(m.servings * factor * 100) / 100)),
    );
  }
  return {
    dayIndex: day.dayIndex,
    targetKcal: day.targetKcal,
    meals,
    totals: roundNutrients(sumNutrients(meals.map((m) => m.nutrients))),
  };
}

/**
 * Generate a deterministic 7-day plan.
 *
 * - Filters OUT any meal that violates dietPreference or contains an allergen
 *   (never included). Disliked ingredients are filtered when possible; if that
 *   would empty the pool, the dislike filter is relaxed (diet + allergy rules
 *   are never relaxed).
 * - Picks one template per meal type per day via the seeded PRNG, then scales
 *   servings uniformly so the day lands near calorieTarget.
 */
export function generateWeeklyPlan(o: WeeklyPlanOptions): DayPlan[] {
  const dietPreference = o.dietPreference ?? 'flexible';
  const allergies = o.allergies ?? [];
  const disliked = (o.dislikedIngredients ?? []).map((d) => d.toLowerCase());
  const rand = mulberry32(o.seed ?? DEFAULT_SEED);

  const safe = o.meals.filter(
    (m) =>
      validateMealAgainstProfile(m, { allergies, dietPreference }).ok,
  );
  const liked = safe.filter(
    (m) =>
      !m.ingredients.some((ing) =>
        disliked.some((d) => ing.name.toLowerCase().includes(d)),
      ),
  );
  // Never violate diet/allergy rules; relax only the dislike preference.
  const pool = liked.length > 0 ? liked : safe;

  const byType = new Map<MealType, TemplateMeal[]>();
  for (const t of MEAL_TYPE_ORDER) byType.set(t, []);
  for (const m of pool) {
    const bucket = byType.get(m.mealType);
    if (bucket) bucket.push(m);
  }

  const days: DayPlan[] = [];
  for (let d = 0; d < 7; d++) {
    const meals: PlannedMeal[] = [];
    for (const t of MEAL_TYPE_ORDER) {
      const options = byType.get(t) ?? [];
      if (options.length === 0) continue;
      const pick = options[Math.floor(rand() * options.length)];
      meals.push(toPlannedMeal(pick, 1));
    }
    days.push(
      scaleDayToTarget({ dayIndex: d, targetKcal: o.calorieTarget, meals }),
    );
  }
  return days;
}

/**
 * Replace one meal in a day plan with a different template from the (already
 * filtered) pool, then re-scale the day to the calorie target.
 * Deterministic: picks the first pool template that differs from the current
 * one. Returns a new DayPlan; the input is not mutated.
 */
export function regenerateMeal(
  dayPlan: DayPlan,
  dayIndex: number,
  mealType: MealType,
  pool: TemplateMeal[],
  calorieTarget: number,
): DayPlan {
  const current = dayPlan.meals.find((m) => m.mealType === mealType);
  const options = pool.filter((m) => m.mealType === mealType);
  if (!current || options.length === 0) {
    return cloneDayPlan(dayPlan);
  }
  const alternatives = options.filter((m) => m.id !== current.templateId);
  const pick = alternatives.length > 0 ? alternatives[0] : options[0];
  const meals = dayPlan.meals.map((m) =>
    m.mealType === mealType ? toPlannedMeal(pick, 1) : clonePlannedMeal(m),
  );
  return scaleDayToTarget({ dayIndex, targetKcal: calorieTarget, meals });
}

/**
 * Swap two meals between days (by meal index within each day).
 * Returns a new plan array; the input is not mutated.
 */
export function swapMealsBetweenDays(
  plan: DayPlan[],
  d1: number,
  m1: number,
  d2: number,
  m2: number,
): DayPlan[] {
  const next = plan.map(cloneDayPlan);
  const a = next[d1]?.meals[m1];
  const b = next[d2]?.meals[m2];
  if (!a || !b) {
    throw new RangeError('swapMealsBetweenDays: day/meal index out of range');
  }
  next[d1].meals[m1] = b;
  next[d2].meals[m2] = a;
  for (const d of [next[d1], next[d2]]) {
    d.totals = roundNutrients(sumNutrients(d.meals.map((m) => m.nutrients)));
  }
  return next;
}

function clonePlannedMeal(m: PlannedMeal): PlannedMeal {
  return {
    ...m,
    nutrients: { ...m.nutrients },
    ingredients: m.ingredients.map((i) => ({ ...i })),
  };
}

function cloneDayPlan(d: DayPlan): DayPlan {
  return {
    ...d,
    meals: d.meals.map(clonePlannedMeal),
    totals: { ...d.totals },
  };
}

/**
 * ~24 realistic template meals (4 per meal type) mixing Pakistani/Indian and
 * international dishes. Nutrients are per 1 serving. Labels include 'halal'
 * where appropriate and 'vegan' on fully plant-based meals.
 */
export const DEFAULT_TEMPLATE_MEALS: TemplateMeal[] = [
  // ---------------- breakfast ----------------
  {
    id: 'tm-oatmeal-berry',
    name: 'Oatmeal with Berries & Almonds',
    mealType: 'breakfast',
    ingredients: [
      { name: 'Rolled oats', quantity: '1/2 cup', grams: 40 },
      { name: 'Milk', quantity: '1 cup', grams: 200 },
      { name: 'Mixed berries', quantity: '1/2 cup', grams: 80 },
      { name: 'Almonds', quantity: '1 tbsp', grams: 15 },
      { name: 'Honey', quantity: '2 tsp', grams: 10 },
    ],
    nutrients: { kcal: 380, proteinG: 14, carbsG: 62, fatG: 11, fiberG: 9 },
    prepMin: 5,
    cookMin: 5,
    instructions: [
      'Bring milk to a gentle simmer.',
      'Stir in oats and cook 4–5 minutes until creamy.',
      'Top with berries, almonds, and honey.',
    ],
    tags: ['quick', 'high-fiber'],
    cuisine: 'International',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'halal', 'high-fiber'],
  },
  {
    id: 'tm-desi-omelette',
    name: 'Desi Masala Omelette with Roti',
    mealType: 'breakfast',
    ingredients: [
      { name: 'Eggs', quantity: '2', grams: 100 },
      { name: 'Onion', quantity: '1/4 cup chopped', grams: 40 },
      { name: 'Tomato', quantity: '1/4 cup chopped', grams: 40 },
      { name: 'Green chili', quantity: '1', grams: 5 },
      { name: 'Cooking oil', quantity: '1 tsp', grams: 5 },
      { name: 'Whole wheat roti', quantity: '1', grams: 60 },
    ],
    nutrients: { kcal: 420, proteinG: 20, carbsG: 40, fatG: 20, fiberG: 5 },
    prepMin: 10,
    cookMin: 8,
    instructions: [
      'Whisk eggs with onion, tomato, green chili, and salt.',
      'Cook in hot oil until set on both sides.',
      'Serve hot with whole wheat roti.',
    ],
    tags: ['high-protein', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'non_vegetarian',
    labels: ['halal', 'high-protein'],
  },
  {
    id: 'tm-greek-yogurt-bowl',
    name: 'Greek Yogurt Bowl with Granola',
    mealType: 'breakfast',
    ingredients: [
      { name: 'Greek yogurt', quantity: '3/4 cup', grams: 200 },
      { name: 'Granola', quantity: '1/4 cup', grams: 40 },
      { name: 'Banana', quantity: '1/2', grams: 80 },
      { name: 'Chia seeds', quantity: '1 tsp', grams: 10 },
    ],
    nutrients: { kcal: 430, proteinG: 25, carbsG: 55, fatG: 12, fiberG: 6 },
    prepMin: 5,
    cookMin: 0,
    instructions: [
      'Spoon yogurt into a bowl.',
      'Top with granola, sliced banana, and chia seeds.',
    ],
    tags: ['no-cook', 'high-protein'],
    cuisine: 'International',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'halal', 'high-protein'],
  },
  {
    id: 'tm-besan-cheela',
    name: 'Besan Cheela (Chickpea Pancakes)',
    mealType: 'breakfast',
    ingredients: [
      { name: 'Chickpea flour (besan)', quantity: '1/2 cup', grams: 60 },
      { name: 'Onion', quantity: '2 tbsp chopped', grams: 30 },
      { name: 'Tomato', quantity: '2 tbsp chopped', grams: 30 },
      { name: 'Cooking oil', quantity: '1 tsp', grams: 5 },
    ],
    nutrients: { kcal: 340, proteinG: 16, carbsG: 45, fatG: 10, fiberG: 8 },
    prepMin: 10,
    cookMin: 10,
    instructions: [
      'Mix besan with water into a thin batter; add onion, tomato, spices, salt.',
      'Pour ladles onto a hot greased pan; cook until golden both sides.',
      'Serve with mint chutney.',
    ],
    tags: ['vegan', 'high-protein', 'desi'],
    cuisine: 'Indian',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal', 'high-protein'],
  },
  // ---------------- morning snack ----------------
  {
    id: 'tm-apple-pb',
    name: 'Apple with Peanut Butter',
    mealType: 'morning_snack',
    ingredients: [
      { name: 'Apple', quantity: '1 medium', grams: 150 },
      { name: 'Peanut butter', quantity: '1 tbsp', grams: 20 },
    ],
    nutrients: { kcal: 190, proteinG: 5, carbsG: 28, fatG: 8, fiberG: 5 },
    prepMin: 3,
    cookMin: 0,
    instructions: ['Slice the apple.', 'Serve with peanut butter for dipping.'],
    tags: ['no-cook', 'quick'],
    cuisine: 'International',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal'],
  },
  {
    id: 'tm-roasted-chana',
    name: 'Roasted Chana (Chickpeas)',
    mealType: 'morning_snack',
    ingredients: [
      { name: 'Roasted chickpeas', quantity: '1/3 cup', grams: 50 },
      { name: 'Chaat masala', quantity: '1/2 tsp', grams: 2 },
    ],
    nutrients: { kcal: 180, proteinG: 9, carbsG: 30, fatG: 3, fiberG: 7 },
    prepMin: 2,
    cookMin: 0,
    instructions: ['Toss roasted chana with chaat masala and enjoy.'],
    tags: ['no-cook', 'high-protein', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal', 'high-protein'],
  },
  {
    id: 'tm-banana-lassi',
    name: 'Banana Lassi',
    mealType: 'morning_snack',
    ingredients: [
      { name: 'Banana', quantity: '1 small', grams: 100 },
      { name: 'Yogurt', quantity: '2/3 cup', grams: 150 },
      { name: 'Milk', quantity: '1/2 cup', grams: 100 },
      { name: 'Honey', quantity: '1 tsp', grams: 5 },
    ],
    nutrients: { kcal: 230, proteinG: 9, carbsG: 42, fatG: 4, fiberG: 2 },
    prepMin: 5,
    cookMin: 0,
    instructions: ['Blend all ingredients until smooth.', 'Serve chilled.'],
    tags: ['drink', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'halal'],
  },
  {
    id: 'tm-mixed-nuts',
    name: 'Mixed Nuts & Dates',
    mealType: 'morning_snack',
    ingredients: [
      { name: 'Almonds', quantity: '8', grams: 15 },
      { name: 'Walnuts', quantity: '4 halves', grams: 15 },
      { name: 'Dates', quantity: '2', grams: 30 },
    ],
    nutrients: { kcal: 200, proteinG: 5, carbsG: 22, fatG: 12, fiberG: 3 },
    prepMin: 2,
    cookMin: 0,
    instructions: ['Portion nuts and dates into a small bowl.'],
    tags: ['no-cook', 'quick'],
    cuisine: 'Middle Eastern',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal'],
  },
  // ---------------- lunch ----------------
  {
    id: 'tm-chicken-tikka-plate',
    name: 'Grilled Chicken Tikka with Roti & Salad',
    mealType: 'lunch',
    ingredients: [
      { name: 'Chicken breast', quantity: '150 g', grams: 150 },
      { name: 'Yogurt', quantity: '3 tbsp', grams: 40 },
      { name: 'Whole wheat roti', quantity: '1', grams: 60 },
      { name: 'Mixed salad', quantity: '1 cup', grams: 100 },
      { name: 'Cooking oil', quantity: '1 tsp', grams: 5 },
    ],
    nutrients: { kcal: 480, proteinG: 42, carbsG: 40, fatG: 14, fiberG: 6 },
    prepMin: 15,
    cookMin: 20,
    instructions: [
      'Marinate chicken in yogurt and tikka spices for 20+ minutes.',
      'Grill until charred and cooked through.',
      'Serve with warm roti and salad.',
    ],
    tags: ['high-protein', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'non_vegetarian',
    labels: ['halal', 'high-protein'],
  },
  {
    id: 'tm-daal-chawal',
    name: 'Daal Chawal (Red Lentils & Rice)',
    mealType: 'lunch',
    ingredients: [
      { name: 'Cooked red lentils (masoor daal)', quantity: '1 cup', grams: 200 },
      { name: 'Cooked rice', quantity: '1 cup', grams: 150 },
      { name: 'Cooking oil', quantity: '1 tsp', grams: 5 },
      { name: 'Onion', quantity: '2 tbsp', grams: 30 },
    ],
    nutrients: { kcal: 520, proteinG: 22, carbsG: 90, fatG: 7, fiberG: 12 },
    prepMin: 10,
    cookMin: 25,
    instructions: [
      'Simmer lentils with turmeric until soft; temper with onion in oil.',
      'Serve over steamed rice.',
    ],
    tags: ['vegan', 'high-fiber', 'desi', 'budget'],
    cuisine: 'Pakistani',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal', 'high-fiber'],
  },
  {
    id: 'tm-grilled-chicken-salad',
    name: 'Grilled Chicken Salad',
    mealType: 'lunch',
    ingredients: [
      { name: 'Chicken breast', quantity: '120 g', grams: 120 },
      { name: 'Mixed greens', quantity: '2 cups', grams: 100 },
      { name: 'Olive oil', quantity: '2 tsp', grams: 10 },
      { name: 'Feta cheese', quantity: '1 tbsp', grams: 20 },
    ],
    nutrients: { kcal: 380, proteinG: 35, carbsG: 10, fatG: 22, fiberG: 4 },
    prepMin: 10,
    cookMin: 12,
    instructions: [
      'Season and grill chicken; slice.',
      'Toss greens with olive oil and lemon.',
      'Top with chicken and feta.',
    ],
    tags: ['high-protein', 'low-carb'],
    cuisine: 'International',
    dietCategory: 'non_vegetarian',
    labels: ['halal', 'high-protein', 'low-carb'],
  },
  {
    id: 'tm-veg-curry-roti',
    name: 'Mixed Vegetable Curry with Roti',
    mealType: 'lunch',
    ingredients: [
      { name: 'Mixed vegetables', quantity: '1.5 cups', grams: 200 },
      { name: 'Whole wheat roti', quantity: '2', grams: 120 },
      { name: 'Cooking oil', quantity: '2 tsp', grams: 8 },
    ],
    nutrients: { kcal: 420, proteinG: 12, carbsG: 65, fatG: 13, fiberG: 10 },
    prepMin: 15,
    cookMin: 20,
    instructions: [
      'Sauté spices in oil; add vegetables and tomatoes.',
      'Simmer until tender.',
      'Serve with hot rotis.',
    ],
    tags: ['vegan', 'desi'],
    cuisine: 'Indian',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal'],
  },
  // ---------------- afternoon snack ----------------
  {
    id: 'tm-cucumber-raita',
    name: 'Cucumber Raita',
    mealType: 'afternoon_snack',
    ingredients: [
      { name: 'Yogurt', quantity: '2/3 cup', grams: 150 },
      { name: 'Cucumber', quantity: '1/2 cup diced', grams: 80 },
    ],
    nutrients: { kcal: 120, proteinG: 8, carbsG: 12, fatG: 4, fiberG: 1 },
    prepMin: 5,
    cookMin: 0,
    instructions: [
      'Whisk yogurt with salt and roasted cumin.',
      'Fold in diced cucumber; chill before serving.',
    ],
    tags: ['no-cook', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'halal', 'high-protein'],
  },
  {
    id: 'tm-protein-shake',
    name: 'Whey Protein Shake',
    mealType: 'afternoon_snack',
    ingredients: [
      { name: 'Whey protein', quantity: '1 scoop', grams: 30 },
      { name: 'Milk', quantity: '1 cup', grams: 250 },
      { name: 'Banana', quantity: '1/2 small', grams: 50 },
    ],
    nutrients: { kcal: 280, proteinG: 30, carbsG: 32, fatG: 4, fiberG: 2 },
    prepMin: 3,
    cookMin: 0,
    instructions: ['Blend whey, milk, and banana until smooth.'],
    tags: ['drink', 'high-protein', 'quick'],
    cuisine: 'International',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'high-protein'],
  },
  {
    id: 'tm-baked-samosa',
    name: 'Baked Vegetable Samosa (2 pc)',
    mealType: 'afternoon_snack',
    ingredients: [
      { name: 'Potato-pea filling', quantity: '1/2 cup', grams: 100 },
      { name: 'Whole wheat pastry', quantity: '2 shells', grams: 60 },
      { name: 'Cooking oil', quantity: '1 tsp', grams: 5 },
    ],
    nutrients: { kcal: 260, proteinG: 6, carbsG: 45, fatG: 8, fiberG: 5 },
    prepMin: 15,
    cookMin: 25,
    instructions: [
      'Fill pastry shells with spiced potato-pea mix; seal edges.',
      'Brush lightly with oil; bake at 200°C for 20–25 minutes.',
    ],
    tags: ['desi', 'baked'],
    cuisine: 'Indian',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal'],
  },
  {
    id: 'tm-chickpea-chaat',
    name: 'Chickpea Chaat',
    mealType: 'afternoon_snack',
    ingredients: [
      { name: 'Cooked chickpeas', quantity: '3/4 cup', grams: 120 },
      { name: 'Onion', quantity: '2 tbsp chopped', grams: 30 },
      { name: 'Tomato', quantity: '1/4 cup chopped', grams: 40 },
      { name: 'Lemon juice', quantity: '1 tsp', grams: 5 },
    ],
    nutrients: { kcal: 200, proteinG: 10, carbsG: 34, fatG: 3, fiberG: 8 },
    prepMin: 10,
    cookMin: 0,
    instructions: [
      'Toss chickpeas with onion, tomato, lemon, and chaat masala.',
      'Rest 5 minutes; serve.',
    ],
    tags: ['no-cook', 'high-fiber', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal', 'high-fiber'],
  },
  // ---------------- dinner ----------------
  {
    id: 'tm-salmon-quinoa',
    name: 'Baked Salmon with Quinoa',
    mealType: 'dinner',
    ingredients: [
      { name: 'Salmon fillet', quantity: '150 g', grams: 150 },
      { name: 'Cooked quinoa', quantity: '3/4 cup', grams: 120 },
      { name: 'Broccoli', quantity: '1 cup', grams: 100 },
      { name: 'Olive oil', quantity: '1 tsp', grams: 5 },
    ],
    nutrients: { kcal: 520, proteinG: 40, carbsG: 35, fatG: 22, fiberG: 6 },
    prepMin: 10,
    cookMin: 20,
    instructions: [
      'Season salmon; bake at 200°C for 12–15 minutes.',
      'Steam broccoli; serve over quinoa with a drizzle of olive oil.',
    ],
    tags: ['high-protein', 'omega-3'],
    cuisine: 'International',
    dietCategory: 'non_vegetarian',
    labels: ['halal', 'high-protein', 'pescatarian', 'fish', 'omega-3'],
  },
  {
    id: 'tm-chicken-karahi-light',
    name: 'Light Chicken Karahi with Roti',
    mealType: 'dinner',
    ingredients: [
      { name: 'Chicken breast', quantity: '130 g', grams: 130 },
      { name: 'Tomato', quantity: '2/3 cup chopped', grams: 100 },
      { name: 'Whole wheat roti', quantity: '1', grams: 60 },
      { name: 'Cooking oil', quantity: '2 tsp', grams: 8 },
    ],
    nutrients: { kcal: 480, proteinG: 38, carbsG: 42, fatG: 16, fiberG: 5 },
    prepMin: 10,
    cookMin: 25,
    instructions: [
      'Sear chicken in oil with ginger and garlic.',
      'Add tomatoes and karahi spices; simmer until thick.',
      'Serve with roti.',
    ],
    tags: ['high-protein', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'non_vegetarian',
    labels: ['halal', 'high-protein'],
  },
  {
    id: 'tm-quinoa-buddha-bowl',
    name: 'Quinoa Buddha Bowl',
    mealType: 'dinner',
    ingredients: [
      { name: 'Cooked quinoa', quantity: '3/4 cup', grams: 120 },
      { name: 'Cooked chickpeas', quantity: '1/2 cup', grams: 80 },
      { name: 'Roasted vegetables', quantity: '1 cup', grams: 120 },
      { name: 'Tahini', quantity: '1 tbsp', grams: 15 },
    ],
    nutrients: { kcal: 450, proteinG: 16, carbsG: 62, fatG: 16, fiberG: 12 },
    prepMin: 15,
    cookMin: 20,
    instructions: [
      'Roast vegetables at 200°C until caramelized.',
      'Assemble over quinoa with chickpeas; drizzle tahini.',
    ],
    tags: ['vegan', 'high-fiber'],
    cuisine: 'International',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal', 'high-fiber'],
  },
  {
    id: 'tm-palak-paneer',
    name: 'Palak Paneer with Roti',
    mealType: 'dinner',
    ingredients: [
      { name: 'Paneer', quantity: '100 g', grams: 100 },
      { name: 'Spinach', quantity: '3 cups', grams: 150 },
      { name: 'Whole wheat roti', quantity: '1', grams: 60 },
      { name: 'Cooking oil', quantity: '1 tsp', grams: 5 },
    ],
    nutrients: { kcal: 460, proteinG: 22, carbsG: 40, fatG: 24, fiberG: 8 },
    prepMin: 15,
    cookMin: 20,
    instructions: [
      'Blanch and blend spinach into a smooth puree.',
      'Simmer with spices; add paneer cubes.',
      'Serve with roti.',
    ],
    tags: ['high-protein', 'desi'],
    cuisine: 'Indian',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'halal', 'high-protein'],
  },
  // ---------------- extra ----------------
  {
    id: 'tm-turmeric-milk',
    name: 'Warm Turmeric Milk',
    mealType: 'extra',
    ingredients: [
      { name: 'Milk', quantity: '1 cup', grams: 250 },
      { name: 'Turmeric', quantity: '1/2 tsp', grams: 2 },
      { name: 'Honey', quantity: '1 tsp', grams: 5 },
    ],
    nutrients: { kcal: 160, proteinG: 8, carbsG: 20, fatG: 6, fiberG: 0 },
    prepMin: 2,
    cookMin: 5,
    instructions: ['Warm milk with turmeric; stir in honey off the heat.'],
    tags: ['drink', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'halal'],
  },
  {
    id: 'tm-fruit-chaat',
    name: 'Fruit Chaat',
    mealType: 'extra',
    ingredients: [
      { name: 'Mixed fruit', quantity: '1.5 cups', grams: 200 },
      { name: 'Lemon juice', quantity: '1 tsp', grams: 5 },
      { name: 'Chaat masala', quantity: '1/4 tsp', grams: 1 },
    ],
    nutrients: { kcal: 120, proteinG: 1, carbsG: 30, fatG: 1, fiberG: 4 },
    prepMin: 10,
    cookMin: 0,
    instructions: ['Chop fruit; toss with lemon and chaat masala.'],
    tags: ['no-cook', 'desi'],
    cuisine: 'Pakistani',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'vegan', 'halal'],
  },
  {
    id: 'tm-boiled-eggs',
    name: 'Boiled Eggs (2)',
    mealType: 'extra',
    ingredients: [{ name: 'Eggs', quantity: '2', grams: 100 }],
    nutrients: { kcal: 155, proteinG: 13, carbsG: 1, fatG: 11, fiberG: 0 },
    prepMin: 2,
    cookMin: 10,
    instructions: ['Boil eggs 9–10 minutes; cool, peel, season with salt.'],
    tags: ['high-protein', 'low-carb', 'quick'],
    cuisine: 'International',
    dietCategory: 'non_vegetarian',
    labels: ['halal', 'high-protein', 'low-carb'],
  },
  {
    id: 'tm-cottage-cheese',
    name: 'Cottage Cheese Bowl',
    mealType: 'extra',
    ingredients: [
      { name: 'Cottage cheese', quantity: '3/4 cup', grams: 150 },
      { name: 'Cucumber', quantity: '1/4 cup diced', grams: 50 },
    ],
    nutrients: { kcal: 150, proteinG: 18, carbsG: 6, fatG: 6, fiberG: 1 },
    prepMin: 5,
    cookMin: 0,
    instructions: ['Combine cottage cheese with cucumber; season with black pepper.'],
    tags: ['no-cook', 'high-protein'],
    cuisine: 'International',
    dietCategory: 'vegetarian',
    labels: ['vegetarian', 'halal', 'high-protein'],
  },
];
