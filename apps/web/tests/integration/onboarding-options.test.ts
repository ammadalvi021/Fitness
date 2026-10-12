/**
 * Onboarding form options vs server schema contract.
 *
 * REGRESSION: the onboarding Budget select once sent
 * `budget|moderate|premium` while `OnboardingSchema.budgetTier` only accepted
 * `low|medium|high` — every user who picked a budget got
 * "Invalid onboarding data" (400) on Finish with no useful detail.
 * The option lists now live in `@/lib/onboarding-options` (single source of
 * truth) and this test enforces that every non-empty UI value validates
 * against the server schema, plus an end-to-end POST of a full payload.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { OnboardingSchema } from '@fitfusion/core';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as onboardingPOST } from '@/app/api/onboarding/route';
import {
  ACTIVITY_OPTIONS,
  BUDGET_OPTIONS,
  COUNTRY_OPTIONS,
  DAY_OPTIONS,
  DIET_OPTIONS,
  EQUIPMENT_OPTIONS,
  FITNESS_EXPERIENCE_OPTIONS,
  GOAL_OPTIONS,
  LANGUAGE_OPTIONS,
  SEX_OPTIONS,
  WORKOUT_LOCATION_OPTIONS,
} from '@/lib/onboarding-options';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  trackUser,
  uniqueEmail,
} from './helpers';

afterAll(cleanupUsers);

const nonEmpty = (opts: { value: string }[]) =>
  opts.map((o) => o.value).filter((v) => v !== '');

describe('onboarding UI option values match OnboardingSchema', () => {
  it('sex options validate', () => {
    for (const v of nonEmpty(SEX_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ sex: true }).safeParse({ sex: v }).success,
        `sex option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('goal options validate', () => {
    for (const v of nonEmpty(GOAL_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ goal: true }).safeParse({ goal: v }).success,
        `goal option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('activity options validate', () => {
    for (const v of nonEmpty(ACTIVITY_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ activityLevel: true }).safeParse({
          activityLevel: v,
        }).success,
        `activity option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('budget options validate (the original bug)', () => {
    for (const v of nonEmpty(BUDGET_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ budgetTier: true }).safeParse({ budgetTier: v })
          .success,
        `budget option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('country options validate (V18)', () => {
    for (const v of nonEmpty(COUNTRY_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ country: true }).safeParse({ country: v }).success,
        `country option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('language options validate (V18)', () => {
    for (const v of nonEmpty(LANGUAGE_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ language: true }).safeParse({ language: v }).success,
        `language option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('diet preference options validate', () => {
    for (const v of nonEmpty(DIET_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ dietPreference: true }).safeParse({
          dietPreference: v,
        }).success,
        `diet option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('fitness experience options validate', () => {
    for (const v of nonEmpty(FITNESS_EXPERIENCE_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ fitnessExperience: true }).safeParse({
          fitnessExperience: v,
        }).success,
        `experience option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('workout location options validate', () => {
    for (const v of nonEmpty(WORKOUT_LOCATION_OPTIONS)) {
      expect(
        OnboardingSchema.pick({ workoutLocation: true }).safeParse({
          workoutLocation: v,
        }).success,
        `location option "${v}" rejected by schema`,
      ).toBe(true);
    }
  });

  it('equipment and day options satisfy the array constraints', () => {
    expect(
      OnboardingSchema.pick({ equipment: true }).safeParse({
        equipment: EQUIPMENT_OPTIONS,
      }).success,
    ).toBe(true);
    expect(
      OnboardingSchema.pick({ workoutDays: true }).safeParse({
        workoutDays: DAY_OPTIONS,
      }).success,
    ).toBe(true);
  });
});

describe('POST /api/onboarding with a full realistic payload', () => {
  it('200: every enum field set, including budgetTier (the failing case)', async () => {
    const email = uniqueEmail('ff-onboarding');
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      email,
    );
    trackUser(userId);

    const res = await onboardingPOST(
      authed(
        jsonRequest('http://localhost/api/onboarding', 'POST', {
          displayName: 'Test User',
          dateOfBirth: '1990-05-15',
          sex: 'male',
          heightCm: 178,
          weightKg: 82.5,
          goal: 'lose',
          activityLevel: 'sedentary',
          targetWeightKg: 75,
          dietPreference: 'flexible',
          allergies: ['peanuts'],
          intolerances: ['lactose'],
          halalOnly: false,
          preferredCuisines: ['Pakistani', 'Mediterranean'],
          dislikedIngredients: ['olives'],
          budgetTier: 'low',
          mealsPerDay: 3,
          fitnessExperience: 'beginner',
          workoutLocation: 'home',
          equipment: ['Dumbbells'],
          workoutDays: ['Monday', 'Wednesday', 'Friday'],
          workoutMinutesPerDay: 30,
          healthLimitations: '',
          exerciseRestrictions: '',
          isPregnant: false,
          isBreastfeeding: false,
          eatingDisorderRisk: false,
        }),
        token,
      ),
    );
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.profile.onboardingCompletedAt).toBeTruthy();
  });
});
