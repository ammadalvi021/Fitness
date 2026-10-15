/**
 * V21.2 P1+P4 — resolveIngredientRows with a MOCKED prisma (pure, no DB).
 *
 * This executes the real server resolution logic (per-100-g factor via
 * canonical serving weight; unknown-ingredient classification) against an
 * in-memory food table. The DB-backed suite
 * (v212-nutrition-correctness.test.ts) covers the same paths against
 * PostgreSQL in CI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock('@fitfusion/db', () => ({
  prisma: { food: { findUnique: mockFindUnique } },
}));

// The mock must be registered before this import is evaluated.
const { resolveIngredientRows } = await import('@/app/api/recipes/custom-recipe');

interface MockFood {
  id: string;
  name: string;
  servingSize: number;
  servingUnit: string;
  servingWeightG: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

const FOODS: Record<string, MockFood> = {
  chapati: {
    id: 'f-chapati', name: 'Chapati (Whole Wheat Roti)',
    servingSize: 1, servingUnit: 'piece (30g)', servingWeightG: 30,
    kcal: 90, proteinG: 3, carbsG: 18, fatG: 1, fiberG: 3,
  },
  eggs: {
    id: 'f-eggs', name: 'Boiled Eggs',
    servingSize: 2, servingUnit: 'large eggs (100g)', servingWeightG: 100,
    kcal: 140, proteinG: 13, carbsG: 1, fatG: 10, fiberG: 0,
  },
  milk: {
    id: 'f-milk', name: 'Whole Milk',
    servingSize: 250, servingUnit: 'ml (1 cup)', servingWeightG: 257.5,
    kcal: 150, proteinG: 8, carbsG: 12, fatG: 8, fiberG: 0,
  },
  mystery: {
    id: 'f-mystery', name: 'Mystery Pack',
    servingSize: 1, servingUnit: 'packet', servingWeightG: null,
    kcal: 200, proteinG: 5, carbsG: 30, fatG: 6, fiberG: 2,
  },
};

beforeEach(() => {
  mockFindUnique.mockReset();
  mockFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(Object.values(FOODS).find((f) => f.id === where.id) ?? null),
  );
});

describe('resolveIngredientRows (mocked prisma)', () => {
  it('P1: chapati foodId converts via servingWeightG (300 kcal/100 g)', async () => {
    const r = await resolveIngredientRows([
      { foodId: 'f-chapati', name: 'Chapati', grams: 60 },
    ]);
    expect(r.missingFood).toBeUndefined();
    expect(r.nutritionIncomplete).toBe(false);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].kcal).toBeCloseTo(300, 6);
    expect(r.rows[0].nutritionStatus).toBe('ok');
  });

  it('P1: boiled-eggs count serving (2 eggs = 100 g) → factor 1', async () => {
    const r = await resolveIngredientRows([
      { foodId: 'f-eggs', name: 'Boiled Eggs', grams: 100 },
    ]);
    expect(r.rows[0].kcal).toBeCloseTo(140, 6);
    expect(r.rows[0].nutritionStatus).toBe('ok');
  });

  it('P1: milk volume serving → ≈58.3 kcal/100 g', async () => {
    const r = await resolveIngredientRows([
      { foodId: 'f-milk', name: 'Whole Milk', grams: 250 },
    ]);
    expect(r.rows[0].kcal).toBeCloseTo(58.25, 1);
    expect(r.nutritionIncomplete).toBe(false);
  });

  it('P1: unknown serving weight → INCOMPLETE row, never guessed', async () => {
    const r = await resolveIngredientRows([
      { foodId: 'f-mystery', name: 'Mystery Pack', grams: 100 },
    ]);
    expect(r.nutritionIncomplete).toBe(true);
    expect(r.rows[0].nutritionStatus).toBe('incomplete');
    expect(r.rows[0].kcal).toBe(0);
    expect(r.warnings.some((w) => w.includes('INCOMPLETE'))).toBe(true);
  });

  it('P1: missing foodId → missingFood', async () => {
    const r = await resolveIngredientRows([
      { foodId: 'nope', name: 'Ghost', grams: 100 },
    ]);
    expect(r.missingFood).toBe('Ghost');
  });

  it('P4: unknown "chicken"-like ingredient → flagged unknown, not silently zeroed', async () => {
    const r = await resolveIngredientRows([
      { name: 'Chicken-ish mystery meat', grams: 100 },
    ]);
    expect(r.nutritionIncomplete).toBe(true);
    expect(r.rows[0].nutritionStatus).toBe('unknown');
    expect(r.rows[0].kcal).toBe(0);
    expect(r.warnings.some((w) => w.includes('nutrition unknown'))).toBe(true);
  });

  it('P4: known-zero salt → ok with 0 kcal', async () => {
    const r = await resolveIngredientRows([{ name: 'Salt', grams: 5 }]);
    expect(r.nutritionIncomplete).toBe(false);
    expect(r.rows[0].nutritionStatus).toBe('ok');
    expect(r.rows[0].kcal).toBe(0);
  });

  it('P4: declared nutrients + basis → ok with declared values', async () => {
    const r = await resolveIngredientRows([
      {
        name: 'My Sauce', grams: 100,
        kcal: 120, proteinG: 2, carbsG: 10, fatG: 8, fiberG: 1,
        basis: 'label',
      },
    ]);
    expect(r.nutritionIncomplete).toBe(false);
    expect(r.rows[0].nutritionStatus).toBe('ok');
    expect(r.rows[0].kcal).toBe(120);
    expect(r.rows[0].proteinG).toBe(2);
  });

  it('P4: partial declarations are unknown, not zeroed', async () => {
    // (zod would reject this at the API boundary; the resolver treats it as
    // unknown rather than inventing the missing values.)
    const r = await resolveIngredientRows([
      { name: 'Half Sauce', grams: 100, kcal: 50 },
    ]);
    expect(r.nutritionIncomplete).toBe(true);
    expect(r.rows[0].nutritionStatus).toBe('unknown');
  });
});
