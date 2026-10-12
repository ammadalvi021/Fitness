/**
 * Healthier-swaps logic (pure, no DOM).
 *
 * Given a food and candidate alternatives from the same category, picks
 * lower-calorie-density options and explains the basis honestly
 * ("68% fewer calories per 100g").
 *
 * HONESTY RULES (binding):
 * - The basis is computed from real numbers, never asserted. When kcal/100g
 *   cannot be derived (serving not stated in grams), the comparison falls
 *   back to per-serving and says so.
 * - Language is non-judgmental: suggestions are "lighter alternatives", the
 *   user can dismiss, and nothing here shames the original choice.
 * - No nutrition is fabricated: foods without usable kcal data are skipped.
 */

export interface SwapFoodLike {
  id: string;
  name: string;
  /** kcal per serving as reported by the food database. */
  perServingKcal?: number | null;
  /** Serving size; meaningful for density only when the unit is gram-like. */
  servingSize?: number | null;
  servingUnit?: string | null;
  /** Precomputed kcal/100g (Phase A /api/foods may supply this). */
  kcalPer100g?: number | null;
  categoryId?: string | null;
  categoryName?: string | null;
  verification?: string;
  basis?: string | null;
}

export interface SwapSuggestion {
  food: SwapFoodLike;
  /** Whole-percent saving vs the original, 1..99. */
  savingPct: number;
  /** Human-readable, computed basis, e.g. "68% fewer calories per 100g". */
  basis: string;
}

const GRAM_UNITS = new Set(['g', 'gram', 'grams', 'gm', 'gms']);

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * kcal per 100g for a food, or null when it cannot be derived honestly.
 * Prefers a supplied kcalPer100g; otherwise derives from per-serving values
 * only when the serving unit is gram-like.
 */
export function kcalDensityPer100g(f: SwapFoodLike): number | null {
  const direct = num(f.kcalPer100g);
  if (direct != null) return direct;
  const kcal = num(f.perServingKcal);
  const size = num(f.servingSize);
  const unit = String(f.servingUnit ?? '').trim().toLowerCase();
  if (kcal == null || size == null || !GRAM_UNITS.has(unit)) return null;
  return (kcal / size) * 100;
}

function sameCategory(a: SwapFoodLike, b: SwapFoodLike): boolean {
  if (a.categoryId && b.categoryId) return a.categoryId === b.categoryId;
  const an = (a.categoryName ?? '').trim().toLowerCase();
  const bn = (b.categoryName ?? '').trim().toLowerCase();
  return an !== '' && an === bn;
}

function savingPct(original: number, alt: number): number {
  if (original <= 0 || alt >= original) return 0;
  return Math.round(((original - alt) / original) * 100);
}

export interface SuggestSwapsOptions {
  max?: number;
  /** Minimum whole-percent saving to be worth suggesting (default 5). */
  minSavingPct?: number;
}

/**
 * Suggest lighter same-category alternatives. Pure: candidates are supplied
 * by the caller (fetched from /api/foods). Returns at most `max`
 * suggestions ordered by saving, each with a computed basis string.
 */
export function suggestSwaps(
  food: SwapFoodLike,
  candidates: SwapFoodLike[],
  opts: SuggestSwapsOptions = {},
): SwapSuggestion[] {
  const max = opts.max ?? 3;
  const minSaving = opts.minSavingPct ?? 5;

  const origDensity = kcalDensityPer100g(food);
  const origServing = num(food.perServingKcal);

  const out: SwapSuggestion[] = [];
  for (const c of candidates) {
    if (!c || c.id === food.id) continue;
    if (!sameCategory(food, c)) continue;

    const cDensity = kcalDensityPer100g(c);
    if (origDensity != null && cDensity != null) {
      const pct = savingPct(origDensity, cDensity);
      if (pct < minSaving) continue;
      out.push({ food: c, savingPct: pct, basis: `${pct}% fewer calories per 100g` });
      continue;
    }
    // Fallback: per-serving comparison, labeled as such (less precise).
    const cServing = num(c.perServingKcal);
    if (origServing != null && cServing != null) {
      const pct = savingPct(origServing, cServing);
      if (pct < minSaving) continue;
      out.push({ food: c, savingPct: pct, basis: `${pct}% fewer calories per serving` });
    }
  }
  out.sort((a, b) => b.savingPct - a.savingPct);
  return out.slice(0, max);
}

/** Map a /api/foods result (either current or Phase A shape) to SwapFoodLike. Degrades gracefully. */
export function foodResultToSwapLike(raw: Record<string, unknown>): SwapFoodLike {
  const perServing = (raw.perServing ?? {}) as Record<string, unknown>;
  const kcal = num(raw.kcalPer100g) ?? num(raw.kcal_per_100g);
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    perServingKcal: num(perServing.kcal ?? raw.kcal),
    servingSize: num(raw.servingSize),
    servingUnit: raw.servingUnit != null ? String(raw.servingUnit) : null,
    kcalPer100g: kcal,
    categoryId:
      raw.categoryId != null
        ? String(raw.categoryId)
        : ((raw.category as Record<string, unknown> | undefined)?.id as string | undefined) ?? null,
    categoryName:
      raw.categoryName != null
        ? String(raw.categoryName)
        : ((raw.category as Record<string, unknown> | undefined)?.name as string | undefined) ?? null,
    verification: raw.verification != null ? String(raw.verification) : undefined,
    basis: raw.basis != null ? String(raw.basis) : null,
  };
}
