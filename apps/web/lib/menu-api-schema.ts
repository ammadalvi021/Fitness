/**
 * Shared zod schemas for the Phase D restaurant-menu APIs.
 * Enforces the honesty rules at the boundary: an item that carries a kcal
 * number can never be labelled 'unavailable', and a non-'unavailable' item
 * must carry a kcal number.
 */
import { z } from 'zod';

export const NUTRITION_STATUSES = [
  'restaurant_published',
  'calculated_estimate',
  'menu_photo_estimate',
  'user_submitted',
  'unavailable',
] as const;

export type NutritionStatus = (typeof NUTRITION_STATUSES)[number];

export const MenuItemBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  portion: z.string().trim().max(200).optional().nullable(),
  kcal: z.number().nonnegative().max(100000).optional().nullable(),
  proteinG: z.number().nonnegative().max(100000).optional().nullable(),
  carbsG: z.number().nonnegative().max(100000).optional().nullable(),
  fatG: z.number().nonnegative().max(100000).optional().nullable(),
  fiberG: z.number().nonnegative().max(100000).optional().nullable(),
  nutritionStatus: z.enum(NUTRITION_STATUSES),
  assumptions: z.array(z.string().max(500)).max(50).optional().nullable(),
  source: z.string().trim().max(500).optional().nullable(),
});

export type MenuItemBody = z.infer<typeof MenuItemBodySchema>;

/**
 * Honesty invariant: kcal present ⟺ status is not 'unavailable'.
 * Returns an error message when violated, null when valid.
 */
export function validateMenuItemHonesty(
  kcal: number | null | undefined,
  status: string,
): string | null {
  const hasKcal = kcal !== null && kcal !== undefined;
  if (hasKcal && status === 'unavailable') {
    return 'An item with a kcal value cannot have nutritionStatus "unavailable".';
  }
  if (!hasKcal && status !== 'unavailable') {
    return `nutritionStatus "${status}" requires a kcal value; use "unavailable" when nutrition is unknown.`;
  }
  return null;
}

export const CORRECTION_STATUSES = ['open', 'accepted', 'rejected'] as const;

export const CorrectionCreateSchema = z.object({
  note: z.string().trim().min(4).max(2000),
});

export const CorrectionResolveSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  /** Optional item updates applied when accepting. */
  updates: MenuItemBodySchema.partial().optional(),
});

export const MenuConfirmSchema = z.object({
  restaurantId: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        portion: z.string().trim().max(200).optional().nullable(),
        matchedFoodId: z.string().trim().min(1).optional().nullable(),
      }),
    )
    .min(1)
    .max(50),
});

export const MENU_SUBMISSION_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type MenuSubmissionStatus = (typeof MENU_SUBMISSION_STATUSES)[number];

export const MenuSubmissionReviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  /** Optional note recorded with the review decision. */
  reviewNote: z.string().trim().max(2000).optional(),
});

export type MenuSubmissionReview = z.infer<typeof MenuSubmissionReviewSchema>;

/* ------------------------------------------------------------------ */
/* P5 (v21.8): verification invalidation on material menu-item edits   */
/* ------------------------------------------------------------------ */

/**
 * Fields whose change invalidates a prior `lastVerifiedAt` stamp.
 * Description/assumptions are editorial, not material.
 */
export const MENU_ITEM_MATERIAL_FIELDS = [
  'name',
  'portion',
  'kcal',
  'proteinG',
  'carbsG',
  'fatG',
  'fiberG',
  'source',
  'nutritionStatus',
] as const;

export type MenuItemMaterialField = (typeof MENU_ITEM_MATERIAL_FIELDS)[number];

function materialTextEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  // Empty string and null both mean "no value".
  const na = a === undefined || a === null || a === '' ? null : a;
  const nb = b === undefined || b === null || b === '' ? null : b;
  return na === nb;
}

function materialNumberEqual(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  // Tolerate float round-trips (Postgres DOUBLE PRECISION <-> JS double).
  return Math.abs(a - b) < 1e-9;
}

function materialValueEqual(
  field: MenuItemMaterialField,
  patchValue: unknown,
  existingValue: unknown,
): boolean {
  const v = patchValue === undefined ? undefined : (patchValue as string | number | null);
  const e = existingValue as string | number | null | undefined;
  switch (field) {
    case 'kcal':
    case 'proteinG':
    case 'carbsG':
    case 'fatG':
    case 'fiberG':
      return materialNumberEqual(v as number | null | undefined, e as number | null | undefined);
    default:
      return materialTextEqual(v as string | null | undefined, e as string | null | undefined);
  }
}

/**
 * True when a partial menu-item patch changes at least one material field
 * relative to the stored item. Fields absent from the patch (undefined) are
 * ignored; an explicit null counts as a change only when the stored value
 * was non-null. Pure — unit-testable without a database.
 */
export function menuPatchHasMaterialChange(
  existing: Partial<Record<MenuItemMaterialField, string | number | null>>,
  patch: Partial<Record<MenuItemMaterialField, string | number | null | undefined>>,
): boolean {
  for (const field of MENU_ITEM_MATERIAL_FIELDS) {
    if (!(field in patch)) continue;
    const pv = patch[field];
    if (pv === undefined) continue;
    if (!materialValueEqual(field, pv, existing[field])) return true;
  }
  return false;
}
