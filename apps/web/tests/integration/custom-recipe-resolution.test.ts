/**
 * Custom-recipe ingredient resolution wiring (v21.3, Worker D).
 *
 * The classification rules themselves live in
 * `packages/core/src/custom-ingredients.ts` and are pinned by
 * `custom-ingredients.test.ts`. The DB-gated suite
 * (v18-custom-recipes.test.ts) covers the POST route but skips without
 * PostgreSQL. THIS file pins the wiring in between — `resolveIngredientRows`
 * in `@/app/api/recipes/custom-recipe` — with a mocked `@fitfusion/db`, so
 * it actually executes on this VM:
 *  - an unknown-ingredient row → nutritionStatus 'unknown', warnings carry
 *    "nutrition incomplete", and `nutritionIncomplete` is true (this is the
 *    exact value the POST route stores as `needsReview`);
 *  - known-zero rows (water, salt) → zeros with status 'ok', NO flag, NO
 *    "nutrition incomplete" warning;
 *  - a mixed recipe flags only the unknown rows;
 *  - a catalogue (foodId) row resolves through the mocked food lookup.
 *
 * Pure + mocked — no database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { foods } = vi.hoisted(() => ({
  foods: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@fitfusion/db', () => ({
  prisma: {
    food: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return foods.get(where.id) ?? null;
      }),
    },
  },
}));

import { resolveIngredientRows } from '@/app/api/recipes/custom-recipe';

beforeEach(() => {
  foods.clear();
});

describe('resolveIngredientRows — unknown ingredients flag the recipe', () => {
  it('an unknown-ingredient row → needsReview signal true + "nutrition incomplete" warning', async () => {
    const out = await resolveIngredientRows([
      { name: 'Fenugreek leaves', grams: 50 },
    ]);
    expect(out.missingFood).toBeUndefined();
    // The POST route stores needsReview: nutritionIncomplete verbatim.
    expect(out.nutritionIncomplete).toBe(true);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].nutritionStatus).toBe('unknown');
    expect(out.rows[0].kcal).toBe(0);
    expect(
      out.warnings.some((w) => w.toLowerCase().includes('nutrition incomplete')),
    ).toBe(true);
  });

  it('known-zero rows (water, salt) stay zero WITHOUT flagging', async () => {
    const out = await resolveIngredientRows([
      { name: 'Water', grams: 250 },
      { name: 'Salt', grams: 5 },
    ]);
    expect(out.nutritionIncomplete).toBe(false);
    expect(out.rows.map((r) => r.nutritionStatus)).toEqual(['ok', 'ok']);
    for (const r of out.rows) {
      expect(r.kcal).toBe(0);
      expect(r.proteinG).toBe(0);
      expect(r.carbsG).toBe(0);
      expect(r.fatG).toBe(0);
      expect(r.fiberG).toBe(0);
    }
    expect(
      out.warnings.some((w) => w.toLowerCase().includes('nutrition incomplete')),
    ).toBe(false);
    expect(
      out.warnings.some((w) => w.toLowerCase().includes('unknown')),
    ).toBe(false);
  });

  it('a mixed recipe flags only the unknown rows', async () => {
    const out = await resolveIngredientRows([
      { name: 'Water', grams: 250 },
      { name: 'Mystery spice mix', grams: 10 },
    ]);
    expect(out.nutritionIncomplete).toBe(true);
    const byName = Object.fromEntries(out.rows.map((r) => [r.name, r]));
    expect(byName['Water'].nutritionStatus).toBe('ok');
    expect(byName['Water'].kcal).toBe(0);
    expect(byName['Mystery spice mix'].nutritionStatus).toBe('unknown');
  });

  it('a catalogue (foodId) row resolves and does not flag', async () => {
    foods.set('f1', {
      id: 'f1',
      name: 'Rice (cooked)',
      servingSize: 1,
      servingUnit: 'cup',
      servingWeightG: 150,
      kcal: 130,
      proteinG: 2.7,
      carbsG: 28,
      fatG: 0.3,
      fiberG: 0.4,
    });
    const out = await resolveIngredientRows([
      { foodId: 'f1', name: 'Rice (cooked)', grams: 150 },
      { name: 'Water', grams: 100 },
    ]);
    expect(out.missingFood).toBeUndefined();
    expect(out.nutritionIncomplete).toBe(false);
    const rice = out.rows.find((r) => r.name === 'Rice (cooked)')!;
    expect(rice.nutritionStatus).toBe('ok');
    expect(rice.kcal).toBeGreaterThan(0);
  });

  it('an unresolvable foodId surfaces missingFood', async () => {
    const out = await resolveIngredientRows([
      { foodId: 'ghost', name: 'Ghost pepper', grams: 5 },
    ]);
    expect(out.missingFood).toBe('Ghost pepper');
  });
});
