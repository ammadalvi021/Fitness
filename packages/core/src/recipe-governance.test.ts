/**
 * Recipe review/verification governance (v21.4, v21.5 yieldGrams contract) —
 * pure policy tests.
 *
 * Pins the canonical material-change set and the invalidation/verify-gate
 * decisions. No database, no DOM — these run on every machine.
 *
 * v21.5: yieldGrams is INFORMATIONAL (the cook's reference for actual
 * cooked batch weight), not a divisor in the per-serving math, so it moved
 * from the material set to the non-material set. A yieldGrams-only edit
 * preserves review/verification evidence and must never alter nutrition.
 */
import { describe, expect, it } from 'vitest';
import {
  MATERIAL_RECIPE_FIELDS,
  NON_MATERIAL_RECIPE_FIELDS,
  buildContentSnapshot,
  computeRecipeContentHash,
  incompleteVerificationBlockMessage,
  incompleteVerificationBlockMessageForRows,
  invalidationForEdit,
  materialFieldsTouched,
  mayVerifyNutrition,
  type RecipeContentSnapshot,
} from './recipe-governance.js';

describe('materialFieldsTouched — the canonical material-change set', () => {
  it('ingredients, portions, dietCategory, tags, allergens are material', () => {
    expect(materialFieldsTouched(['ingredients'])).toEqual(['ingredients']);
    expect(materialFieldsTouched(['portions'])).toEqual(['portions']);
    expect(materialFieldsTouched(['dietCategory'])).toEqual(['dietCategory']);
    expect(materialFieldsTouched(['tags'])).toEqual(['tags']);
    expect(materialFieldsTouched(['allergens'])).toEqual(['allergens']);
  });

  it('yieldGrams is NOT material (v21.5 informational contract)', () => {
    // It is not a divisor in the per-serving math — changing it moves none
    // of the numbers or claims the evidence was checked against.
    expect(materialFieldsTouched(['yieldGrams'])).toEqual([]);
    expect(MATERIAL_RECIPE_FIELDS).not.toContain('yieldGrams');
    expect(NON_MATERIAL_RECIPE_FIELDS).toContain('yieldGrams');
  });

  it('yieldGrams rides along as metadata with other non-material edits', () => {
    expect(materialFieldsTouched(['yieldGrams', 'name', 'prepMin'])).toEqual(
      [],
    );
  });

  it('yieldGrams combined with a material field still invalidates', () => {
    expect(materialFieldsTouched(['yieldGrams', 'portions'])).toEqual([
      'portions',
    ]);
  });

  it('derived nutrition values are material by construction', () => {
    expect(materialFieldsTouched(['kcalPerServing'])).toEqual([
      'kcalPerServing',
    ]);
  });

  it('metadata-only fields are NOT material', () => {
    expect(
      materialFieldsTouched([
        'name',
        'prepMin',
        'cookMin',
        'difficulty',
        'instructions',
      ]),
    ).toEqual([]);
  });

  it('unknown keys are ignored (never treated as material)', () => {
    expect(materialFieldsTouched(['somethingNew'])).toEqual([]);
  });

  it('the material set covers every claim-bearing field', () => {
    // Guards against a future field being dropped from the set silently:
    // the set must still name the core five.
    for (const f of [
      'ingredients',
      'portions',
      'dietCategory',
      'tags',
      'allergens',
    ] as const) {
      expect(MATERIAL_RECIPE_FIELDS).toContain(f);
    }
  });
});

describe('invalidationForEdit — what a material edit lapses', () => {
  it('ingredient change → review AND verification invalidated', () => {
    const d = invalidationForEdit(['ingredients', 'name']);
    expect(d.invalidateReview).toBe(true);
    expect(d.invalidateVerification).toBe(true);
    expect(d.reason).toMatch(/ingredients/);
  });

  it('yield (portions) change → review AND verification invalidated', () => {
    const d = invalidationForEdit(['portions']);
    expect(d.invalidateReview).toBe(true);
    expect(d.invalidateVerification).toBe(true);
  });

  it('yieldGrams-only edit → review AND verification PRESERVED (v21.5)', () => {
    const d = invalidationForEdit(['yieldGrams']);
    expect(d.invalidateReview).toBe(false);
    expect(d.invalidateVerification).toBe(false);
    expect(d.reason).toMatch(/metadata-only/);
  });

  it('yieldGrams + portions → invalidated (portions is material)', () => {
    const d = invalidationForEdit(['yieldGrams', 'portions']);
    expect(d.invalidateReview).toBe(true);
    expect(d.invalidateVerification).toBe(true);
    expect(d.reason).toMatch(/portions/);
  });

  it('dietary-category change → review AND verification invalidated', () => {
    const d = invalidationForEdit(['dietCategory']);
    expect(d.invalidateReview).toBe(true);
    expect(d.invalidateVerification).toBe(true);
  });

  it('material claim (tags) / allergen change → invalidated', () => {
    expect(invalidationForEdit(['tags']).invalidateVerification).toBe(true);
    expect(invalidationForEdit(['allergens']).invalidateReview).toBe(true);
  });

  it('metadata-only edit → review and verification preserved', () => {
    const d = invalidationForEdit([
      'name',
      'prepMin',
      'instructions',
      'yieldGrams',
    ]);
    expect(d.invalidateReview).toBe(false);
    expect(d.invalidateVerification).toBe(false);
  });

  it('empty patch → nothing invalidated', () => {
    const d = invalidationForEdit([]);
    expect(d.invalidateReview).toBe(false);
    expect(d.invalidateVerification).toBe(false);
  });
});

describe('mayVerifyNutrition — incomplete nutrition can never be verified', () => {
  it('needsReview=true → verification refused', () => {
    expect(mayVerifyNutrition(true)).toBe(false);
  });

  it('needsReview=false/null/undefined → gate passes', () => {
    expect(mayVerifyNutrition(false)).toBe(true);
    expect(mayVerifyNutrition(null)).toBe(true);
    expect(mayVerifyNutrition(undefined)).toBe(true);
  });
});

describe('incompleteVerificationBlockMessage — the 400 copy', () => {
  it('names the unresolved ingredients', () => {
    const msg = incompleteVerificationBlockMessage(['chia seeds', 'xanthan gum']);
    expect(msg).toMatch(/chia seeds/);
    expect(msg).toMatch(/xanthan gum/);
    expect(msg).toMatch(/resolve the missing nutritional values/);
  });

  it('falls back to generic wording when no names are known', () => {
    const msg = incompleteVerificationBlockMessage([]);
    expect(msg).toMatch(/unknown nutrition/);
    expect(msg).not.toMatch(/unresolved ingredients: $/);
  });

  it('never suggests clearing needsReview to bypass the gate', () => {
    const msg = incompleteVerificationBlockMessage(['mystery spice']);
    expect(msg).toMatch(/Do not clear the needsReview flag/);
  });

  it('builds from stored rows via nutritionStatus', () => {
    const msg = incompleteVerificationBlockMessageForRows([
      { name: 'oats', nutritionStatus: 'ok' },
      { name: 'mystery spice', nutritionStatus: 'unknown' },
      { name: 'weird oil', nutritionStatus: 'incomplete' },
      { name: 'water' }, // no status tracked → not unresolved
    ]);
    expect(msg).toMatch(/mystery spice/);
    expect(msg).toMatch(/weird oil/);
    expect(msg).not.toMatch(/oats/);
    expect(msg).not.toMatch(/water/);
  });

  it('null/undefined rows → generic wording, never a crash', () => {
    expect(incompleteVerificationBlockMessageForRows(null)).toMatch(
      /unknown nutrition/,
    );
    expect(incompleteVerificationBlockMessageForRows(undefined)).toMatch(
      /unknown nutrition/,
    );
  });
});

describe('computeRecipeContentHash — v21.5 optimistic concurrency (pure)', () => {
  const BASE: RecipeContentSnapshot = {
    ingredients: [
      { name: 'oats', grams: 100 },
      { name: 'milk', grams: 200 },
    ],
    servings: 2,
    dietCategory: 'vegetarian',
    yieldGrams: 300,
    tags: ['high-protein'],
    allergens: ['milk'],
  };

  it('is deterministic: identical content → identical hash (64 hex chars)', () => {
    const h1 = computeRecipeContentHash(BASE);
    const h2 = computeRecipeContentHash(JSON.parse(JSON.stringify(BASE)));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes on an ingredient edit (grams changed)', () => {
    const edited: RecipeContentSnapshot = {
      ...BASE,
      ingredients: [
        { name: 'oats', grams: 100 },
        { name: 'milk', grams: 250 },
      ],
    };
    expect(computeRecipeContentHash(edited)).not.toBe(
      computeRecipeContentHash(BASE),
    );
  });

  it('changes on ingredient add/remove', () => {
    const added: RecipeContentSnapshot = {
      ...BASE,
      ingredients: [...BASE.ingredients, { name: 'honey', grams: 20 }],
    };
    const removed: RecipeContentSnapshot = {
      ...BASE,
      ingredients: [{ name: 'oats', grams: 100 }],
    };
    const base = computeRecipeContentHash(BASE);
    expect(computeRecipeContentHash(added)).not.toBe(base);
    expect(computeRecipeContentHash(removed)).not.toBe(base);
  });

  it('changes on servings / dietCategory / yieldGrams edits', () => {
    const base = computeRecipeContentHash(BASE);
    expect(
      computeRecipeContentHash({ ...BASE, servings: 4 }),
    ).not.toBe(base);
    expect(
      computeRecipeContentHash({ ...BASE, dietCategory: 'non_vegetarian' }),
    ).not.toBe(base);
    expect(
      computeRecipeContentHash({ ...BASE, yieldGrams: 350 }),
    ).not.toBe(base);
    expect(
      computeRecipeContentHash({ ...BASE, yieldGrams: null }),
    ).not.toBe(base);
  });

  it('changes on tag / allergen edits', () => {
    const base = computeRecipeContentHash(BASE);
    expect(
      computeRecipeContentHash({ ...BASE, tags: ['high-protein', 'low-sugar'] }),
    ).not.toBe(base);
    expect(computeRecipeContentHash({ ...BASE, allergens: [] })).not.toBe(
      base,
    );
  });

  it('is order-insensitive for ingredients, tags, and allergens', () => {
    const shuffled: RecipeContentSnapshot = {
      ...BASE,
      ingredients: [
        { name: 'milk', grams: 200 },
        { name: 'oats', grams: 100 },
      ],
      tags: ['b', 'a'],
      allergens: ['z', 'a'],
    };
    const ordered: RecipeContentSnapshot = {
      ...BASE,
      ingredients: [
        { name: 'oats', grams: 100 },
        { name: 'milk', grams: 200 },
      ],
      tags: ['a', 'b'],
      allergens: ['a', 'z'],
    };
    expect(computeRecipeContentHash(shuffled)).toBe(
      computeRecipeContentHash(ordered),
    );
  });

  it('canonicalizes case/whitespace (no spurious revision on cosmetic edits)', () => {
    const cosmetic: RecipeContentSnapshot = {
      ...BASE,
      ingredients: [
        { name: '  OATS ', grams: 100 },
        { name: 'Milk', grams: 200 },
      ],
      dietCategory: ' Vegetarian ',
      tags: [' High-Protein '],
      allergens: [' MILK'],
    };
    expect(computeRecipeContentHash(cosmetic)).toBe(
      computeRecipeContentHash(BASE),
    );
  });

  it('ignores duplicate tags/allergens (claim sets, not sequences)', () => {
    const duped: RecipeContentSnapshot = {
      ...BASE,
      tags: ['high-protein', 'high-protein'],
      allergens: ['milk', 'milk'],
    };
    expect(computeRecipeContentHash(duped)).toBe(
      computeRecipeContentHash(BASE),
    );
  });

  it('metadata-only content (e.g. a rename) has no representation in the hash input — stable by construction', () => {
    // The hash input (RecipeContentSnapshot) has no name/title/times/
    // instructions field at all: a metadata-only PATCH recomputes the
    // SAME hash, which is exactly how review/verification survive renames.
    // This test pins that the snapshot type admits no metadata fields.
    const snapshotKeys = Object.keys(BASE).sort();
    expect(snapshotKeys).toEqual(
      ['allergens', 'dietCategory', 'ingredients', 'servings', 'tags', 'yieldGrams'].sort(),
    );
  });
});

describe('computeRecipeContentHash + buildContentSnapshot — v21.6 expanded ingredient identity', () => {
  const BASE_IDENTITY: RecipeContentSnapshot = {
    ingredients: [
      { name: 'Peanut Butter', grams: 100, foodId: 'food-1', canonicalName: 'Peanut Butter' },
      { name: 'oats', grams: 50, foodId: 'food-2', canonicalName: 'Rolled Oats' },
    ],
    servings: 2,
    dietCategory: 'vegetarian',
    yieldGrams: null,
    tags: [],
    allergens: [],
  };

  it('two recipes with identical display names + grams but different foodIds produce DIFFERENT hashes', () => {
    const a: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: 'Peanut Butter', grams: 100, foodId: 'food-1', canonicalName: 'Peanut Butter' }],
    };
    const b: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: 'Peanut Butter', grams: 100, foodId: 'food-9', canonicalName: 'Peanut Butter' }],
    };
    expect(computeRecipeContentHash(a)).not.toBe(computeRecipeContentHash(b));
  });

  it('same content in a different row order → same hash (identity included)', () => {
    const shuffled: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [...BASE_IDENTITY.ingredients].reverse(),
    };
    expect(computeRecipeContentHash(shuffled)).toBe(
      computeRecipeContentHash(BASE_IDENTITY),
    );
  });

  it('missing identity falls back deterministically to the normalized display name', () => {
    const legacy: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: '  Oats ', grams: 100 }],
    };
    const nullIdentity: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: 'oats', grams: 100, foodId: null, canonicalName: null }],
    };
    const canonicalSameAsDisplay: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: 'oats', grams: 100, canonicalName: 'OATS' }],
    };
    const hLegacy = computeRecipeContentHash(legacy);
    expect(computeRecipeContentHash(nullIdentity)).toBe(hLegacy);
    expect(computeRecipeContentHash(canonicalSameAsDisplay)).toBe(hLegacy);
  });

  it('a display-name-only rename of the same canonical food IS a new revision (the display name is claim surface)', () => {
    const renamed: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [
        { name: 'nutty spread', grams: 100, foodId: 'food-1', canonicalName: 'Peanut Butter' },
        { name: 'oats', grams: 50, foodId: 'food-2', canonicalName: 'Rolled Oats' },
      ],
    };
    // The display name stays in the canonical form: the hash is revision
    // detection for optimistic concurrency ("someone edited this"), and a
    // rename is an edit. Evidence invalidation is NOT driven by the hash —
    // it stays governed by the material-change set (§1), where a
    // display-name-only rename is not material (same convention as
    // storedRowAllergenKey: canonicalName ?? name).
    expect(computeRecipeContentHash(renamed)).not.toBe(
      computeRecipeContentHash(BASE_IDENTITY),
    );
  });

  it('quantity/unit are included when present (validated: trimmed, lowercased)', () => {
    const withQty: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: 'Chicken thigh', grams: 800, quantity: '800 g' }],
    };
    const diffQty: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: 'Chicken thigh', grams: 800, quantity: '0.8 kg' }],
    };
    const cosmeticQty: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: 'Chicken thigh', grams: 800, quantity: '  800 G ' }],
    };
    const noQty: RecipeContentSnapshot = {
      ...BASE_IDENTITY,
      ingredients: [{ name: 'Chicken thigh', grams: 800 }],
    };
    expect(computeRecipeContentHash(withQty)).not.toBe(computeRecipeContentHash(diffQty));
    expect(computeRecipeContentHash(withQty)).not.toBe(computeRecipeContentHash(noQty));
    expect(computeRecipeContentHash(cosmeticQty)).toBe(computeRecipeContentHash(withQty));
  });

  it('buildContentSnapshot extracts identity + quantity from a stored record (seed-style rows)', () => {
    // Mirrors the real seed-library row shape: { name, quantity, grams }.
    const stored = {
      ingredients: [
        { name: 'Chicken thigh (raw)', quantity: '800 g', grams: 800 },
        { name: 'Salt', quantity: '1 tsp', grams: 6 },
      ],
      servings: 4,
      dietCategory: 'non_vegetarian',
      yieldGrams: 1200,
      tags: [],
      allergens: [],
    };
    const viaBuilder = computeRecipeContentHash(buildContentSnapshot(stored));
    const direct = computeRecipeContentHash({
      ...stored,
      ingredients: [
        { name: 'Chicken thigh (raw)', grams: 800, quantity: '800 g' },
        { name: 'Salt', grams: 6, quantity: '1 tsp' },
      ],
    });
    expect(viaBuilder).toBe(direct);
  });

  it('buildContentSnapshot extracts foodId/canonicalName from v21.6 stored rows', () => {
    const stored = {
      ingredients: [
        {
          name: 'nutty spread',
          foodId: 'food-1',
          canonicalName: 'Peanut Butter',
          aliases: ['pb'],
          grams: 100,
        },
      ],
      servings: 2,
      dietCategory: 'vegetarian',
      yieldGrams: null,
      tags: null,
      allergens: ['peanut'],
    };
    const snapshot = buildContentSnapshot(stored);
    expect(snapshot.ingredients).toHaveLength(1);
    expect(snapshot.ingredients[0]).toMatchObject({
      name: 'nutty spread',
      foodId: 'food-1',
      canonicalName: 'Peanut Butter',
      grams: 100,
    });
    // A same-named row with a DIFFERENT foodId must hash differently —
    // the builder must not drop identity.
    const other = buildContentSnapshot({
      ...stored,
      ingredients: [
        { name: 'nutty spread', foodId: 'food-9', canonicalName: 'Peanut Butter', grams: 100 },
      ],
    });
    expect(computeRecipeContentHash(other)).not.toBe(
      computeRecipeContentHash(snapshot),
    );
  });

  it('buildContentSnapshot is defensive: garbage JSON never throws, non-array ingredients → skipped by the backfill', () => {
    const snapshot = buildContentSnapshot({
      ingredients: { not: 'an array' },
      servings: 'two',
      dietCategory: null,
      yieldGrams: undefined,
      tags: 'nope',
      allergens: undefined,
    });
    expect(snapshot.ingredients).toEqual([]);
    expect(snapshot.servings).toBe(0);
    expect(snapshot.dietCategory).toBe('');
    // Non-object rows are dropped; rows without names need a foodId to survive.
    const mixed = buildContentSnapshot({
      ingredients: [null, 42, 'x', { name: '', grams: 1 }, { name: '', grams: 1, foodId: 'f1' }],
      servings: 1,
      dietCategory: 'vegetarian',
    });
    expect(computeRecipeContentHash(mixed)).toBe(
      computeRecipeContentHash(
        buildContentSnapshot({
          ingredients: [{ name: '', grams: 1, foodId: 'f1' }],
          servings: 1,
          dietCategory: 'vegetarian',
        }),
      ),
    );
  });
});

describe('computeRecipeContentHash — v21.7 fully deterministic ingredient sort (quantity/unit tie-break)', () => {
  const BASE_TIE: RecipeContentSnapshot = {
    ingredients: [
      // Both rows tie on foodId + canonicalName + name + grams; only
      // quantity/unit free text differs. Pre-v21.7 these kept their input
      // order (stable sort), so array order alone could change the hash.
      {
        name: 'Chicken thigh',
        grams: 800,
        foodId: 'food-1',
        canonicalName: 'Chicken Thigh',
        quantity: '800 g',
        unit: 'g',
      },
      {
        name: 'Chicken thigh',
        grams: 800,
        foodId: 'food-1',
        canonicalName: 'Chicken Thigh',
        quantity: '0.8 kg',
        unit: 'kg',
      },
    ],
    servings: 2,
    dietCategory: 'non_vegetarian',
    yieldGrams: null,
    tags: [],
    allergens: [],
  };

  it('same foodId + canonicalName + name + grams, different quantity/unit → reversed order → SAME hash', () => {
    const reversed: RecipeContentSnapshot = {
      ...BASE_TIE,
      ingredients: [...BASE_TIE.ingredients].reverse(),
    };
    expect(computeRecipeContentHash(reversed)).toBe(
      computeRecipeContentHash(BASE_TIE),
    );
  });

  it('three tied rows in every permutation → the same hash', () => {
    const row = (q: string, u: string) => ({
      name: 'Flour',
      grams: 500,
      foodId: 'food-7',
      canonicalName: 'Wheat Flour',
      quantity: q,
      unit: u,
    });
    const rows = [row('500 g', 'g'), row('0.5 kg', 'kg'), row('about half a kilo', undefined)];
    const mk = (order: number[]): RecipeContentSnapshot => ({
      servings: 4,
      dietCategory: 'vegetarian',
      yieldGrams: null,
      tags: [],
      allergens: [],
      ingredients: order.map((i) => rows[i]),
    });
    const expected = computeRecipeContentHash(mk([0, 1, 2]));
    expect(computeRecipeContentHash(mk([2, 1, 0]))).toBe(expected);
    expect(computeRecipeContentHash(mk([1, 0, 2]))).toBe(expected);
    expect(computeRecipeContentHash(mk([2, 0, 1]))).toBe(expected);
  });

  it('duplicate ingredient rows are deterministic (not dropped, not order-sensitive)', () => {
    const dup = (name: string, grams: number) => ({ name, grams });
    const a: RecipeContentSnapshot = {
      ingredients: [dup('Oats', 100), dup('Oats', 100), dup('Salt', 5)],
      servings: 1,
      dietCategory: 'vegetarian',
      yieldGrams: null,
      tags: [],
      allergens: [],
    };
    const b: RecipeContentSnapshot = {
      ...a,
      ingredients: [dup('Salt', 5), dup('Oats', 100), dup('Oats', 100)],
    };
    // Duplicates are preserved (the recipe really has two 100 g oat rows),
    // and any input order produces the same hash.
    expect(computeRecipeContentHash(b)).toBe(computeRecipeContentHash(a));
    // Sanity: two identical rows are still two rows — the payload carries
    // both, so the hash differs from a single row.
    const single: RecipeContentSnapshot = {
      ...a,
      ingredients: [dup('Oats', 100), dup('Salt', 5)],
    };
    expect(computeRecipeContentHash(a)).not.toBe(computeRecipeContentHash(single));
  });

  it('differing foodIds → different hashes (existing behavior kept)', () => {
    const mk = (foodId: string): RecipeContentSnapshot => ({
      ...BASE_TIE,
      ingredients: [
        {
          name: 'Chicken thigh',
          grams: 800,
          foodId,
          canonicalName: 'Chicken Thigh',
          quantity: '800 g',
          unit: 'g',
        },
      ],
    });
    expect(computeRecipeContentHash(mk('food-1'))).not.toBe(
      computeRecipeContentHash(mk('food-2')),
    );
  });

  it('differing grams → different hashes', () => {
    const mk = (grams: number): RecipeContentSnapshot => ({
      servings: 2,
      dietCategory: 'non_vegetarian',
      yieldGrams: null,
      tags: [],
      allergens: [],
      ingredients: [
        { name: 'Chicken thigh', grams, foodId: 'food-1', canonicalName: 'Chicken Thigh' },
      ],
    });
    expect(computeRecipeContentHash(mk(800))).not.toBe(
      computeRecipeContentHash(mk(801)),
    );
    // Float-format noise is still absorbed (round3 unchanged).
    expect(computeRecipeContentHash(mk(800.0001))).toBe(
      computeRecipeContentHash(mk(800)),
    );
  });

  it('legacy rows without foodId/canonicalName → deterministic, order-insensitive', () => {
    const a: RecipeContentSnapshot = {
      ingredients: [
        { name: '  Oats ', grams: 100, quantity: '1 cup' },
        { name: 'salt', grams: 5, unit: 'tsp' },
      ],
      servings: 1,
      dietCategory: 'vegetarian',
      yieldGrams: null,
      tags: [],
      allergens: [],
    };
    const b: RecipeContentSnapshot = {
      ...a,
      ingredients: [...a.ingredients].reverse(),
    };
    expect(computeRecipeContentHash(b)).toBe(computeRecipeContentHash(a));
  });

  it('quantity/unit differences are distinguishable in the payload (verified, not just the sort)', () => {
    const mk = (quantity?: string, unit?: string): RecipeContentSnapshot => ({
      servings: 1,
      dietCategory: 'vegetarian',
      yieldGrams: null,
      tags: [],
      allergens: [],
      ingredients: [{ name: 'Flour', grams: 500, quantity, unit }],
    });
    // Same sort position (no ties here — single row), different payload.
    expect(computeRecipeContentHash(mk('500 g', 'g'))).not.toBe(
      computeRecipeContentHash(mk('0.5 kg', 'kg')),
    );
    expect(computeRecipeContentHash(mk('500 g', 'g'))).not.toBe(
      computeRecipeContentHash(mk()),
    );
  });
});

describe('isomorphic import guard', () => {  it('has no node: imports — the module is barrel-exported to client pages', async () => {
    // A top-level `node:crypto` import here broke `next build` with
    // webpack UnhandledSchemeError (import trace: fasting/page.tsx →
    // @fitfusion/core → recipe-governance.js). The SHA-256 is pure TS.
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'recipe-governance.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]node:/);
    expect(src).not.toMatch(/require\(\s*['"]node:/);
  });
});
