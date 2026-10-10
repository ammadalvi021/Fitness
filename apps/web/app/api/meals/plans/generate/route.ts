import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import {
  DEFAULT_TEMPLATE_MEALS,
  generateWeeklyPlan,
  validateMealAgainstProfile,
} from '@fitfusion/core';
import type { DayPlan, PlannedMeal } from '@fitfusion/core';
import { aiStatus, generateMealPlanAI } from '@fitfusion/ai';
import type { MealPlanProfile } from '@fitfusion/ai';
import { requirePlan } from '@/lib/auth';
import { computeTargets } from '@/lib/server-targets';
import { apiError, apiOk, parseDateOnly, readJson, startOfWeekMonday, toDateOnly, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const GenerateSchema = z.object({
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart must be YYYY-MM-DD')
    .optional(),
  useAI: z.boolean().optional().default(false),
});

const templateById = new Map(DEFAULT_TEMPLATE_MEALS.map((m) => [m.id, m]));

/**
 * POST /api/meals/plans/generate — requires the "diet" plan.
 * useAI=true tries the AI generator when configured, otherwise falls back
 * to the deterministic template generator (never fabricated).
 */
export async function POST(req: NextRequest) {
  const s = await requirePlan(req, 'diet');
  if (s instanceof NextResponse) return s;

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = GenerateSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }

  const profile = s.profile;
  const dietPreference = profile?.dietPreference ?? 'flexible';
  const allergies = profile?.allergies ?? [];
  const dislikedIngredients = profile?.dislikedIngredients ?? [];

  const targets = await computeTargets(s.user.id, profile);
  const warnings: string[] = [...targets.warnings];

  const weekStart = parsed.data.weekStart
    ? (parseDateOnly(parsed.data.weekStart) ?? startOfWeekMonday(new Date()))
    : startOfWeekMonday(new Date());

  let days: DayPlan[] | unknown[];
  let generatedBy: 'template' | 'ai' = 'template';

  if (parsed.data.useAI) {
    const status = aiStatus();
    if (status.chat) {
      const aiProfile: MealPlanProfile = {
        dietPreference,
        allergies,
        intolerances: profile?.intolerances ?? [],
        dislikedIngredients,
        preferredCuisines: profile?.preferredCuisines ?? [],
        mealsPerDay: profile?.mealsPerDay ?? undefined,
        budgetTier: profile?.budgetTier ?? undefined,
        maxCookMinutes: profile?.maxCookMinutes ?? undefined,
        halalOnly: profile?.halalOnly ?? false,
      };
      const aiResult = await generateMealPlanAI(aiProfile, {
        calorieTarget: targets.calorieTarget,
        proteinG: Math.round(targets.macros.proteinG),
        goal: profile?.goal ?? undefined,
      });
      if (aiResult.status === 'ok' && aiResult.days) {
        days = aiResult.days;
        generatedBy = 'ai';
        if (aiResult.warnings) warnings.push(...aiResult.warnings);
      } else if (aiResult.status === 'not_configured') {
        warnings.push('AI is not configured — generated a template plan instead.');
        days = [];
      } else {
        return apiError('ai_error', aiResult.error ?? 'AI meal plan generation failed', 502);
      }
    } else {
      warnings.push('AI is not configured — generated a template plan instead.');
      days = [];
    }
  } else {
    days = [];
  }

  if (generatedBy === 'template') {
    days = generateWeeklyPlan({
      meals: DEFAULT_TEMPLATE_MEALS,
      calorieTarget: targets.calorieTarget,
      dietPreference,
      allergies,
      dislikedIngredients,
    });
  }

  // Validate every meal against the user's diet profile — violations are
  // surfaced, never silently substituted.
  for (const day of days as DayPlan[]) {
    for (const meal of (day.meals ?? []) as PlannedMeal[]) {
      const template = templateById.get(meal.templateId);
      if (!template) continue;
      const check = validateMealAgainstProfile(
        {
          name: meal.name,
          ingredients: template.ingredients,
          dietCategory: template.dietCategory,
          labels: template.labels,
        },
        { allergies, dietPreference },
      );
      if (!check.ok) {
        warnings.push(`Day ${day.dayIndex + 1} "${meal.name}": ${check.violations.join('; ')}`);
      }
    }
  }

  const plan = await prisma.mealPlan.create({
    data: {
      userId: s.user.id,
      weekStart,
      days: days as object,
      calorieTarget: targets.calorieTarget,
      generatedBy,
      status: 'active',
    },
  });

  return apiOk(
    {
      plan,
      targets: {
        calorieTarget: targets.calorieTarget,
        tdee: targets.tdee,
        macros: targets.macros,
        waterMl: targets.waterMl,
        assumptions: targets.assumptions,
        weightLossDisabled: targets.weightLossDisabled,
        professionalGuidance: targets.professionalGuidance,
      },
      warnings,
      weekStart: toDateOnly(weekStart),
    },
    201,
  );
}
