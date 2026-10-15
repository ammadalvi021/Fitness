/**
 * P1 — canonical gram-per-serving normalization for Food rows.
 *
 * The custom-recipe per-100-g factor was `100 / food.servingSize`, which is
 * only valid when servingSize is grams. For count servings (chapati
 * servingSize: 1) or volume servings (milk servingSize: 250 ml) it produces
 * wildly wrong per-100-g nutrients (chapati computed as 9000 kcal/100 g).
 *
 * Normalization priority (binding):
 *   1. Explicit `servingWeightG` on the Food row (canonical, seeded for all
 *      known count/volume foods).
 *   2. Gram-equivalent parsed from `servingUnit`, e.g. "piece (30g)" → 30.
 *      Parenthetical annotations only — never a bare number elsewhere.
 *   3. Mass servingUnit (starts with g/kg/mg): servingSize is already grams.
 *   4. Volume servingUnit (ml/cup/tbsp/…): servingSize × ingredient-specific
 *      density (see density.ts). No density → UNKNOWN.
 *   5. Anything else → UNKNOWN. The caller marks the food's nutrition
 *      contribution INCOMPLETE and surfaces a warning. Never guess.
 */

import { lookupDensity } from './density.js';

export interface FoodServingLike {
  name: string;
  servingSize: number;
  servingUnit: string;
  /** Canonical grams per serving — nullable column added in v21.2. */
  servingWeightG?: number | null;
}

export type ServingBasis =
  | 'explicit'
  | 'serving-unit-annotation'
  | 'mass'
  | 'volume-density';

export interface ServingGramsResult {
  /** Grams (or gram-equivalent) per serving. Null = unknown, never guessed. */
  grams: number | null;
  basis: ServingBasis | null;
  /** Human-readable explanation of how `grams` was derived. */
  detail: string;
  /** Present when grams is null — the caller must surface this. */
  warning?: string;
}

/** Parenthetical gram annotation: "piece (30g)", "large eggs (100g)", "medium (120g)". */
const GRAM_ANNOTATION_RE = /\(\s*(\d+(?:\.\d+)?)\s*g\s*\)/i;

/** "1 cup", "2 tbsp", "250 ml" — volume units we can multiply by density. */
const VOLUME_UNIT_RE = /\b(ml|l|cup|cups|tbsp|tbsps?|tsp|tsps?|fl[\s-]?oz)\b/i;

const MASS_UNIT_RE = /^\s*(g|kg|mg)\b/i;

function isMassUnit(unit: string): boolean {
  return MASS_UNIT_RE.test(unit);
}

function hasVolumeUnit(unit: string): boolean {
  return VOLUME_UNIT_RE.test(unit);
}

/**
 * Resolve a Food's serving to grams per serving. Pure — works on the shape,
 * so the web API, the seed verifier, and tests share one implementation.
 */
export function resolveServingGrams(food: FoodServingLike): ServingGramsResult {
  const { name, servingSize, servingUnit } = food;
  const label = `"${name}"`;

  // 1. Explicit canonical weight — authoritative.
  if (food.servingWeightG != null && Number.isFinite(food.servingWeightG) && food.servingWeightG > 0) {
    return {
      grams: food.servingWeightG,
      basis: 'explicit',
      detail: `${label}: servingWeightG = ${food.servingWeightG} g (explicit, canonical).`,
    };
  }

  // 2. Gram-equivalent parsed from the servingUnit annotation.
  const ann = servingUnit.match(GRAM_ANNOTATION_RE);
  if (ann) {
    const g = Number(ann[1]);
    if (Number.isFinite(g) && g > 0) {
      return {
        grams: g,
        basis: 'serving-unit-annotation',
        detail: `${label}: servingUnit "${servingUnit}" annotates ${g} g per serving.`,
      };
    }
  }

  // 3. Mass unit — servingSize is already grams (or kg/mg, converted).
  if (isMassUnit(servingUnit)) {
    const m = servingUnit.match(MASS_UNIT_RE);
    const unit = (m?.[1] ?? 'g').toLowerCase();
    const grams = unit === 'kg' ? servingSize * 1000 : unit === 'mg' ? servingSize / 1000 : servingSize;
    return {
      grams,
      basis: 'mass',
      detail: `${label}: servingUnit "${servingUnit}" is a mass unit — servingSize ${servingSize} ${unit} = ${grams} g.`,
    };
  }

  // 4. Volume unit — needs an ingredient-specific density.
  if (hasVolumeUnit(servingUnit)) {
    const vol = VOLUME_UNIT_RE.exec(servingUnit)?.[1]?.toLowerCase().replace(/[\s-]/g, '') ?? 'ml';
    const mlPer: Record<string, number> = {
      ml: 1, l: 1000, cup: 240, cups: 240,
      tbsp: 15, tbsps: 15, tsp: 5, tsps: 5, floz: 29.5735,
    };
    const ml = servingSize * (mlPer[vol] ?? 1);
    const d = lookupDensity(name);
    if (!d) {
      return {
        grams: null,
        basis: null,
        detail: `${label}: volume serving "${servingSize} ${servingUnit}" but no documented density.`,
        warning: `${label}: serving is a volume (${servingUnit}) with no documented density — nutrition contribution marked INCOMPLETE, not guessed.`,
      };
    }
    const grams = ml * d.density;
    return {
      grams,
      basis: 'volume-density',
      detail: `${label}: ${servingSize} ${servingUnit} ≈ ${ml} ml × ${d.density} g/ml (${d.basis}) = ${grams.toFixed(1)} g.`,
    };
  }

  // 5. Unknown / ambiguous — never guess.
  return {
    grams: null,
    basis: null,
    detail: `${label}: serving "${servingSize} ${servingUnit}" cannot be converted to grams.`,
    warning: `${label}: serving weight unknown ("${servingSize} ${servingUnit}") — nutrition contribution marked INCOMPLETE, not guessed.`,
  };
}

/**
 * The per-100-g factor used to convert a Food's per-serving nutrients to
 * per-100-g. Returns null when the serving weight is unknown — the caller
 * must mark the contribution INCOMPLETE, never fall back to
 * `100 / servingSize`.
 */
export function per100gFactor(food: FoodServingLike): {
  factor: number | null;
  detail: string;
  warning?: string;
} {
  const r = resolveServingGrams(food);
  if (r.grams == null || r.grams <= 0) {
    return { factor: null, detail: r.detail, warning: r.warning };
  }
  return {
    factor: 100 / r.grams,
    detail: r.detail,
  };
}
