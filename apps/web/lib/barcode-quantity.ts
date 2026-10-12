/**
 * Quantity-selector math for the barcode screen.
 *
 * Pure functions: given a normalized OFF product and the user's quantity
 * choice, compute how many "servings" to log and the resulting nutrients.
 * The diary API recomputes from the saved Food server-side, so these numbers
 * are for display; nothing here is persisted as truth.
 */
import type { NormalizedProduct, OffNutrients } from './openfoodfacts';
import { scaleNutrients, round2 } from './openfoodfacts';

export type QuantityKind =
  | 'serving' // 1 serving
  | 'whole_pack' // the whole pack (needs packGrams + servingSize)
  | 'half_pack' // half the pack
  | 'custom_grams' // user-entered grams
  | 'custom_servings'; // user-entered serving count (fallback when serving size unknown)

export interface QuantitySelection {
  kind: QuantityKind;
  /** For custom_grams: grams. For custom_servings: serving count. */
  value?: number;
}

export interface QuantityResolution {
  /** Servings multiplier to send to the diary API. */
  servings: number;
  /** Grams represented by the choice, when computable. */
  grams: number | null;
  /** Nutrients for the chosen quantity (per-serving scaled), or null. */
  nutrients: OffNutrients | null;
  /** Short human label, e.g. "1 serving (30 g)". */
  label: string;
}

/** Which quantity options are available for a product (packs need grams). */
export function availableQuantityKinds(product: NormalizedProduct): QuantityKind[] {
  const kinds: QuantityKind[] = ['serving'];
  if (product.servingSize !== null && product.packGrams !== null) {
    kinds.push('whole_pack', 'half_pack', 'custom_grams');
  } else if (product.servingSize !== null) {
    kinds.push('custom_grams');
  } else {
    kinds.push('custom_servings');
  }
  return kinds;
}

/**
 * Resolve a quantity choice to servings + nutrients.
 * - When serving size (grams) is known, grams → servings = grams / servingGrams.
 * - When serving size is unknown, only serving counts are allowed; nutrients
 *   scale from perServing (never guessed).
 */
export function resolveQuantity(
  product: NormalizedProduct,
  selection: QuantitySelection,
): QuantityResolution {
  const perServing = product.perServing;
  const servingG = product.servingSize;

  let servings = 1;
  let grams: number | null = servingG;

  switch (selection.kind) {
    case 'serving':
      servings = 1;
      break;
    case 'whole_pack':
      if (servingG && product.packGrams) servings = product.packGrams / servingG;
      grams = product.packGrams;
      break;
    case 'half_pack':
      if (servingG && product.packGrams) servings = product.packGrams / 2 / servingG;
      grams = product.packGrams !== null ? product.packGrams / 2 : null;
      break;
    case 'custom_grams': {
      const g = selection.value ?? 0;
      grams = g > 0 ? g : null;
      servings = servingG && g > 0 ? g / servingG : 1;
      break;
    }
    case 'custom_servings':
      servings = selection.value && selection.value > 0 ? selection.value : 1;
      grams = servingG ? servings * servingG : null;
      break;
    default:
      servings = 1;
  }

  const nutrients = perServing ? scaleNutrients(perServing, servings) : null;
  const label =
    grams !== null
      ? `${round2(servings)} serving${round2(servings) === 1 ? '' : 's'} (${round2(grams)} g)`
      : `${round2(servings)} serving${round2(servings) === 1 ? '' : 's'}`;

  return { servings: round2(servings) ?? 1, grams, nutrients, label };
}

/**
 * Decide which serving the saved Food row should represent so the diary's
 * server-side scaling (nutrients × servings) stays correct.
 * Returns the serving size in grams used for the Food row.
 */
export function foodServingGrams(product: NormalizedProduct): { size: number; unit: string } {
  if (product.servingSize !== null && product.servingSize > 0) {
    return { size: round2(product.servingSize) ?? product.servingSize, unit: 'g' };
  }
  // Fallback: per-100g becomes "per 100 g serving". Never invent a serving.
  return { size: 100, unit: 'g' };
}

/**
 * Nutrients for ONE food-serving of the size chosen by foodServingGrams().
 * Prefers native per-serving values; otherwise derives from per-100g; nulls
 * when OFF has nothing usable (caller must handle honestly).
 */
export function nutrientsForOneServing(
  product: NormalizedProduct,
  servingGrams: number,
): OffNutrients | null {
  if (product.servingSize !== null && product.perServing) {
    const factor = servingGrams / product.servingSize;
    return factor === 1 ? product.perServing : scaleNutrients(product.perServing, factor);
  }
  if (product.per100g) return scaleNutrients(product.per100g, servingGrams / 100);
  return null;
}
