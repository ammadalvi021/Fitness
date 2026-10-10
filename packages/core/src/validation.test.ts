import { describe, expect, it } from 'vitest';
import {
  CoachMessageSchema,
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
