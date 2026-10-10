/**
 * Configurable subscription plan catalog.
 * Pricing, billing periods, feature limits and availability are all
 * administrator-configurable here. Billing is only *charged* through a
 * configured payment provider (see BILLING_PROVIDER); otherwise plan
 * selection is recorded locally and clearly labeled as not billed.
 */

export type PlanId = "free" | "diet" | "diet_exercise";

export interface PlanFeatureLimits {
  /** Max AI food scans per month (-1 = unlimited) */
  aiScansPerMonth: number;
  /** Max AI coach messages per day (-1 = unlimited) */
  aiCoachMessagesPerDay: number;
  /** Max AI meal-plan regenerations per week (-1 = unlimited) */
  aiPlanRegenerationsPerWeek: number;
  /** Max saved recipes (-1 = unlimited) */
  savedRecipes: number;
  /** Max custom meals (-1 = unlimited) */
  customMeals: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** Price in the currency below, per billingPeriod */
  price: number;
  currency: string;
  billingPeriod: "monthly" | "yearly" | "one_time" | "free";
  features: string[];
  limits: PlanFeatureLimits;
  /** Rank for upgrade/downgrade comparisons */
  rank: number;
  /** If false, the plan is hidden from the picker */
  available: boolean;
}

export const PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Start your fitness journey",
    price: 0,
    currency: "USD",
    billingPeriod: "free",
    features: [
      "Dashboard with progress rings",
      "BMI & calorie calculators",
      "Basic calorie & macro tracker",
      "Curated recipe browsing (limited)",
      "Basic workout library",
      "Manual meal logging",
      "Basic progress tracking",
    ],
    limits: {
      aiScansPerMonth: 5,
      aiCoachMessagesPerDay: 10,
      aiPlanRegenerationsPerWeek: 0,
      savedRecipes: 10,
      customMeals: 5,
    },
    rank: 0,
    available: true,
  },
  {
    id: "diet",
    name: "Diet Plan",
    tagline: "Personalized nutrition, done for you",
    price: 9.99,
    currency: "USD",
    billingPeriod: "monthly",
    features: [
      "Everything in Free",
      "Personalized 7-day meal plans",
      "Daily calorie & macro targets",
      "Portion sizes & ingredient quantities",
      "Meal substitutions & swaps",
      "Weekly shopping lists",
      "AI meal suggestions",
      "Food diary & nutrition tracking",
      "Healthy recipe recommendations",
      "Hydration tracking",
    ],
    limits: {
      aiScansPerMonth: 100,
      aiCoachMessagesPerDay: 100,
      aiPlanRegenerationsPerWeek: 3,
      savedRecipes: -1,
      customMeals: -1,
    },
    rank: 1,
    available: true,
  },
  {
    id: "diet_exercise",
    name: "Diet + Exercise",
    tagline: "Complete body transformation",
    price: 14.99,
    currency: "USD",
    billingPeriod: "monthly",
    features: [
      "Everything in Diet Plan",
      "Personalized weekly workout schedule",
      "Daily exercise routines with demos",
      "Workout timers & rest intervals",
      "Set / rep / weight tracking",
      "Workout history & personal records",
      "Exercise substitutions",
      "Progression recommendations",
      "Recovery & rest-day scheduling",
      "Activity & workout analytics",
    ],
    limits: {
      aiScansPerMonth: -1,
      aiCoachMessagesPerDay: -1,
      aiPlanRegenerationsPerWeek: -1,
      savedRecipes: -1,
      customMeals: -1,
    },
    rank: 2,
    available: true,
  },
];

export function getPlan(id: PlanId): PlanDefinition {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan id: ${id}`);
  return plan;
}

/**
 * Stripe test-mode Price ID mapping.
 * planId -> NAME of the env var holding that plan's Stripe Price ID
 * (e.g. `price_...` copied from the Stripe dashboard, test mode).
 * The actual Price IDs live in env vars — never here, and never from
 * client input. `free` has no price and is intentionally absent.
 */
export const STRIPE_PRICE_ENV: Record<Exclude<PlanId, "free">, string> = {
  diet: "STRIPE_PRICE_DIET",
  diet_exercise: "STRIPE_PRICE_DIET_EXERCISE",
};

/** Server-side plan gating: does `current` include `required`? */
export function planIncludes(current: PlanId, required: PlanId): boolean {
  return getPlan(current).rank >= getPlan(required).rank;
}
