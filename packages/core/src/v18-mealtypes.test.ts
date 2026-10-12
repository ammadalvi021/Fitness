/**
 * V18 Phase E: Ramadan meal types accepted by diary validation (no DB).
 */
import { describe, expect, it } from 'vitest';
import { DiaryEntrySchema } from './validation.js';

const base = {
  date: '2026-10-12',
  servings: 1,
  kcal: 300,
};

describe('DiaryEntrySchema Ramadan meal types', () => {
  it.each(['sehri', 'iftar'])('accepts mealType %s', (mealType) => {
    const r = DiaryEntrySchema.safeParse({ ...base, mealType, customName: 'Oats' });
    expect(r.success).toBe(true);
  });

  it('still accepts the original six meal types', () => {
    for (const mealType of ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra']) {
      const r = DiaryEntrySchema.safeParse({ ...base, mealType, customName: 'Oats' });
      expect(r.success).toBe(true);
    }
  });

  it('still rejects unknown meal types', () => {
    const r = DiaryEntrySchema.safeParse({ ...base, mealType: 'brunch', customName: 'Oats' });
    expect(r.success).toBe(false);
  });
});
