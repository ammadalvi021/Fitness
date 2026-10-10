import { describe, expect, it } from 'vitest';
import { calculateBMI } from './bmi.js';

describe('calculateBMI', () => {
  it('classifies underweight (< 18.5)', () => {
    // 50 kg @ 170 cm -> 17.3
    const r = calculateBMI({ weightKg: 50, heightCm: 170, ageYears: 30 });
    expect(r.bmi).toBe(17.3);
    expect(r.isMinor).toBe(false);
    expect(r.classificationKey).toBe('underweight');
    expect(r.classificationLabel).toBe('Underweight');
    expect(r.screeningNote).toBe('BMI is a screening measure, not a diagnosis.');
    expect(r.pediatricGuidance).toBeUndefined();
  });

  it('classifies healthy (18.5–24.9)', () => {
    // 65 kg @ 170 cm -> 22.5
    const r = calculateBMI({ weightKg: 65, heightCm: 170, ageYears: 30 });
    expect(r.bmi).toBe(22.5);
    expect(r.classificationKey).toBe('healthy');
    expect(r.classificationLabel).toBe('Healthy weight');
  });

  it('classifies overweight (25–29.9)', () => {
    // 80 kg @ 170 cm -> 27.7
    const r = calculateBMI({ weightKg: 80, heightCm: 170, ageYears: 30 });
    expect(r.bmi).toBe(27.7);
    expect(r.classificationKey).toBe('overweight');
    expect(r.classificationLabel).toBe('Overweight');
  });

  it('classifies obesity (>= 30)', () => {
    // 95 kg @ 170 cm -> 32.9
    const r = calculateBMI({ weightKg: 95, heightCm: 170, ageYears: 30 });
    expect(r.bmi).toBe(32.9);
    expect(r.classificationKey).toBe('obesity');
    expect(r.classificationLabel).toBe('Obesity');
  });

  it('treats age >= 18 as adult (boundary)', () => {
    const r = calculateBMI({ weightKg: 65, heightCm: 170, ageYears: 18 });
    expect(r.isMinor).toBe(false);
    expect(r.classificationKey).toBe('healthy');
  });

  it('gives no adult labels for minors, with pediatric guidance', () => {
    const r = calculateBMI({ weightKg: 50, heightCm: 160, ageYears: 16 });
    expect(r.bmi).toBe(19.5);
    expect(r.isMinor).toBe(true);
    expect(r.classificationKey).toBeNull();
    expect(r.classificationLabel).toBeNull();
    expect(r.screeningNote).toBe('BMI is a screening measure, not a diagnosis.');
    expect(r.pediatricGuidance).toBeDefined();
    expect(r.pediatricGuidance).toMatch(/pediatric/i);
  });

  it('treats missing age as adult', () => {
    const r = calculateBMI({ weightKg: 65, heightCm: 170 });
    expect(r.isMinor).toBe(false);
    expect(r.classificationKey).toBe('healthy');
  });

  it('rejects non-positive inputs', () => {
    expect(() => calculateBMI({ weightKg: 0, heightCm: 170 })).toThrow(RangeError);
    expect(() => calculateBMI({ weightKg: 65, heightCm: -5 })).toThrow(RangeError);
  });
});
