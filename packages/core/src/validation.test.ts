import { describe, expect, it } from 'vitest';
import {
  CoachMessageSchema,
  CustomRecipePatchSchema,
  CustomRecipeSchema,
  DiaryEntrySchema,
  LoginSchema,
  MeasurementSchema,
  OnboardingSchema,
  ProfileUpdateSchema,
  RegisterSchema,
  ScanConfirmSchema,
  WaterLogSchema,
} from './validation.js';

describe('RegisterSchema', () => {
  it('accepts a valid registration', () => {
    expect(
      RegisterSchema.safeParse({
        email: 'a@example.com',
        password: 'secret123',
        name: 'Ali',
      }).success,
    ).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(
      RegisterSchema.safeParse({ email: 'a@example.com', password: 'ab1' }).success,
    ).toBe(false);
  });

  it('requires a letter and a number in the password', () => {
    expect(
      RegisterSchema.safeParse({ email: 'a@example.com', password: 'password' }).success,
    ).toBe(false);
    expect(
      RegisterSchema.safeParse({ email: 'a@example.com', password: '12345678' }).success,
    ).toBe(false);
  });

  it('rejects invalid emails', () => {
    expect(
      RegisterSchema.safeParse({ email: 'not-an-email', password: 'secret123' })
        .success,
    ).toBe(false);
  });
});

describe('LoginSchema', () => {
  it('requires email and password', () => {
    expect(
      LoginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success,
    ).toBe(true);
    expect(LoginSchema.safeParse({ email: 'a@example.com' }).success).toBe(false);
  });
});

describe('ProfileUpdateSchema', () => {
  it('accepts an empty update (all optional)', () => {
    expect(ProfileUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('enforces sane ranges', () => {
    expect(ProfileUpdateSchema.safeParse({ heightCm: 170 }).success).toBe(true);
    expect(ProfileUpdateSchema.safeParse({ heightCm: 300 }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ targetWeightKg: 10 }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ mealsPerDay: 9 }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ sex: 'unknown' }).success).toBe(false);
  });
});

describe('OnboardingSchema', () => {
  it('accepts a full onboarding payload', () => {
    expect(
      OnboardingSchema.safeParse({
        sex: 'female',
        heightCm: 165,
        weightKg: 60,
        activityLevel: 'moderate',
        goal: 'lose',
        allergies: ['peanut'],
      }).success,
    ).toBe(true);
  });

  it('rejects out-of-range measurements', () => {
    expect(OnboardingSchema.safeParse({ weightKg: 500 }).success).toBe(false);
  });
});

describe('DiaryEntrySchema', () => {
  it('accepts a valid entry', () => {
    expect(
      DiaryEntrySchema.safeParse({
        date: '2026-10-09',
        mealType: 'lunch',
        servings: 1.5,
        kcal: 480,
      }).success,
    ).toBe(true);
  });

  it('rejects bad dates, meal types, and servings', () => {
    const base = { date: '2026-10-09', mealType: 'lunch', servings: 1, kcal: 100 };
    expect(DiaryEntrySchema.safeParse({ ...base, date: '09/10/2026' }).success).toBe(false);
    expect(DiaryEntrySchema.safeParse({ ...base, mealType: 'brunch' }).success).toBe(false);
    expect(DiaryEntrySchema.safeParse({ ...base, servings: 0 }).success).toBe(false);
    expect(DiaryEntrySchema.safeParse({ ...base, kcal: -5 }).success).toBe(false);
  });
});

describe('DiaryEntrySchema — v21.4 recipeId + nutritionAck', () => {
  const base = { date: '2026-10-15', mealType: 'lunch', servings: 1, kcal: 100 };

  it('accepts an optional recipeId', () => {
    const ok = DiaryEntrySchema.safeParse({ ...base, customName: 'Karahi', recipeId: 'cmh8xyz123' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.recipeId).toBe('cmh8xyz123');
  });

  it('rejects an empty recipeId', () => {
    expect(DiaryEntrySchema.safeParse({ ...base, customName: 'Karahi', recipeId: '' }).success).toBe(
      false,
    );
  });

  it('accepts an optional nutritionAck boolean', () => {
    const ok = DiaryEntrySchema.safeParse({
      ...base,
      customName: 'Karahi',
      recipeId: 'cmh8xyz123',
      nutritionAck: true,
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.nutritionAck).toBe(true);
  });

  it('rejects a non-boolean nutritionAck', () => {
    expect(
      DiaryEntrySchema.safeParse({ ...base, customName: 'Karahi', nutritionAck: 'yes' }).success,
    ).toBe(false);
  });

  it('keeps both fields optional for manual entries', () => {
    const ok = DiaryEntrySchema.safeParse({ ...base, customName: 'Oatmeal' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.recipeId).toBeUndefined();
      expect(ok.data.nutritionAck).toBeUndefined();
    }
  });
});

describe('MeasurementSchema', () => {
  it('accepts weight/height/waist/bmi measurements', () => {
    for (const type of ['weight', 'height', 'waist', 'bmi'] as const) {
      expect(
        MeasurementSchema.safeParse({ type, value: 70, unit: 'kg' }).success,
      ).toBe(true);
    }
  });

  it('rejects non-positive values and unknown types', () => {
    expect(
      MeasurementSchema.safeParse({ type: 'weight', value: -1, unit: 'kg' }).success,
    ).toBe(false);
    expect(
      MeasurementSchema.safeParse({ type: 'fat', value: 20, unit: '%' }).success,
    ).toBe(false);
  });
});

describe('WaterLogSchema', () => {
  it('accepts a valid log and rejects negatives', () => {
    expect(WaterLogSchema.safeParse({ date: '2026-10-09', ml: 500 }).success).toBe(true);
    expect(WaterLogSchema.safeParse({ date: '2026-10-09', ml: -5 }).success).toBe(false);
    expect(WaterLogSchema.safeParse({ date: '2026-10-09', ml: 250.5 }).success).toBe(false);
  });
});

describe('ScanConfirmSchema', () => {
  it('requires at least one item with a name and kcal', () => {
    expect(ScanConfirmSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      ScanConfirmSchema.safeParse({
        items: [{ name: 'Apple', servings: 1, kcal: 95 }],
      }).success,
    ).toBe(true);
  });
});

describe('CoachMessageSchema', () => {
  it('requires non-empty content', () => {
    expect(CoachMessageSchema.safeParse({ content: 'Hello' }).success).toBe(true);
    expect(CoachMessageSchema.safeParse({ content: '' }).success).toBe(false);
  });
});

describe('OnboardingSchema (regression: full profile fields persist)', () => {
  it('keeps displayName, workout prefs, and safety flags instead of stripping them', () => {
    const parsed = OnboardingSchema.safeParse({
      displayName: 'E2E',
      dateOfBirth: '1990-01-01',
      sex: 'male',
      heightCm: 180,
      weightKg: 80,
      activityLevel: 'moderate',
      goal: 'lose',
      dietPreference: 'flexible',
      allergies: ['peanut'],
      workoutDays: ['mon', 'wed', 'fri'],
      workoutMinutesPerDay: 45,
      fitnessExperience: 'beginner',
      workoutLocation: 'home',
      equipment: ['dumbbell'],
      preferredCuisines: ['Pakistani'],
      budgetTier: 'medium',
      healthLimitations: 'none',
      exerciseRestrictions: 'bad knee',
      eatingDisorderRisk: false,
      isPregnant: false,
      isBreastfeeding: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.displayName).toBe('E2E');
      expect(parsed.data.workoutDays).toEqual(['mon', 'wed', 'fri']);
      expect(parsed.data.fitnessExperience).toBe('beginner');
      expect(parsed.data.equipment).toEqual(['dumbbell']);
      expect(parsed.data.healthLimitations).toBe('none');
    }
  });
});

describe('ProfileUpdateSchema (V18 location fields)', () => {
  it('accepts a full location payload and normalizes the country code', () => {
    const parsed = ProfileUpdateSchema.safeParse({
      country: 'pk',
      cityRegion: 'Lahore',
      language: 'roman-ur',
      unitSystem: 'metric',
      ramadanMode: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.country).toBe('PK');
      expect(parsed.data.cityRegion).toBe('Lahore');
      expect(parsed.data.language).toBe('roman-ur');
    }
  });

  it('accepts all three language options', () => {
    for (const language of ['en', 'ur', 'roman-ur'] as const) {
      expect(ProfileUpdateSchema.safeParse({ language }).success).toBe(true);
    }
  });

  it('rejects invalid location values', () => {
    expect(ProfileUpdateSchema.safeParse({ country: 'PKK' }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ country: 'P' }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ language: 'punjabi' }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ unitSystem: 'us' }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ cityRegion: '' }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ ramadanMode: 'yes' }).success).toBe(false);
  });

  it('flows through OnboardingSchema unchanged', () => {
    const parsed = OnboardingSchema.safeParse({
      country: 'IN',
      language: 'ur',
      unitSystem: 'imperial',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.country).toBe('IN');
  });
});

describe('CustomRecipeSchema', () => {
  const valid = {
    name: 'My Daal',
    ingredients: [
      // P4: declared nutrients require a documented basis.
      { name: 'Masoor daal (dry)', grams: 100, kcal: 352, proteinG: 24.6, carbsG: 63.4, fatG: 1.1, fiberG: 10.7, basis: 'usda' },
      { name: 'Water', grams: 500 },
    ],
    portions: 2,
    instructions: ['Boil the daal until soft.'],
    // V21.4: dietCategory is REQUIRED at creation (never defaulted).
    dietCategory: 'vegetarian',
  };

  it('accepts a valid custom recipe', () => {
    expect(CustomRecipeSchema.safeParse(valid).success).toBe(true);
  });

  it('V21.4: dietCategory is required at creation — missing or unknown is rejected', () => {
    const { dietCategory: _omitted, ...noDiet } = valid;
    const missing = CustomRecipeSchema.safeParse(noDiet);
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues.some((i) => i.path.join('.') === 'dietCategory')).toBe(true);
    }
    expect(
      CustomRecipeSchema.safeParse({ ...valid, dietCategory: 'vegan' }).success,
    ).toBe(false);
    expect(
      CustomRecipeSchema.safeParse({ ...valid, dietCategory: '' }).success,
    ).toBe(false);
    // Both legal values pass.
    expect(
      CustomRecipeSchema.safeParse({ ...valid, dietCategory: 'non_vegetarian' }).success,
    ).toBe(true);
  });

  it('V21.4: PATCH schema keeps dietCategory optional (absent = leave as-is)', () => {
    expect(CustomRecipePatchSchema.safeParse({}).success).toBe(true);
    expect(
      CustomRecipePatchSchema.safeParse({ dietCategory: 'non_vegetarian' }).success,
    ).toBe(true);
    expect(CustomRecipePatchSchema.safeParse({ dietCategory: 'vegan' }).success).toBe(
      false,
    );
  });

  it('rejects empty ingredients, zero portions, and bad grams', () => {
    expect(CustomRecipeSchema.safeParse({ ...valid, ingredients: [] }).success).toBe(false);
    expect(CustomRecipeSchema.safeParse({ ...valid, portions: 0 }).success).toBe(false);
    expect(
      CustomRecipeSchema.safeParse({
        ...valid,
        ingredients: [{ name: 'Salt', grams: -5 }],
      }).success,
    ).toBe(false);
  });

  it('patch schema allows partial updates', () => {
    expect(CustomRecipePatchSchema.safeParse({ portions: 4 }).success).toBe(true);
    expect(CustomRecipePatchSchema.safeParse({ portions: 0 }).success).toBe(false);
    expect(CustomRecipePatchSchema.safeParse({}).success).toBe(true);
  });

  it('P4: declared nutrients require all five + a basis', () => {
    const base = { name: 'My sauce', grams: 100 };
    // Full declaration + basis: accepted.
    expect(
      CustomRecipeSchema.safeParse({
        name: 'R',
        portions: 1,
        dietCategory: 'vegetarian',
        ingredients: [{ ...base, kcal: 100, proteinG: 2, carbsG: 10, fatG: 5, fiberG: 1, basis: 'label' }],
      }).success,
    ).toBe(true);
    // Full declaration WITHOUT basis: rejected.
    expect(
      CustomRecipeSchema.safeParse({
        name: 'R',
        portions: 1,
        ingredients: [{ ...base, kcal: 100, proteinG: 2, carbsG: 10, fatG: 5, fiberG: 1 }],
      }).success,
    ).toBe(false);
    // Partial declaration: rejected.
    expect(
      CustomRecipeSchema.safeParse({
        name: 'R',
        portions: 1,
        ingredients: [{ ...base, kcal: 100, proteinG: 2, basis: 'estimate' }],
      }).success,
    ).toBe(false);
  });

  it('P4: name-only rows are accepted (flagged unknown downstream, not rejected)', () => {
    // A chicken-like ingredient with only name+grams must not be silently
    // zeroed — the server flags it "nutrition unknown".
    expect(
      CustomRecipeSchema.safeParse({
        name: 'R',
        portions: 1,
        dietCategory: 'non_vegetarian',
        ingredients: [{ name: 'Chicken-ish mystery meat', grams: 100 }],
      }).success,
    ).toBe(true);
  });

  it('P4: known-zero rows need no nutrients or basis', () => {
    expect(
      CustomRecipeSchema.safeParse({
        name: 'R',
        portions: 1,
        dietCategory: 'vegetarian',
        ingredients: [{ name: 'Salt', grams: 5 }],
      }).success,
    ).toBe(true);
  });

  it('P4: foodId rows skip the declared-nutrient rules (server-trusted)', () => {
    expect(
      CustomRecipeSchema.safeParse({
        name: 'R',
        portions: 1,
        dietCategory: 'vegetarian',
        ingredients: [{ foodId: 'some-food-id', name: 'Chapati', grams: 60 }],
      }).success,
    ).toBe(true);
  });
});
