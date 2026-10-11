/**
 * Regression test: the nutrition page builds diary entries with nutrients
 * nested under a `nutrients` key, but POST /api/diary (DiaryEntrySchema)
 * requires them FLAT at the top level. Without flattening, every add path
 * (search, manual, recipe, favorites) 400s with "Invalid diary entry".
 */
import { describe, expect, it } from 'vitest';
import { DiaryEntrySchema } from '@fitfusion/core';
import { toDiaryPayload } from '../../app/(app)/nutrition/_shared';

describe('toDiaryPayload', () => {
  it('flattens nested nutrients into the DiaryEntrySchema shape', () => {
    // Exactly what the client sends when adding chana masala from a recipe.
    const clientBody = {
      date: '2026-10-11',
      mealType: 'lunch',
      recipeId: 'abc123',
      customName: 'Chana Masala',
      servings: 1,
      nutrients: { kcal: 320, proteinG: 12, carbsG: 45, fatG: 8, fiberG: 9 },
      source: 'recipe',
    };
    const payload = toDiaryPayload(clientBody);
    expect(payload).toMatchObject({
      date: '2026-10-11',
      mealType: 'lunch',
      customName: 'Chana Masala',
      servings: 1,
      kcal: 320,
      proteinG: 12,
      carbsG: 45,
      fatG: 8,
      fiberG: 9,
    });
    expect(payload).not.toHaveProperty('nutrients');
    // The flattened payload must pass server validation.
    expect(DiaryEntrySchema.safeParse(payload).success).toBe(true);
  });

  it('passes through an already-flat body unchanged', () => {
    const flat = { date: '2026-10-11', mealType: 'snack', kcal: 100, servings: 2 };
    expect(toDiaryPayload(flat)).toEqual(flat);
  });

  it('never lets nested keys clobber explicit top-level fields', () => {
    const payload = toDiaryPayload({
      kcal: 500,
      servings: 1,
      nutrients: { kcal: 999, proteinG: 10 },
    } as Record<string, unknown>);
    expect(payload.kcal).toBe(500);
    expect(payload.proteinG).toBe(10);
  });

  it('handles a missing nutrients key', () => {
    const body = { date: '2026-10-11', mealType: 'dinner', kcal: 200, servings: 1 };
    expect(toDiaryPayload(body)).toEqual(body);
  });
});
