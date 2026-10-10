import { describe, expect, it } from 'vitest';
import {
  mealContainsAllergen,
  validateMealAgainstProfile,
} from './allergy.js';
import type { AllergyCheckMeal } from './allergy.js';

const vegMeal: AllergyCheckMeal = {
  name: 'Daal',
  ingredients: [{ name: 'Red lentils' }, { name: 'Rice' }],
  dietCategory: 'vegetarian',
  labels: ['vegetarian', 'vegan', 'halal'],
};

const meatMeal: AllergyCheckMeal = {
  name: 'Chicken Tikka',
  ingredients: [{ name: 'Chicken breast' }, { name: 'Yogurt' }],
  dietCategory: 'non_vegetarian',
  labels: ['halal', 'high-protein'],
};

describe('mealContainsAllergen', () => {
  it('matches case-insensitively by substring', () => {
    expect(
      mealContainsAllergen(['Peanut Butter', 'Apple'], ['peanut']),
    ).toEqual(['peanut']);
    expect(
      mealContainsAllergen(['whole MILK', 'oats'], ['Milk', 'gluten']),
    ).toEqual(['Milk']);
  });

  it('returns the allergen names as provided', () => {
    expect(
      mealContainsAllergen(['salted peanuts'], ['PEANUT']),
    ).toEqual(['PEANUT']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(mealContainsAllergen(['Rice', 'Lentils'], ['peanut', 'dairy'])).toEqual([]);
    expect(mealContainsAllergen(['Rice'], [])).toEqual([]);
  });
});

describe('validateMealAgainstProfile', () => {
  it('passes a vegetarian meal for a vegetarian', () => {
    expect(
      validateMealAgainstProfile(vegMeal, { dietPreference: 'vegetarian' }),
    ).toEqual({ ok: true, violations: [] });
  });

  it('rejects a meat meal for a vegetarian', () => {
    const r = validateMealAgainstProfile(meatMeal, { dietPreference: 'vegetarian' });
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it('requires the vegan label for vegans', () => {
    expect(
      validateMealAgainstProfile(vegMeal, { dietPreference: 'vegan' }).ok,
    ).toBe(true);
    const vegNoLabel: AllergyCheckMeal = {
      ...vegMeal,
      labels: ['vegetarian', 'halal'],
    };
    expect(
      validateMealAgainstProfile(vegNoLabel, { dietPreference: 'vegan' }).ok,
    ).toBe(false);
  });

  it('accepts halal-labeled and plant-based meals for halal', () => {
    expect(
      validateMealAgainstProfile(meatMeal, { dietPreference: 'halal' }).ok,
    ).toBe(true);
    expect(
      validateMealAgainstProfile(vegMeal, { dietPreference: 'halal' }).ok,
    ).toBe(true);
    const meatNoLabel: AllergyCheckMeal = { ...meatMeal, labels: ['high-protein'] };
    expect(
      validateMealAgainstProfile(meatNoLabel, { dietPreference: 'halal' }).ok,
    ).toBe(false);
  });

  it('enforces pescatarian rules', () => {
    const fishMeal: AllergyCheckMeal = {
      name: 'Salmon',
      ingredients: [{ name: 'Salmon fillet' }],
      dietCategory: 'non_vegetarian',
      labels: ['fish', 'pescatarian'],
    };
    expect(
      validateMealAgainstProfile(fishMeal, { dietPreference: 'pescatarian' }).ok,
    ).toBe(true);
    expect(
      validateMealAgainstProfile(meatMeal, { dietPreference: 'pescatarian' }).ok,
    ).toBe(false);
    expect(
      validateMealAgainstProfile(vegMeal, { dietPreference: 'pescatarian' }).ok,
    ).toBe(true);
  });

  it('flags allergen matches case-insensitively', () => {
    const pbMeal: AllergyCheckMeal = {
      name: 'PB Toast',
      ingredients: [{ name: 'Peanut butter' }, { name: 'Bread' }],
      dietCategory: 'vegetarian',
      labels: ['vegetarian'],
    };
    const r = validateMealAgainstProfile(pbMeal, {
      allergies: ['PEANUT'],
      dietPreference: 'flexible',
    });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => /peanut/i.test(v))).toBe(true);
  });

  it('combines allergy and diet violations', () => {
    const r = validateMealAgainstProfile(meatMeal, {
      allergies: ['chicken'],
      dietPreference: 'vegetarian',
    });
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBe(2);
  });
});
