/**
 * Zod input schemas for API boundaries. Pure (no I/O).
 * The web app validates every request body against these server-side.
 */

import { z } from 'zod';
import { FastingRecordSchema } from './fasting.js';
import { MicrosSchema } from './micronutrients.js';
import { isKnownZeroIngredient } from './custom-ingredients.js';

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
  // V18 Ramadan: accepted by POST /api/diary with no DB migration.
  'sehri',
  'iftar',
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
  // V18 — location / locale preferences (DB columns already exist; Phase A wires UI).
  /** ISO-3166 alpha-2 country code, e.g. "PK". */
  country: z
    .string()
    .length(2, 'country must be a 2-letter ISO code')
    .transform((s) => s.toUpperCase())
    .optional(),
  cityRegion: z.string().min(1).max(100).optional(),
  language: z.enum(['en', 'ur', 'roman-ur']).optional(),
  unitSystem: z.enum(['metric', 'imperial']).optional(),
  // V18: Ramadan mode toggle (DB column already exists; Phase A wires UI).
  ramadanMode: z.boolean().optional(),
  // V20 Feature 1: user-set daily calorie target override (kcal). Same
  // bounds as the adaptive-TDEE clamp; null clears it back to the
  // computed (Mifflin-St Jeor + goal) target.
  calorieTargetOverrideKcal: z.number().int().min(1200).max(6000).nullish(),
  // V20: active intermittent-fast record, cross-device (DB JSON column).
  // Nullable so the client can clear the server-side fast (null = no active fast).
  fastingSession: FastingRecordSchema.nullable().optional(),
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

export const OnboardingSchema = ProfileUpdateSchema.extend({
  weightKg: z.number().min(20).max(300).optional(),
});
export type OnboardingInput = z.infer<typeof OnboardingSchema>;

/** Where a diary entry's numbers came from (client-declared, server-validated). */
export const DiarySourceEnum = z.enum(['manual', 'recipe', 'web', 'scan']);

export const DiaryEntrySchema = z.object({
  date: DateString,
  mealType: MealTypeEnum,
  foodId: z.string().min(1).nullable().optional(),
  customName: z.string().min(1).max(200).optional(),
  /**
   * V21.4: link to a stored Recipe. When present the server resolves the
   * recipe, enforces its visibility/ownership rules, and RECALCULATES
   * servings/nutrition from the stored per-serving values — client-supplied
   * totals are ignored on this path.
   */
  recipeId: z.string().min(1).max(64).optional(),
  servings: z.number().positive('Servings must be positive'),
  kcal: z.number().min(0),
  proteinG: z.number().min(0).optional(),
  carbsG: z.number().min(0).optional(),
  fatG: z.number().min(0).optional(),
  fiberG: z.number().min(0).optional(),
  /**
   * V20: micronutrient snapshot for the entry, closed MicroKey shape in
   * standard units. Same basis as kcal/proteinG (entry totals — the client
   * scales by servings before sending, exactly like the macro nutrients).
   * Stored as-is on the diary entry: the diary keeps the snapshot from
   * log time. Absent/null = not tracked.
   */
  micros: MicrosSchema.nullable(),
  idempotencyKey: z.string().min(1).max(100).optional(),
  /**
   * V21.4: explicit server-side acknowledgement that the logged nutrition is
   * partial. REQUIRED (must be `true`) when the resolved recipe's nutrition
   * is incomplete (needsReview); the diary API rejects un-acknowledged
   * partial logs. Ignored for manual/foodId entries and complete recipes.
   */
  nutritionAck: z.boolean().optional(),
  source: DiarySourceEnum.optional(),
});
export type DiaryEntryInput = z.infer<typeof DiaryEntrySchema>;

export const MeasurementSchema = z.object({
  // 'steps' = daily step counts imported from a connected health provider
  // (unit "steps"); landed in the existing Measurement table (V20 Feature 6).
  type: z.enum(['weight', 'height', 'waist', 'bmi', 'steps']),
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

// ---------------------------------------------------------------------------
// V18 — custom (user-created) recipes
// ---------------------------------------------------------------------------

/**
 * One ingredient row. Explicit nutrient values are PER 100 g of the
 * ingredient; when `foodId` points at a catalogue food the server derives
 * per-100-g values from that food's serving (via canonical servingWeightG,
 * see packages/core/src/serving-weight.ts).
 *
 * P4 (v21.2): rows WITHOUT a trusted foodId —
 *  - if the name is on the explicit KNOWN_ZERO_INGREDIENTS list (water,
 *    salt, plain spices — packages/core/src/custom-ingredients.ts), the row
 *    contributes 0;
 *  - otherwise declared nutrients require ALL FIVE values + a `basis`
 *    ('usda' | 'label' | 'estimate' — documented, never invented);
 *  - a name+grams-only row is accepted but classified "nutrition unknown":
 *    it contributes 0, is flagged, and forces needsReview=true on the
 *    recipe ("nutrition incomplete"). The server never invents nutrition.
 */
export const CustomRecipeIngredientSchema = z
  .object({
    foodId: z.string().min(1).optional(),
    name: z.string().min(1).max(200),
    grams: z.number().positive('grams must be positive').max(10000),
    kcal: z.number().min(0).max(9000).optional(),
    proteinG: z.number().min(0).max(100).optional(),
    carbsG: z.number().min(0).max(100).optional(),
    fatG: z.number().min(0).max(100).optional(),
    fiberG: z.number().min(0).max(100).optional(),
    /** Required when any nutrient is declared without a foodId. */
    basis: z.enum(['usda', 'label', 'estimate']).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.foodId) return; // trusted catalogue food — server resolves
    if (isKnownZeroIngredient(v.name)) return; // explicit zero list
    const keys = ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;
    const declared = keys.filter((k) => v[k] !== undefined);
    if (declared.length === 0) return; // "nutrition unknown" — flagged downstream, not rejected
    if (declared.length < keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Ingredient "${v.name}": declare all five nutrients (kcal, proteinG, carbsG, fatG, fiberG) or none — partial declarations are rejected.`,
      });
      return;
    }
    if (!v.basis) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Ingredient "${v.name}": declared nutrients require a basis ('usda' | 'label' | 'estimate').`,
      });
    }
  });
export type CustomRecipeIngredientInput = z.infer<
  typeof CustomRecipeIngredientSchema
>;

export const CustomRecipeSchema = z.object({
  name: z.string().min(1).max(200),
  ingredients: z
    .array(CustomRecipeIngredientSchema)
    .min(1, 'Add at least one ingredient')
    .max(100),
  yieldGrams: z.number().positive().max(50000).optional(),
  portions: z.number().int().min(1).max(100),
  instructions: z.array(z.string().min(1).max(2000)).max(50).optional(),
  // V21.4 (P6): dietCategory is REQUIRED at creation — never defaulted.
  // The server previously defaulted an omitted field to 'vegetarian',
  // which mislabeled meat recipes. Omitting it is now a validation error;
  // the UI forces an explicit choice. PATCH keeps it optional
  // (CustomRecipeSchema.partial()) — an absent field means "leave as-is".
  dietCategory: z.enum(['vegetarian', 'non_vegetarian'], {
    required_error: 'dietCategory is required: choose vegetarian or non_vegetarian',
    invalid_type_error: 'dietCategory must be vegetarian or non_vegetarian',
  }),
  prepMin: z.number().int().min(0).max(1440).optional(),
  cookMin: z.number().int().min(0).max(1440).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});
export type CustomRecipeInput = z.infer<typeof CustomRecipeSchema>;

/** PATCH body: any subset of the create fields; changing ingredients or
 * portions triggers a nutrition recalculation on the server. */
export const CustomRecipePatchSchema = CustomRecipeSchema.partial();
export type CustomRecipePatchInput = z.infer<typeof CustomRecipePatchSchema>;
