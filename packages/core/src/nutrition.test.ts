import { describe, expect, it } from 'vitest';
import { roundNutrients, scaleNutrients, sumNutrients } from './nutrition.js';
import type { Nutrients } from './types.js';

const N: Nutrients = { kcal: 100, proteinG: 10, carbsG: 20, fatG: 5, fiberG: 3 };

describe('scaleNutrients', () => {
  it('scales proportionally between serving counts', () => {
    const s = scaleNutrients(N, 1, 2);
    expect(s).toEqual({ kcal: 200, proteinG: 20, carbsG: 40, fatG: 10, fiberG: 6 });
  });

  it('handles fractional scaling', () => {
    const s = scaleNutrients(N, 2, 1);
    expect(s.kcal).toBeCloseTo(50, 10);
    expect(s.proteinG).toBeCloseTo(5, 10);
  });

  it('throws on non-positive fromServings', () => {
    expect(() => scaleNutrients(N, 0, 1)).toThrow(RangeError);
  });
});

describe('sumNutrients', () => {
  it('sums component-wise', () => {
    const s = sumNutrients([N, N, { kcal: 50, proteinG: 1, carbsG: 2, fatG: 3, fiberG: 4 }]);
    expect(s).toEqual({ kcal: 250, proteinG: 21, carbsG: 42, fatG: 13, fiberG: 10 });
  });

  it('returns zeros for an empty list', () => {
    expect(sumNutrients([])).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
  });
});

describe('roundNutrients', () => {
  it('rounds every component to 1 decimal', () => {
    const r = roundNutrients({
      kcal: 123.44,
      proteinG: 10.06,
      carbsG: 20.05,
      fatG: 5.0,
      fiberG: 3.99,
    });
    expect(r.kcal).toBe(123.4);
    expect(r.proteinG).toBe(10.1);
    expect(r.carbsG).toBe(20.1);
    expect(r.fatG).toBe(5.0);
    expect(r.fiberG).toBe(4.0);
  });
});
