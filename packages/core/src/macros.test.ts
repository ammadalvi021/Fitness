import { describe, expect, it } from 'vitest';
import { calculateMacros } from './macros.js';

describe('calculateMacros', () => {
  it('uses 2.0 g/kg protein for lose', () => {
    const m = calculateMacros({ calories: 2000, goal: 'lose', weightKg: 80 });
    expect(m.proteinG).toBe(160);
  });

  it.each([
    ['gain', 1.8],
    ['maintain', 1.6],
    ['improve_fitness', 1.4],
    ['eat_healthier', 1.4],
  ] as const)('uses %s g/kg protein for %s', (goal, gPerKg) => {
    const m = calculateMacros({ calories: 2000, goal, weightKg: 70 });
    expect(m.proteinG).toBe(Math.round(gPerKg * 70));
  });

  it('sets fat to 25% of kcal and carbs to the remainder', () => {
    const m = calculateMacros({ calories: 2000, goal: 'lose', weightKg: 80 });
    // protein 160 g (640 kcal), fat round(500/9)=56 g (504 kcal)
    expect(m.fatG).toBe(56);
    // carbs = (2000 − 640 − 504) / 4 = 214
    expect(m.carbsG).toBe(214);
  });

  it('sets fiber to 14 g per 1000 kcal', () => {
    expect(calculateMacros({ calories: 2000, goal: 'lose', weightKg: 80 }).fiberG).toBe(28);
    expect(calculateMacros({ calories: 1500, goal: 'maintain', weightKg: 60 }).fiberG).toBe(21);
  });

  it('sums back to approximately the calorie target', () => {
    for (const goal of ['lose', 'maintain', 'gain', 'improve_fitness', 'eat_healthier'] as const) {
      const m = calculateMacros({ calories: 2200, goal, weightKg: 75 });
      const total = m.proteinG * 4 + m.fatG * 9 + m.carbsG * 4;
      expect(Math.abs(total - 2200)).toBeLessThanOrEqual(10);
      expect(m.notes.length).toBeGreaterThan(0);
    }
  });
});
