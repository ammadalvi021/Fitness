/**
 * Allergen matching and meal-vs-profile validation.
 * Pure functions; matching is case-insensitive substring based.
 */

export interface AllergyCheckMeal {
  name?: string;
  ingredients: { name: string }[];
  dietCategory: string;
  labels: string[];
}

export interface AllergyProfile {
  allergies?: string[];
  dietPreference?: string;
}

export interface MealValidation {
  ok: boolean;
  violations: string[];
}

/**
 * Returns the matched allergen names (as given in `allergens`) when any
 * ingredient name contains the allergen as a substring (case-insensitive).
 */
export function mealContainsAllergen(
  ingredients: string[],
  allergens: string[],
): string[] {
  const matched: string[] = [];
  const lowered = ingredients.map((i) => i.toLowerCase());
  for (const allergen of allergens) {
    const a = allergen.trim().toLowerCase();
    if (!a) continue;
    if (lowered.some((ing) => ing.includes(a)) && !matched.includes(allergen)) {
      matched.push(allergen);
    }
  }
  return matched;
}

function dietViolations(meal: AllergyCheckMeal, dietPreference: string): string[] {
  const pref = dietPreference.trim().toLowerCase();
  const labels = meal.labels.map((l) => l.toLowerCase());
  const cat = meal.dietCategory.trim().toLowerCase();
  const label = meal.name ? `Meal "${meal.name}"` : 'Meal';

  switch (pref) {
    case 'vegetarian':
      return cat === 'vegetarian'
        ? []
        : [`${label} is not vegetarian (diet category: ${meal.dietCategory}).`];
    case 'vegan':
      if (cat !== 'vegetarian') {
        return [`${label} is not vegan (diet category: ${meal.dietCategory}).`];
      }
      return labels.includes('vegan')
        ? []
        : [`${label} is vegetarian but not marked vegan.`];
    case 'halal':
      // Plant-based meals are halal-safe; meat meals need the halal label.
      return labels.includes('halal') || cat === 'vegetarian'
        ? []
        : [`${label} is not marked halal.`];
    case 'pescatarian':
      return cat === 'vegetarian' ||
        labels.includes('pescatarian') ||
        labels.includes('fish') ||
        labels.includes('seafood')
        ? []
        : [`${label} contains meat and is not pescatarian.`];
    case 'flexible':
    case '':
      return [];
    default:
      // Unknown preferences are treated as flexible (forward-compatible).
      return [];
  }
}

/**
 * Checks a meal against a profile's allergies AND dietPreference.
 * Returns { ok, violations } — never throws on unknown preferences.
 */
export function validateMealAgainstProfile(
  meal: AllergyCheckMeal,
  profile: AllergyProfile,
): MealValidation {
  const violations: string[] = [];

  const allergens = profile.allergies ?? [];
  if (allergens.length > 0) {
    const hits = mealContainsAllergen(
      meal.ingredients.map((i) => i.name),
      allergens,
    );
    for (const hit of hits) {
      violations.push(`Contains allergen: ${hit}.`);
    }
  }

  const pref = (profile.dietPreference ?? 'flexible').trim() || 'flexible';
  violations.push(...dietViolations(meal, pref));

  return { ok: violations.length === 0, violations };
}
