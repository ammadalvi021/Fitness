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
