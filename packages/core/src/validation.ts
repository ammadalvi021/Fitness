/**
 * Zod input schemas for API boundaries. Pure (no I/O).
 * The web app validates every request body against these server-side.
 */

import { z } from 'zod';

const SexEnum = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);
const ActivityLevelEnum = z.enum([
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
]);
const GoalEnum = z.enum([
  'lose',
  'maintain',
  'gain',
  'improve_fitness',
  'eat_healthier',
]);
const MealTypeEnum = z.enum([
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'extra',
]);
const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
  name: z.string().min(1).max(100).optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const ProfileUpdateSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  dateOfBirth: z.coerce.date().optional(),
  sex: SexEnum.optional(),
  heightCm: z.number().min(50).max(250).optional(),
  activityLevel: ActivityLevelEnum.optional(),
  goal: GoalEnum.optional(),
  targetWeightKg: z.number().min(20).max(300).optional(),
  fitnessExperience: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  workoutLocation: z.enum(['home', 'gym', 'outdoors']).optional(),
  equipment: z.array(z.string().min(1).max(50)).max(30).optional(),
  workoutDays: z.array(z.string().min(1).max(10)).max(7).optional(),
  workoutMinutesPerDay: z.number().int().min(5).max(300).optional(),
  dietPreference: z.string().min(1).max(50).optional(),
  allergies: z.array(z.string().min(1)).max(50).optional(),
  intolerances: z.array(z.string().min(1)).max(50).optional(),
  halalOnly: z.boolean().optional(),
  preferredCuisines: z.array(z.string().min(1).max(50)).max(30).optional(),
  dislikedIngredients: z.array(z.string().min(1)).max(100).optional(),
  mealsPerDay: z.number().int().min(1).max(8).optional(),
  budgetTier: z.enum(['low', 'medium', 'high']).optional(),
  maxCookMinutes: z.number().int().min(1).max(300).optional(),
  healthLimitations: z.string().max(1000).optional(),
  exerciseRestrictions: z.string().max(1000).optional(),
  eatingDisorderRisk: z.boolean().optional(),
  isPregnant: z.boolean().optional(),
  isBreastfeeding: z.boolean().optional(),
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

export const OnboardingSchema = ProfileUpdateSchema.extend({
  weightKg: z.number().min(20).max(300).optional(),
});
export type OnboardingInput = z.infer<typeof OnboardingSchema>;

export const DiaryEntrySchema = z.object({
  date: DateString,
  mealType: MealTypeEnum,
  foodId: z.string().min(1).optional(),
  customName: z.string().min(1).max(200).optional(),
  servings: z.number().positive('Servings must be positive'),
  kcal: z.number().min(0),
  proteinG: z.number().min(0).optional(),
  carbsG: z.number().min(0).optional(),
  fatG: z.number().min(0).optional(),
  fiberG: z.number().min(0).optional(),
  idempotencyKey: z.string().min(1).max(100).optional(),
});
export type DiaryEntryInput = z.infer<typeof DiaryEntrySchema>;

export const MeasurementSchema = z.object({
  type: z.enum(['weight', 'height', 'waist', 'bmi']),
  value: z.number().positive('Value must be positive'),
  unit: z.string().min(1).max(20),
  recordedAt: z.coerce.date().optional(),
  note: z.string().max(500).optional(),
});
export type MeasurementInput = z.infer<typeof MeasurementSchema>;

export const WaterLogSchema = z.object({
  date: DateString,
  ml: z.number().int().min(0).max(10000),
});
export type WaterLogInput = z.infer<typeof WaterLogSchema>;

export const ScanConfirmSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        servings: z.number().positive().default(1),
        kcal: z.number().min(0),
        proteinG: z.number().min(0).default(0),
        carbsG: z.number().min(0).default(0),
        fatG: z.number().min(0).default(0),
        fiberG: z.number().min(0).default(0),
      }),
    )
    .min(1)
    .max(50),
});
export type ScanConfirmInput = z.infer<typeof ScanConfirmSchema>;

export const CoachMessageSchema = z.object({
  content: z.string().min(1, 'Message is required').max(10000),
});
export type CoachMessageInput = z.infer<typeof CoachMessageSchema>;
