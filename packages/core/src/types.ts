/**
 * Shared domain types for @fitfusion/core.
 * Pure type definitions — no runtime code, no I/O.
 */

export type Sex = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active';

export type Goal =
  | 'lose'
  | 'maintain'
  | 'gain'
  | 'improve_fitness'
  | 'eat_healthier';

export type MealType =
  | 'breakfast'
  | 'morning_snack'
  | 'lunch'
  | 'afternoon_snack'
  | 'dinner'
  | 'extra';

export interface Nutrients {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

export interface SafetyFlags {
  isMinor?: boolean;
  isPregnant?: boolean;
  isBreastfeeding?: boolean;
  eatingDisorderRisk?: boolean;
  medicalCondition?: boolean;
}
