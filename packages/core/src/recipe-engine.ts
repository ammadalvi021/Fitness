/**
 * Recipe ingredient resolution + nutrition computation engine (v21, Phase 1;
 * v21.2 unit/volume correctness rework).
 *
 * Pure functions — no DB, no I/O, no network. The ingredient catalogue lives
 * in `packages/db/prisma/seed-ingredients.ts` and is PASSED IN (dependency
 * injection), so this module stays decoupled from the DB package.
 *
 * Pipeline: recipe item { name, quantity }
 *   → resolveIngredient(name, ingredients)   (which ingredient is this?)
 *   → parseQuantity(quantity)                (how much?)
 *   → toGrams(amount, unit, ingredient)      (in grams, or UNKNOWN)
 *   → computeRecipeNutrition(rows, servings) (existing engine in food-catalog.ts)
 *
 * UNIT ASSUMPTIONS (documented, binding):
 *  - MASS units convert directly, ingredient-independent:
 *    g, kg (= 1000 g), mg (= g/1000), oz (= 28.35 g), lb (= 453.6 g).
 *  - VOLUME units convert via millilitres × ingredient-specific density
 *    (g/ml): cup = 240 ml, tbsp = 15 ml, tsp = 5 ml, fl oz = 29.5735 ml,
 *    l = 1000 ml, ml direct. Density priority: ingredient.densityMl
 *    (catalogue-authoritative) → the documented density table
 *    (packages/core/src/density.ts — every value carries its basis) →
 *    UNKNOWN. There is NO 1.0 fallback: 1 ml = 1 g only where documented
 *    (water). 1 tbsp of oil (≈13.8 g) ≠ 1 tbsp of flour (≈7.8 g).
 *    Exception: catalogue entries recorded as 0 kcal/100 g (plain spices
 *    etc., by documented design decision) count volume quantities as 0 g
 *    with a visible warning — their grams are nutritionally irrelevant,
 *    so a pinch of turmeric never flags a recipe incomplete.
 *  - Countable units use ingredient.pieceGrams when set (authoritative);
 *    otherwise the documented generic defaults below, recorded in
 *    `warnings` so the assumption is visible:
 *    piece = 100 g, medium = 120 g, large = 180 g, small = 60 g,
 *    clove = 4 g, slice = 25 g, can = 400 g.
 *  - A bare number ("3") means pieces (documented convention). An
 *    UNRECOGNIZED unit word ("3 blargs") is NOT piece — it is an explicit
 *    unknown-quantity result with a surfaced warning. No silent fallback.
 *  - Ranges ("2-3 tbsp") are NOT midpointed — they are explicit
 *    unknown-quantity results (the midpoint was a guess, and guesses are
 *    what v21.2 removed).
 *  - Fractions WITH a unit ("1/2 cup", "1 1/2 cups") parse to the fraction.
 *    A BARE fraction ("1/2", no unit) is unknown — the old code silently
 *    called it half a piece.
 *  - 'to taste' / 'pinch' / 'dash' are a known list, not zero: salt → 1 g,
 *    oils/ghee → 5 g, everything else → 2 g — always reported in
 *    `warnings` so the assumption stays visible.
 *  - No false precision: resolved grams are rounded to 1 decimal place.
 *
 * RESOLUTION RULES: (unchanged from v21 — see below)
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
 *
 * COMPLETENESS: `computeRecipe` returns `complete: false` whenever any item
 * is unresolved OR its quantity could not be interpreted OR its grams are
 * unknown. A partial calculation is NEVER marked complete.
 */

import {
  computeRecipeNutrition,
  type RecipeIngredientInput,
} from './food-catalog.js';
import { lookupDensity, ML_PER_UNIT } from './density.js';
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
  | 'cup' | 'tbsp' | 'tsp' | 'fl_oz' | 'oz' | 'lb'
  | 'piece' | 'medium' | 'large' | 'small' | 'clove' | 'slice' | 'can'
  | 'pinch' | 'to_taste' | 'none';

/** Why a quantity could not be interpreted — present only on ParsedQuantity.unknown. */
export type QuantityUnknownReason =
  | 'range'
  | 'unrecognized-unit'
  | 'unparseable'
  | 'bare-fraction';

export interface ParsedQuantity {
  amount: number;
  unit: QuantityUnit;
  /**
   * Present when the quantity could not be interpreted. The caller must
   * surface a warning and mark nutrition incomplete — never treat the
   * amount as grams or pieces.
   */
  unknown?: QuantityUnknownReason;
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
  'fl oz': 'fl_oz', 'fl-oz': 'fl_oz', floz: 'fl_oz', 'fluid ounce': 'fl_oz', 'fluid ounces': 'fl_oz',
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
 * Handles '600 g', '2 tbsp', '1 cup', '3' (→ piece, documented convention),
 * '1 medium', fractions WITH a unit ('1/2 cup', '1 1/2 cups'), and the known
 * 'to taste' / 'pinch' / 'dash' list.
 *
 * Explicitly UNKNOWN (never silently converted):
 *  - ranges ('2-3 tbsp') → unknown: 'range'
 *  - bare fractions ('1/2' with no unit) → unknown: 'bare-fraction'
 *  - unrecognized unit words ('3 blargs') → unknown: 'unrecognized-unit'
 *  - text with no parseable number ('a handful') → unknown: 'unparseable'
 *  - empty string → { amount: 0, unit: 'none' } (no unknown — nothing asked)
 */
export function parseQuantity(quantity: string): ParsedQuantity {
  const raw = (quantity ?? '').trim();
  if (!raw) return { amount: 0, unit: 'none' };
  if (TO_TASTE_RE.test(raw)) return { amount: 1, unit: 'to_taste' };

  // Strip parenthetical notes: "2 tbsp (30 ml)" → "2 tbsp".
  const q = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  // Range: "2-3 tbsp" → UNKNOWN (v21.2: the midpoint was a guess).
  const range = q.match(/^\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\b/);
  if (range) {
    return { amount: 0, unit: 'none', unknown: 'range' };
  }

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
    return { amount: 0, unit: 'none', unknown: 'unparseable' };
  }

  const unitWord = rest.toLowerCase().replace(/[.,;:!?]+$/g, '').trim();

  // Bare fraction ("1/2" with no unit): the old code silently called this
  // half a piece. It is unknown.
  if (!unitWord && /^\d+\s*\/\s*\d+$/.test(q.replace(/\s+/g, ' '))) {
    return { amount: 0, unit: 'none', unknown: 'bare-fraction' };
  }

  // Bare number → pieces (documented convention, kept).
  if (!unitWord) {
    return { amount, unit: 'piece' };
  }

  const unit = UNIT_ALIASES[unitWord];
  if (!unit) {
    // Unrecognized unit word: NOT piece. Explicit unknown.
    return { amount, unit: 'none', unknown: 'unrecognized-unit' };
  }
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

/** MASS units convert directly, ingredient-independent. */
const MASS_TO_G: Record<string, number> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  oz: 28.35,
  lb: 453.6,
};

const VOLUME_UNITS = new Set(['ml', 'l', 'cup', 'tbsp', 'tsp', 'fl_oz']);

export interface GramsResult {
  /**
   * Grams, or null when the quantity cannot be converted to grams with the
   * available information (e.g. a volume of an ingredient with no
   * documented density). Null is UNKNOWN — the caller marks nutrition
   * incomplete. Never null-guessed to a number.
   */
  grams: number | null;
  /** Documented assumptions applied (generic defaults, density basis, …). */
  warnings: string[];
}

/**
 * Convert (amount, unit) to grams. Volume units go through ml ×
 * ingredient-specific density; unknown density → { grams: null }.
 * Every assumption is reported in `warnings` so callers can surface it.
 */
export function toGrams(
  amount: number,
  unit: QuantityUnit,
  ingredient?: IngredientLike,
): GramsResult {
  const warnings: string[] = [];
  const who = ingredient ? `"${ingredient.name}"` : 'the ingredient';
  if (!Number.isFinite(amount) || amount <= 0) return { grams: 0, warnings };

  if (unit in MASS_TO_G) {
    return { grams: amount * MASS_TO_G[unit], warnings };
  }

  if (VOLUME_UNITS.has(unit)) {
    const ml = amount * (ML_PER_UNIT[unit] ?? 1);
    const table = ingredient ? lookupDensity(ingredient.name) : null;
    const density = ingredient?.densityMl ?? table?.density ?? null;
    if (density == null) {
      // v21.2: the catalogue records some items (plain spices etc.) as
      // 0 kcal/100 g by documented design decision. For those, grams are
      // nutritionally irrelevant — count 0 g with a visible warning rather
      // than flagging a whole recipe incomplete over 1/2 tsp of turmeric.
      // This is NOT a 1.0 fallback: it applies only to proven-zero
      // catalogue entries, and the assumption is always reported.
      if (ingredient && ingredient.per100.every((v) => v === 0)) {
        warnings.push(
          `"${ingredient.name}": catalogue records 0 kcal/100 g — ` +
          `${amount} ${unit} is nutritionally irrelevant, counted as 0 g (not estimated).`,
        );
        return { grams: 0, warnings };
      }
      return {
        grams: null,
        warnings: [
          `${who}: ${amount} ${unit} is a volume measure but no density is documented — grams unknown (marked incomplete, not assumed 1 g/ml).`,
        ],
      };
    }
    if (table && ingredient?.densityMl == null) {
      warnings.push(
        `${who}: ${amount} ${unit} → g via density ${density} g/ml (${table.basis}).`,
      );
    }
    return { grams: ml * density, warnings };
  }

  switch (unit) {
    case 'to_taste':
    case 'pinch': {
      const g = tasteGrams(ingredient);
      warnings.push(
        `${who}: "to taste"/"pinch" assumed ${g} g ('to taste' rule: salt 1 g, oil 5 g, else 2 g).`,
      );
      return { grams: g, warnings };
    }
    case 'none':
      return { grams: 0, warnings };
    case 'piece':
    case 'medium':
    case 'large':
    case 'small':
    case 'clove':
    case 'slice':
    case 'can':
    default: {
      const pieceGrams = ingredient?.pieceGrams;
      if (pieceGrams != null) {
        return { grams: amount * pieceGrams, warnings };
      }
      const def = PIECE_DEFAULTS[unit] ?? 100;
      warnings.push(
        `${who}: ${amount} ${unit} assumed ${amount * def} g — generic default (${def} g/${unit}), not ingredient-specific.`,
      );
      return { grams: amount * def, warnings };
    }
  }
}

/** Round to 1 decimal — no false precision beyond kitchen-scale reality. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Ingredient resolution (unchanged from v21)
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
  /** Grams (rounded to 1 decimal; 0 when the quantity was unknown). */
  grams: number;
}

export interface RecipeComputation {
  totals: Nutrients;
  perServing: Nutrients;
  portions: number;
  /** Item names that could not be resolved — caller flags recipe 'awaiting review'. */
  unresolved: string[];
  /**
   * Item names excluded from totals because their quantity could not be
   * interpreted or their grams were unknown. Also forces `complete: false`.
   */
  incomplete: string[];
  /**
   * True only when every item resolved AND every quantity was interpreted
   * with known grams. A partial calculation is never marked complete.
   */
  complete: boolean;
  warnings: string[];
  resolved: ResolvedLine[];
}

/**
 * Resolve each item, convert to grams, look up per-100-g nutrients, and sum
 * via the existing computeRecipeNutrition engine. Unresolved items and
 * un-interpretable quantities contribute 0 and are listed in `unresolved` /
 * `incomplete`; every assumption is recorded in `warnings`. Water/salt
 * contribute 0 (catalogue zeros).
 */
export function computeRecipe(
  items: RecipeItemInput[],
  servings: number,
  ingredients: readonly IngredientLike[],
): RecipeComputation {
  const rows: RecipeIngredientInput[] = [];
  const unresolved: string[] = [];
  const incomplete: string[] = [];
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
    const parsed = parseQuantity(item.quantity);
    if (parsed.unknown) {
      incomplete.push(item.name);
      const why =
        parsed.unknown === 'range'
          ? `a range ("${item.quantity}") — ranges are not midpointed, ask for one value`
          : parsed.unknown === 'unrecognized-unit'
            ? `an unrecognized unit in "${item.quantity}"`
            : parsed.unknown === 'bare-fraction'
              ? `a bare fraction ("${item.quantity}") with no unit`
              : `no parseable quantity in "${item.quantity}"`;
      warnings.push(`"${item.name}": ${why} — nutrition marked incomplete.`);
      resolved.push({ name: item.name, quantity: item.quantity, ingredient: hit.name, grams: 0 });
      continue;
    }
    const conv = toGrams(parsed.amount, parsed.unit, hit);
    warnings.push(...conv.warnings);
    if (conv.grams == null) {
      incomplete.push(item.name);
      warnings.push(
        `"${item.name}": grams could not be determined — nutrition marked incomplete.`,
      );
      resolved.push({ name: item.name, quantity: item.quantity, ingredient: hit.name, grams: 0 });
      continue;
    }
    const grams = round1(conv.grams);
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
  const complete = unresolved.length === 0 && incomplete.length === 0;
  return { totals, perServing: perPortion, portions, unresolved, incomplete, complete, warnings, resolved };
}
