import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';
import {
  OFF_ATTRIBUTION,
  isValidBarcode,
  lookupBarcode,
  type NormalizedProduct,
} from '@/lib/openfoodfacts';
import { foodServingGrams, nutrientsForOneServing } from '@/lib/barcode-quantity';

/** Null-safe round for storage: missing OFF values become 0 on the Food row. */
function round2Safe(n: number | null): number {
  return n === null || !Number.isFinite(n) ? 0 : Math.round(n * 100) / 100;
}

export const dynamic = 'force-dynamic';

const OffSaveSchema = z.object({
  mode: z.literal('off'),
  barcode: z.string(),
});

const ManualLabelSaveSchema = z.object({
  mode: z.literal('manual_label'),
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).optional().nullable(),
  servingSize: z.number().positive().max(10000),
  servingUnit: z.string().trim().min(1).max(16),
  kcal: z.number().min(0).max(100000),
  proteinG: z.number().min(0).max(10000).default(0),
  carbsG: z.number().min(0).max(10000).default(0),
  fatG: z.number().min(0).max(10000).default(0),
  fiberG: z.number().min(0).max(10000).default(0),
  barcode: z.string().optional().nullable(),
});

const SaveSchema = z.discriminatedUnion('mode', [OffSaveSchema, ManualLabelSaveSchema]);

function foodSummary(food: {
  id: string; name: string; brand: string | null;
  servingSize: number; servingUnit: string;
  kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number;
  source: string; verification: string; basis: string | null;
  barcode: string | null;
}) {
  return {
    id: food.id,
    name: food.name,
    brand: food.brand,
    servingSize: food.servingSize,
    servingUnit: food.servingUnit,
    perServing: {
      kcal: food.kcal, proteinG: food.proteinG, carbsG: food.carbsG,
      fatG: food.fatG, fiberG: food.fiberG,
    },
    source: food.source,
    verification: food.verification,
    verificationBasis: food.basis,
    barcode: food.barcode,
  };
}

const OFF_BASIS = `Open Food Facts — crowdsourced third-party data, not manufacturer-verified. Attribution: ${OFF_ATTRIBUTION}`;
const LABEL_BASIS = 'Manually entered by the user from the product label.';

/**
 * POST /api/products/save
 * Save a packaged product as a Food row so it becomes loggable/searchable.
 *
 * - { mode: 'off', barcode }: fetch (cached) OFF product, upsert by barcode.
 *   Idempotent: repeating the call updates lastCheckedAt and returns the
 *   same Food row. Verification is ALWAYS 'estimate' — OFF is crowdsourced.
 * - { mode: 'manual_label', ... }: user read the label themselves and typed
 *   the values in. source 'user_label', verification 'estimate'.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = SaveSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid save payload', 400, zodMessage(parsed.error));
  }
  const input = parsed.data;

  if (input.mode === 'manual_label') {
    const name = input.name;
    let existing = await prisma.food.findUnique({ where: { name } });
    if (!existing && input.barcode) {
      const byBarcode = await prisma.food.findUnique({ where: { barcode: input.barcode } });
      if (byBarcode) existing = byBarcode;
    }
    const data = {
      name: existing ? existing.name : name,
      brand: input.brand ?? null,
      servingSize: input.servingSize,
      servingUnit: input.servingUnit,
      kcal: input.kcal,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      fiberG: input.fiberG,
      source: 'user_label',
      verification: 'estimate',
      basis: LABEL_BASIS,
      barcode: input.barcode ?? null,
      sourceRef: null,
      lastCheckedAt: new Date(),
    };
    const food = existing
      ? await prisma.food.update({ where: { id: existing.id }, data })
      : await prisma.food.create({ data });
    return apiOk({ food: foodSummary(food), saved: existing ? 'updated' : 'created' }, existing ? 200 : 201);
  }

  // mode: 'off'
  const barcode = input.barcode.replace(/[\s-]/g, '');
  if (!isValidBarcode(input.barcode)) {
    return apiError('validation_error', 'Barcode must be 8–14 digits', 400);
  }
  const lookup = await lookupBarcode(input.barcode);
  if (!lookup.found) {
    // Never save fabricated nutrition for a barcode we could not resolve.
    return apiError('product_not_found', lookup.message, 404);
  }
  const p: NormalizedProduct = lookup.product;

  const existing = await prisma.food.findUnique({ where: { barcode } });

  const { size: servingSize, unit: servingUnit } = foodServingGrams(p);
  const one = nutrientsForOneServing(p, servingSize);
  if (!one || one.kcal === null) {
    // OFF has no usable nutrition — refuse to create a Food of zeroes.
    return apiError(
      'no_nutrition_data',
      'Open Food Facts has no nutrition data for this product, so it cannot be logged as a food.',
      422,
    );
  }
  const name = existing
    ? existing.name
    : await uniqueFoodName(p.name, p.brand, barcode);

  const data = {
    name,
    brand: p.brand,
    servingSize,
    servingUnit,
    kcal: round2Safe(one.kcal),
    proteinG: round2Safe(one.proteinG),
    carbsG: round2Safe(one.carbsG),
    fatG: round2Safe(one.fatG),
    fiberG: round2Safe(one.fiberG),
    source: 'openfoodfacts',
    verification: 'estimate',
    basis: OFF_BASIS,
    barcode,
    sourceRef: `openfoodfacts:${barcode}`,
    lastCheckedAt: new Date(),
  };
  const food = existing
    ? await prisma.food.update({ where: { id: existing.id }, data })
    : await prisma.food.create({ data });
  return apiOk({ food: foodSummary(food), saved: existing ? 'updated' : 'created' }, existing ? 200 : 201);
}

/** Pick a Food.name that does not collide with the unique constraint. */
async function uniqueFoodName(name: string, brand: string | null, barcode: string): Promise<string> {
  const base = brand ? `${name} (${brand})` : name;
  const direct = await prisma.food.findUnique({ where: { name: base } });
  if (!direct) return base;
  const suffixed = `${base} [${barcode}]`;
  const again = await prisma.food.findUnique({ where: { name: suffixed } });
  return again ? `${suffixed} ${Date.now().toString(36)}` : suffixed;
}
