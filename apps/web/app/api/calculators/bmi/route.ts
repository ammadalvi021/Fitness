import { NextRequest } from 'next/server';
import { z } from 'zod';
import { BMI_SCREENING_NOTE, calculateBMI, cmFromIn, kgFromLb } from '@fitfusion/core';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const BmiInputSchema = z.object({
  weight: z.number().positive('Weight must be positive'),
  height: z.number().positive('Height must be positive'),
  units: z.enum(['metric', 'imperial']).default('metric'),
  ageYears: z.number().int().min(0).max(120).optional(),
});

/** Public endpoint info (no auth required). */
export async function GET() {
  return apiOk({
    info: {
      description: 'Calculate Body Mass Index (BMI) from weight and height.',
      units: ['metric (kg, cm)', 'imperial (lb, in)'],
      fields: ['weight', 'height', 'units', 'ageYears?'],
      note: BMI_SCREENING_NOTE,
      adultClassificationOnly: 'Adult BMI classification applies only for age >= 18.',
    },
  });
}

/** Public BMI calculation — adult classification only for age >= 18. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = BmiInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid BMI input', 400, zodMessage(parsed.error));
  }
  const { weight, height, units, ageYears } = parsed.data;
  const weightKg = units === 'imperial' ? kgFromLb(weight) : weight;
  const heightCm = units === 'imperial' ? cmFromIn(height) : height;
  const result = calculateBMI({ weightKg, heightCm, ageYears });
  return apiOk({ ...result });
}
