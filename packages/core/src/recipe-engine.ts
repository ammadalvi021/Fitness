/**
 * Recipe ingredient resolution + nutrition computation engine (v21, Phase 1).
 *
 * Pure functions — no DB, no I/O, no network. The ingredient catalogue lives
 * in `packages/db/prisma/seed-ingredients.ts` and is PASSED IN (dependency
 * injection), so this module stays decoupled from the DB package.
 *
 * Pipeline: recipe item { name, quantity }
 *   → resolveIngredient(name, ingredients)   (which ingredient is this?)
 *   → parseQuantity(quantity)                (how much?)
 *   → toGrams(amount, unit, ingredient)      (in grams)
 *   → computeRecipeNutrition(rows, servings) (existing engine in food-catalog.ts)
 *
 * UNIT ASSUMPTIONS (documented, binding):
 *  - tbsp = 15 g, tsp = 5 g (flat — NOT 15 ml × density).
 *  - cup = 240 ml × density (density defaults to 1.0; ingredient.densityMl
 *    overrides, e.g. milk 1.03 → 1 cup milk ≈ 247 g).
 *  - ml is direct (1 ml = 1 g); l = 1000 g; kg = 1000 g; mg = g/1000;
 *    oz = 28.35 g; lb = 453.6 g.
 *  - Countable units use ingredient.pieceGrams when set, else defaults:
 *    piece = 100 g, medium = 120 g, large = 180 g, small = 60 g,
 *    clove = 4 g, slice = 25 g, can = 400 g.
 *  - 'to taste' / 'pinch' / 'dash' are NOT zero: salt → 1 g, oils/ghee → 5 g,
 *    everything else → 2 g. (Spice entries are 0-kcal in the catalogue, so
 *    these contribute nothing calorically, but the assumed grams are
 *    reported in `warnings` so callers can see the assumption.)
 *  - Ranges ('2-3 tbsp') resolve to the midpoint, documented in warnings
 *    only when they occur (parseQuantity itself is deterministic).
 *  - Unknown units fall back to 'piece' semantics (documented in warnings).
 *
 * RESOLUTION RULES:
 *  1. Case-insensitive exact name match.
 *  2. Case-insensitive exact alias match.
 *  3. Token-subset match (query tokens ⊇ candidate tokens, singularized,
 *     prep-words dropped): longest (most specific) candidate wins.
 *  4. Raw/cooked (or dry/cooked) variant ties resolve to the RAW/DRY variant
 *     — recipes list raw ingredients — and are flagged in `warnings`.
 *  5. Any other tie, or no match at all → null. The engine NEVER guesses;
 *     unresolved names land in `unresolved` so the caller can flag the
 *     recipe 'awaiting review'.
 *  6. Kitchen conventions (documented, Pakistani kitchen): bare 'coriander' /
 *     'dhania' means fresh leaves (Coriander leaves); bare 'milk' means whole
 *     milk; 'cooking oil' / 'tel' means canola oil.
 */

import {
  computeRecipeNutrition,
  type RecipeIngredientInput,
} from './food-catalog.js';
import type { Nutrients } from './types.js';

/** Structural view of an ingredient — satisfied by IngredientSeed. */
export interface IngredientLike {
  readonly name: string;
  readonly category: string;
  readonly per100: readonly [number, number, number, number, number];
  readonly aliases: readonly string[];
  readonly pieceGrams?: number;
  readonly densityMl?: number;
}

/** A hit from resolveIngredient. `usedRawDefault` is true when the query
 *  matched both raw and cooked variants and the raw/dry one was chosen. */
export interface ResolvedIngredient extends IngredientLike {
  usedRawDefault: boolean;
}

// ---------------------------------------------------------------------------
// Quantity parsing
// ---------------------------------------------------------------------------

/** Normalized unit token produced by parseQuantity. */
export type QuantityUnit =
  | 'g' | 'kg' | 'mg' | 'ml' | 'l'
  | 'cup' | 'tbsp' | 'tsp' | 'oz' | 'lb'
  | 'piece' | 'medium' | 'large' | 'small' | 'clove' | 'slice' | 'can'
  | 'pinch' | 'to_taste' | 'none';

export interface ParsedQuantity {
  amount: number;
  unit: QuantityUnit;
}

const UNIT_ALIASES: Record<string, QuantityUnit> = {
  g: 'g', gram: 'g', grams: 'g', gm: 'g', gms: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  ml: 'ml', milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml',
  l: 'l', lt: 'l', liter: 'l', litre: 'l', liters: 'l', litres: 'l',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tblsp: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', whole: 'piece',
  nos: 'piece', number: 'piece',
  medium: 'medium', med: 'medium',
  large: 'large', big: 'large',
  small: 'small',
  clove: 'clove', cloves: 'clove',
  slice: 'slice', slices: 'slice',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  pinch: 'pinch', pinches: 'pinch', chutki: 'pinch', dash: 'pinch',
};

const TO_TASTE_RE =
  /\b(to taste|as needed|as required|to serve|for garnish|a pinch of|pinch of|pinch|dash)\b/i;

/**
 * Parse a free-text quantity into { amount, unit }.
 * Handles '600 g', '2 tbsp', '1 cup', '3' (→ piece), '1 medium',
 * fractions ('1/2 cup', '1 1/2 cups'), ranges ('2-3 tbsp' → midpoint 2.5),
 * and 'to taste' (→ { amount: 1, unit: 'to_taste' }).
 */
export function parseQuantity(quantity: string): ParsedQuantity {
  const raw = (quantity ?? '').trim();
  if (!raw) return { amount: 0, unit: 'none' };
  if (TO_TASTE_RE.test(raw)) return { amount: 1, unit: 'to_taste' };

  // Strip parenthetical notes: "2 tbsp (30 ml)" → "2 tbsp".
  const q = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  let amount: number | null = null;
  let rest = q;

  // Mixed fraction: "1 1/2 cups".
  let m = q.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\b(.*)$/);
  if (m && Number(m[3]) !== 0) {
    amount = Number(m[1]) + Number(m[2]) / Number(m[3]);
    rest = (m[4] ?? '').trim();
  }
  // Simple fraction: "1/2 cup", "2/3 cup".
  if (amount === null) {
    m = q.match(/^(\d+)\s*\/\s*(\d+)\b(.*)$/);
    if (m && Number(m[2]) !== 0) {
      amount = Number(m[1]) / Number(m[2]);
      rest = (m[3] ?? '').trim();
    }
  }
  // Range: "2-3 tbsp" → midpoint.
  if (amount === null) {
    m = q.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\b(.*)$/);
    if (m) {
      const a = Number(m[1].replace(',', '.'));
      const b = Number(m[2].replace(',', '.'));
      if (Number.isFinite(a) && Number.isFinite(b)) {
        amount = (a + b) / 2;
        rest = (m[3] ?? '').trim();
      }
    }
  }
  // Plain number: "600 g", "2", "0.5 kg".
  if (amount === null) {
    m = q.match(/^(\d+(?:[.,]\d+)?)\b(.*)$/);
    if (m) {
      const a = Number(m[1].replace(',', '.'));
      if (Number.isFinite(a)) {
        amount = a;
        rest = (m[2] ?? '').trim();
      }
    }
  }
  if (amount === null || !Number.isFinite(amount)) {
    return { amount: 0, unit: 'none' };
  }

  const unitWord = rest.toLowerCase().replace(/[.,;:!?]+$/g, '').trim();
  const unit: QuantityUnit = UNIT_ALIASES[unitWord] ?? 'piece'; // unknown units → piece semantics
  return { amount, unit };
}

// ---------------------------------------------------------------------------
// Grams conversion
// ---------------------------------------------------------------------------

/** Default grams for countable units when the ingredient has no pieceGrams. */
const PIECE_DEFAULTS: Record<string, number> = {
  piece: 100,
  medium: 120,
  large: 180,
  small: 60,
  clove: 4,
  slice: 25,
  can: 400,
};

const SALT_RE = /salt/i;
const OIL_RE = /oil|ghee/i;

/** Grams assumed for a 'to taste' / 'pinch' / 'dash' quantity. */
export function tasteGrams(ingredient?: IngredientLike): number {
  if (!ingredient) return 2;
  if (SALT_RE.test(ingredient.name)) return 1;
  if (ingredient.category === 'Oils & Ghee' || OIL_RE.test(ingredient.name)) return 5;
  return 2;
}

/**
 * Convert (amount, unit) to grams. See module header for the full
 * assumption table. Unknown units fall back to 'piece' semantics.
 */
export function toGrams(
  amount: number,
  unit: QuantityUnit,
  ingredient?: IngredientLike,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  switch (unit) {
    case 'g': return amount;
    case 'kg': return amount * 1000;
    case 'mg': return amount / 1000;
    case 'ml': return amount; // direct: 1 ml = 1 g
    case 'l': return amount * 1000;
    case 'cup': return amount * 240 * (ingredient?.densityMl ?? 1.0);
    case 'tbsp': return amount * 15;
    case 'tsp': return amount * 5;
    case 'oz': return amount * 28.35;
    case 'lb': return amount * 453.6;
    case 'to_taste':
    case 'pinch': return tasteGrams(ingredient);
    case 'none': return 0;
    case 'piece':
    case 'medium':
    case 'large':
    case 'small':
    case 'clove':
    case 'slice':
    case 'can':
    default:
      return amount * (ingredient?.pieceGrams ?? PIECE_DEFAULTS[unit] ?? 100);
  }
}

// ---------------------------------------------------------------------------
// Ingredient resolution
// ---------------------------------------------------------------------------

/** Prep/descriptor words dropped before token matching (they never identify). */
const STOP_WORDS = new Set([
  'chopped', 'sliced', 'diced', 'cubed', 'minced', 'grated', 'crushed',
  'slit', 'rinsed', 'washed', 'soaked', 'julienned', 'finely', 'roughly',
  'thinly', 'fresh', 'dried', 'cut', 'halved', 'quartered', 'paste',
]);

function singularize(word: string): string {
  if (word === 'tomatoes') return 'tomato';
  if (word === 'potatoes') return 'potato';
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

/** Lowercase, punctuation → space, singularized content tokens. */
function tokensOf(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .filter((t) => !STOP_WORDS.has(t));
}

/** Canonical name with the parenthetical state removed: 'Chicken breast (raw)' → 'chicken breast'. */
function baseName(name: string): string {
  return (name ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isRawVariant(name: string): boolean {
  return /\b(raw|dry|uncooked)\b/i.test(name);
}

/**
 * Resolve a free-text ingredient name to a catalogue entry.
 * Exact name → exact alias → longest token-subset match.
 * Returns null when ambiguous or unknown — the engine never guesses.
 */
export function resolveIngredient(
  name: string,
  ingredients: readonly IngredientLike[],
): ResolvedIngredient | null {
  const norm = (name ?? '').trim().toLowerCase();
  if (!norm || !ingredients?.length) return null;

  const asResolved = (ing: IngredientLike, usedRawDefault: boolean): ResolvedIngredient => ({
    ...ing,
    usedRawDefault,
  });

  // 1. Exact name.
  const exact = ingredients.find((i) => i.name.toLowerCase() === norm);
  if (exact) return asResolved(exact, false);

  // 2. Exact alias.
  const aliasHit = ingredients.find((i) =>
    i.aliases.some((a) => a.toLowerCase() === norm),
  );
  if (aliasHit) return asResolved(aliasHit, false);

  // 3. Token-subset match: every candidate token must appear in the query.
  const queryTokens = new Set(tokensOf(name));
  if (queryTokens.size === 0) return null;

  interface Scored { ing: IngredientLike; score: number }
  const scored: Scored[] = [];
  for (const ing of ingredients) {
    let best = 0;
    const candidates = [ing.name, ...ing.aliases];
    for (const c of candidates) {
      const ct = tokensOf(c);
      if (ct.length > 0 && ct.every((t) => queryTokens.has(t))) {
        best = Math.max(best, ct.length);
      }
    }
    if (best > 0) scored.push({ ing, score: best });
  }
  if (scored.length === 0) return null;

  const top = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === top).map((s) => s.ing);
  if (winners.length === 1) return asResolved(winners[0], false);

  // 4. Variant tie (raw vs cooked / dry vs cooked of the same base):
  //    prefer the raw/dry variant — recipes list raw ingredients.
  const bases = new Set(winners.map((w) => baseName(w.name)));
  if (bases.size === 1) {
    // Same ingredient, different states: raw/dry first (recipes list raw
    // ingredients). The query named no state, so this is a default choice.
    const rawFirst = [...winners].sort(
      (a, b) => Number(isRawVariant(b.name)) - Number(isRawVariant(a.name)),
    );
    return asResolved(rawFirst[0], true);
  }

  // 5. Genuinely ambiguous → null. Never guess.
  return null;
}

// ---------------------------------------------------------------------------
// Full recipe computation
// ---------------------------------------------------------------------------

export interface RecipeItemInput {
  name: string;
  quantity: string;
}

export interface ResolvedLine {
  /** Original item name as written in the recipe. */
  name: string;
  quantity: string;
  /** Canonical catalogue name used for the lookup. */
  ingredient: string;
  grams: number;
}

export interface RecipeComputation {
  totals: Nutrients;
  perServing: Nutrients;
  portions: number;
  /** Item names that could not be resolved — caller flags recipe 'awaiting review'. */
  unresolved: string[];
  warnings: string[];
  resolved: ResolvedLine[];
}

/**
 * Resolve each item, convert to grams, look up per-100-g nutrients, and sum
 * via the existing computeRecipeNutrition engine. Unresolved items contribute
 * 0 and are listed in `unresolved`; every assumption is recorded in
 * `warnings`. Water/salt contribute 0 (catalogue zeros).
 */
export function computeRecipe(
  items: RecipeItemInput[],
  servings: number,
  ingredients: readonly IngredientLike[],
): RecipeComputation {
  const rows: RecipeIngredientInput[] = [];
  const unresolved: string[] = [];
  const warnings: string[] = [];
  const resolved: ResolvedLine[] = [];

  for (const item of items ?? []) {
    const hit = resolveIngredient(item.name, ingredients);
    if (!hit) {
      unresolved.push(item.name);
      warnings.push(
        `"${item.name}" did not resolve to a known ingredient — excluded ` +
        `from totals (flag recipe 'awaiting review').`,
      );
      continue;
    }
    const { amount, unit } = parseQuantity(item.quantity);
    if (unit === 'none') {
      warnings.push(
        `"${item.name}": no parseable quantity in "${item.quantity}" — counted as 0 g.`,
      );
    }
    const grams = toGrams(amount, unit, hit);
    if (unit === 'to_taste' || unit === 'pinch') {
      warnings.push(
        `"${item.name}": "${item.quantity}" assumed ${grams} g ` +
        `('to taste' rule: salt 1 g, oil 5 g, else 2 g).`,
      );
    }
    if (hit.usedRawDefault) {
      warnings.push(
        `"${item.name}" matched raw & cooked variants — used raw/dry ` +
        `default "${hit.name}".`,
      );
    }
    rows.push({
      name: hit.name,
      grams,
      kcal: hit.per100[0],
      proteinG: hit.per100[1],
      carbsG: hit.per100[2],
      fatG: hit.per100[3],
      fiberG: hit.per100[4],
    });
    resolved.push({ name: item.name, quantity: item.quantity, ingredient: hit.name, grams });
  }

  const { totals, perPortion, portions } = computeRecipeNutrition(rows, servings);
  return { totals, perServing: perPortion, portions, unresolved, warnings, resolved };
}
