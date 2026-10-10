import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * App preferences. NOTE: the Prisma schema has no dedicated Settings model,
 * so settings are backed by the Profile row (nutrition/workout preferences).
 * Keys with no server-side home (units, theme) are client-managed and
 * returned with their defaults.
 */
const SettingsSchema = z.object({
  dietPreference: z.string().min(1).max(50).optional(),
  allergies: z.array(z.string().min(1)).max(50).optional(),
  intolerances: z.array(z.string().min(1)).max(50).optional(),
  dislikedIngredients: z.array(z.string().min(1)).max(100).optional(),
  halalOnly: z.boolean().optional(),
  preferredCuisines: z.array(z.string().min(1)).max(50).optional(),
  maxCookMinutes: z.number().int().min(1).max(300).optional(),
  budgetTier: z.string().min(1).max(50).optional(),
  mealsPerDay: z.number().int().min(1).max(8).optional(),
  equipment: z.array(z.string().min(1)).max(50).optional(),
  workoutDays: z.array(z.string().min(1)).max(7).optional(),
  workoutMinutesPerDay: z.number().int().min(5).max(300).optional(),
  workoutLocation: z.string().min(1).max(50).optional(),
  fitnessExperience: z.string().min(1).max(50).optional(),
});

function toSettings(profile: {
  dietPreference: string | null;
  allergies: string[];
  intolerances: string[];
  dislikedIngredients: string[];
  halalOnly: boolean;
  preferredCuisines: string[];
  maxCookMinutes: number | null;
  budgetTier: string | null;
  mealsPerDay: number | null;
  equipment: string[];
  workoutDays: string[];
  workoutMinutesPerDay: number | null;
  workoutLocation: string | null;
  fitnessExperience: string | null;
} | null) {
  return {
    dietPreference: profile?.dietPreference ?? 'flexible',
    allergies: profile?.allergies ?? [],
    intolerances: profile?.intolerances ?? [],
    dislikedIngredients: profile?.dislikedIngredients ?? [],
    halalOnly: profile?.halalOnly ?? false,
    preferredCuisines: profile?.preferredCuisines ?? [],
    maxCookMinutes: profile?.maxCookMinutes ?? null,
    budgetTier: profile?.budgetTier ?? null,
    mealsPerDay: profile?.mealsPerDay ?? 3,
    equipment: profile?.equipment ?? [],
    workoutDays: profile?.workoutDays ?? [],
    workoutMinutesPerDay: profile?.workoutMinutesPerDay ?? null,
    workoutLocation: profile?.workoutLocation ?? null,
    fitnessExperience: profile?.fitnessExperience ?? null,
    // Client-managed (localStorage); returned with defaults for UI binding.
    units: 'metric' as const,
    theme: 'system' as const,
  };
}

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  return apiOk({ settings: toSettings(s.profile) });
}

export async function PUT(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = SettingsSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid settings', 400, zodMessage(parsed.error));
  }
  const profile = await prisma.profile.upsert({
    where: { userId: s.user.id },
    update: parsed.data,
    create: { userId: s.user.id, ...parsed.data },
  });
  return apiOk({ settings: toSettings(profile) });
}
