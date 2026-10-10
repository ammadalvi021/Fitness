/**
 * Onboarding form option lists (single source of truth for the UI).
 *
 * IMPORTANT: every non-empty `value` here must be accepted by the matching
 * field of `OnboardingSchema` in `@fitfusion/core` — see
 * `tests/integration/onboarding-options.test.ts`, which enforces this
 * contract. A mismatch produces the dreaded "Invalid onboarding data" 400
 * (e.g. the budget select once sent `budget|moderate|premium` while the
 * server only accepted `low|medium|high`).
 */

export interface OptionItem {
  value: string;
  label: string;
}

export const SEX_OPTIONS: OptionItem[] = [
  { value: "", label: "Prefer not to say" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
];

export const GOAL_OPTIONS: OptionItem[] = [
  { value: "", label: "Not sure yet" },
  { value: "lose", label: "Lose weight" },
  { value: "maintain", label: "Maintain weight" },
  { value: "gain", label: "Gain weight" },
  { value: "improve_fitness", label: "Improve fitness" },
  { value: "eat_healthier", label: "Eat healthier" },
];

export const ACTIVITY_OPTIONS: OptionItem[] = [
  { value: "", label: "Not sure yet" },
  { value: "sedentary", label: "Sedentary — little or no exercise" },
  { value: "light", label: "Light — 1–3 days / week" },
  { value: "moderate", label: "Moderate — 3–5 days / week" },
  { value: "active", label: "Active — 6–7 days / week" },
  { value: "very_active", label: "Very active — hard training daily" },
];

export const DIET_OPTIONS: OptionItem[] = [
  { value: "flexible", label: "Flexible — everything" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "pescatarian", label: "Pescatarian" },
  { value: "halal", label: "Halal" },
];

/** Values must match `budgetTier` in `OnboardingSchema` (low|medium|high). */
export const BUDGET_OPTIONS: OptionItem[] = [
  { value: "", label: "No preference" },
  { value: "low", label: "Budget-friendly" },
  { value: "medium", label: "Moderate" },
  { value: "high", label: "Premium" },
];

export const FITNESS_EXPERIENCE_OPTIONS: OptionItem[] = [
  { value: "", label: "Not sure yet" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

export const WORKOUT_LOCATION_OPTIONS: OptionItem[] = [
  { value: "", label: "No preference" },
  { value: "home", label: "Home" },
  { value: "gym", label: "Gym" },
  { value: "outdoors", label: "Outdoors" },
];

export const EQUIPMENT_OPTIONS: string[] = [
  "Bodyweight",
  "Dumbbells",
  "Resistance bands",
  "Pull-up bar",
  "Bench",
  "Full gym",
];

export const DAY_OPTIONS: string[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
