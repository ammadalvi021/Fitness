/**
 * density.test.ts — the documented density table (pure, no DB).
 */
import { describe, expect, it } from 'vitest';
import { lookupDensity, ML_PER_UNIT } from './density.js';

describe('lookupDensity', () => {
  it('returns documented densities for known ingredients', () => {
    expect(lookupDensity('water')?.density).toBe(1.0);
    expect(lookupDensity('Milk (whole)')?.density).toBe(1.03);
    expect(lookupDensity('olive oil')?.density).toBe(0.92);
    expect(lookupDensity('honey')?.density).toBe(1.42);
    expect(lookupDensity('sugar')?.density).toBe(0.83);
  });
  it('matches aliases and is case-insensitive', () => {
    expect(lookupDensity('DOODH')?.density).toBe(1.03);
    expect(lookupDensity('tel')?.density).toBe(0.92);
    expect(lookupDensity('pani')?.density).toBe(1.0);
  });
  it('strips parenthetical state before matching', () => {
    expect(lookupDensity('Maida (all-purpose flour)')?.density).toBe(0.52);
    expect(lookupDensity('Sugar (white)')?.density).toBe(0.83);
  });
  it('never substring-matches: "oil" alone is not "olive oil"', () => {
    // Bare 'oil' IS an explicit table entry (0.92) — but 'motor oil' is not.
    expect(lookupDensity('motor oil')).toBeNull();
    expect(lookupDensity('chicken breast (raw)')).toBeNull();
  });
  it('returns null where no reliable density exists', () => {
    expect(lookupDensity('Chicken breast (raw)')).toBeNull();
    expect(lookupDensity('Unicorn meat')).toBeNull();
    expect(lookupDensity('')).toBeNull();
  });
  it('documents a basis for every entry', () => {
    for (const name of [
      'water', 'milk', 'olive oil', 'ghee', 'honey', 'sugar', 'flour',
      'salt', 'yogurt', 'soy sauce', 'sesame oil', 'mustard oil', 'butter',
      'vinegar', 'lemon juice', 'sesame seeds', 'corn flour', 'cumin seeds',
      'black pepper', 'tahini', 'mustard (prepared)', 'tomato ketchup',
    ]) {
      const e = lookupDensity(name);
      expect(e, name).not.toBeNull();
      expect(e!.basis.length).toBeGreaterThan(0);
    }
  });
  it('covers the seed-recipe volume ingredients', () => {
    // Quantities used across the v21 seed library — each must resolve.
    expect(lookupDensity('Soy sauce')?.density).toBeCloseTo(1.07, 2);
    expect(lookupDensity('Vinegar')?.density).toBeCloseTo(1.01, 2);
    expect(lookupDensity('Lemon')?.density).toBeCloseTo(1.02, 2);
    expect(lookupDensity('Sesame seeds')?.density).toBeCloseTo(0.6, 2);
    expect(lookupDensity('Butter')?.density).toBeCloseTo(0.95, 2);
    expect(lookupDensity('Tahini')?.density).toBe(1.0);
    expect(lookupDensity('Mustard (prepared)')?.density).toBe(1.0);
    expect(lookupDensity('Tomato ketchup')?.density).toBeCloseTo(1.13, 2);
  });
});

describe('ML_PER_UNIT', () => {
  it('uses kitchen-standard millilitre equivalents', () => {
    expect(ML_PER_UNIT.cup).toBe(240);
    expect(ML_PER_UNIT.tbsp).toBe(15);
    expect(ML_PER_UNIT.tsp).toBe(5);
    expect(ML_PER_UNIT.fl_oz).toBeCloseTo(29.5735, 4);
    expect(ML_PER_UNIT.l).toBe(1000);
  });
});
