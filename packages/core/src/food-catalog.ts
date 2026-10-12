/**
 * Custom (user-created) recipe nutrition math + shared food-catalog helpers.
 * Pure functions — no DB, no I/O — so they are unit-testable anywhere.
 */

import { roundNutrients, sumNutrients } from './nutrition.js';
import type { Nutrients } from './types.js';

// ---------------------------------------------------------------------------
// Recipe ingredient math
// ---------------------------------------------------------------------------

/** One recipe ingredient. Nutrient values are per 100 g of the ingredient. */
export interface RecipeIngredientInput {
  name: string;
  grams: number;
  kcal?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
}

/**
 * Water (English / Roman Urdu / Urdu script) never contributes calories.
 * Plain water has no macronutrients; zero the whole profile so a "500 ml
 * water" row can never inflate a recipe's nutrition.
 */
const WATER_NAME_RE = /^\s*(water|pani|پانی)(?=\s|$)/i;

export function isWaterIngredient(name: string): boolean {
  return WATER_NAME_RE.test(name ?? '');
}

/** Nutrients contributed by a single ingredient row (per-100-g × grams). */
export function ingredientNutrients(ing: RecipeIngredientInput): Nutrients {
  if (isWaterIngredient(ing.name)) {
    return { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  }
  const grams = Number.isFinite(ing.grams) && ing.grams > 0 ? ing.grams : 0;
  const factor = grams / 100;
  const n = (v: number | null | undefined): number =>
    Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0;
  return {
    kcal: n(ing.kcal) * factor,
    proteinG: n(ing.proteinG) * factor,
    carbsG: n(ing.carbsG) * factor,
    fatG: n(ing.fatG) * factor,
    fiberG: n(ing.fiberG) * factor,
  };
}

export interface RecipeNutritionResult {
  /** Whole-batch totals (rounded to 1 decimal). */
  totals: Nutrients;
  /** Per-portion values (rounded to 1 decimal). */
  perPortion: Nutrients;
  portions: number;
}

/**
 * Compute a custom recipe's nutrition from its ingredient rows.
 * `portions` must be a positive integer; totals are divided evenly.
 */
export function computeRecipeNutrition(
  ingredients: RecipeIngredientInput[],
  portions: number,
): RecipeNutritionResult {
  const p = Number.isFinite(portions) && portions > 0 ? Math.floor(portions) : 1;
  const totals = roundNutrients(sumNutrients(ingredients.map(ingredientNutrients)));
  const perPortion = roundNutrients({
    kcal: totals.kcal / p,
    proteinG: totals.proteinG / p,
    carbsG: totals.carbsG / p,
    fatG: totals.fatG / p,
    fiberG: totals.fiberG / p,
  });
  return { totals, perPortion, portions: p };
}

// ---------------------------------------------------------------------------
// Food search ranking (pure; the API route fetches, this orders)
// ---------------------------------------------------------------------------

export interface RankableFood {
  id: string;
  name: string;
  aliases: string[];
  /** 'verified' | 'estimate' (legacy boolean handled by callers). */
  verification: string;
}

/**
 * Rank foods for a query `q` (already trimmed, case-insensitive compare):
 *   1. exact name match
 *   2. alias match
 *   3. name contains
 * then verified first, then name ascending.
 * Foods that do not match at all are dropped (empty `q` keeps everything,
 * ordered verified-first then name).
 */
export function rankFoodMatches<T extends RankableFood>(foods: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  const scored = foods
    .map((f) => {
      const nameLower = f.name.toLowerCase();
      let rank: number;
      if (!needle) {
        rank = 3;
      } else if (nameLower === needle) {
        rank = 0;
      } else if (f.aliases.some((a) => a.toLowerCase() === needle || a.toLowerCase().includes(needle))) {
        rank = 1;
      } else if (nameLower.includes(needle)) {
        rank = 2;
      } else {
        return null;
      }
      return { f, rank };
    })
    .filter((x): x is { f: T; rank: number } => x !== null);
  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const av = a.f.verification === 'verified' ? 0 : 1;
    const bv = b.f.verification === 'verified' ? 0 : 1;
    if (av !== bv) return av - bv;
    return a.f.name.localeCompare(b.f.name);
  });
  return scored.map((s) => s.f);
}

// ---------------------------------------------------------------------------
// Pagination (pure)
// ---------------------------------------------------------------------------

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Paginate an in-memory list; page is 1-based and clamped. */
export function paginate<T>(items: T[], page: number, limit: number): Page<T> {
  const total = items.length;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const safePage = Number.isFinite(page) && page > 0 ? Math.min(Math.floor(page), totalPages) : 1;
  const start = (safePage - 1) * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
  };
}

// ---------------------------------------------------------------------------
// Household portion conversion
// ---------------------------------------------------------------------------

export interface HouseholdPortionLike {
  grams: number | null;
  ml: number | null;
}

/**
 * Gram equivalent of a household portion. Prefers grams; falls back to ml
 * (1 ml ≈ 1 g) for drinks measured by volume. Returns null when neither is set.
 */
export function portionGrams(p: HouseholdPortionLike): number | null {
  if (typeof p.grams === 'number' && Number.isFinite(p.grams) && p.grams > 0) return p.grams;
  if (typeof p.ml === 'number' && Number.isFinite(p.ml) && p.ml > 0) return p.ml;
  return null;
}
