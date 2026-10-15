/**
 * Regression: web-search results without micronutrient data (e.g. Open Food
 * Facts) send `micros: null` (scaleMicros returns null when the source has no
 * micros). The diary schema must accept null as "not tracked" — it previously
 * rejected it with a 400, so tapping Add on a web result silently failed.
 */
import { describe, expect, it } from 'vitest';
import { DiaryEntrySchema } from './validation.js';

const webResultPayload = {
  date: '2026-10-15',
  mealType: 'breakfast',
  foodId: null,
  customName: 'Chicken Keema',
  servings: 1,
  kcal: 237,
  proteinG: 18,
  carbsG: 2,
  fatG: 17,
  fiberG: 1,
  micros: null,
  source: 'web',
};

describe('DiaryEntrySchema micros nullability (web-search regression)', () => {
  it('accepts the full web-result payload (foodId: null, micros: null)', () => {
    const r = DiaryEntrySchema.safeParse(webResultPayload);
    expect(r.success).toBe(true);
  });

  it('accepts foodId: null on its own', () => {
    const { micros: _dropped, ...rest } = webResultPayload;
    const r = DiaryEntrySchema.safeParse(rest);
    expect(r.success).toBe(true);
  });

  it('accepts micros: null (not tracked)', () => {
    const r = DiaryEntrySchema.safeParse({ ...webResultPayload, foodId: undefined });
    expect(r.success).toBe(true);
  });

  it('accepts micros absent', () => {
    const { micros: _dropped, ...rest } = webResultPayload;
    const r = DiaryEntrySchema.safeParse(rest);
    expect(r.success).toBe(true);
  });

  it('accepts a real micro snapshot', () => {
    const r = DiaryEntrySchema.safeParse({
      ...webResultPayload,
      micros: { iron: { amount: 2.1, unit: 'mg' } },
    });
    expect(r.success).toBe(true);
  });

  it('still rejects malformed micros', () => {
    const r = DiaryEntrySchema.safeParse({
      ...webResultPayload,
      micros: { iron: { amount: 'a lot', unit: 'mg' } },
    });
    expect(r.success).toBe(false);
  });
});
