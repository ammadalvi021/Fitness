/**
 * Macro targets from a calorie budget.
 * Protein by goal (g/kg): lose 2.0, gain 1.8, maintain 1.6, else 1.4.
 * Fat = 25% of kcal ÷ 9. Carbs = remaining kcal ÷ 4. Fiber = 14 g / 1000 kcal.
 */

import type { Goal } from './types.js';

export interface MacroTargets {
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  notes: string[];
}

const PROTEIN_G_PER_KG: Record<Goal, number> = {
  lose: 2.0,
  gain: 1.8,
  maintain: 1.6,
  improve_fitness: 1.4,
  eat_healthier: 1.4,
};

export function calculateMacros(o: {
  calories: number;
  goal: Goal;
  weightKg: number;
}): MacroTargets {
  const { calories, goal, weightKg } = o;
  const notes: string[] = [];

  const gPerKg = PROTEIN_G_PER_KG[goal];
  const proteinG = Math.round(gPerKg * weightKg);
  notes.push(
    `Protein ${proteinG} g = ${gPerKg} g/kg × ${weightKg} kg (goal: ${goal}).`,
  );

  const fatG = Math.round((0.25 * calories) / 9);
  notes.push(`Fat ${fatG} g = 25% of ${calories} kcal ÷ 9 kcal/g.`);

  const proteinKcal = proteinG * 4;
  const fatKcal = fatG * 9;
  const carbsG = Math.max(0, Math.round((calories - proteinKcal - fatKcal) / 4));
  notes.push(
    `Carbs ${carbsG} g = remaining kcal (${calories} − ${proteinKcal} − ${fatKcal}) ÷ 4 kcal/g.`,
  );

  const fiberG = Math.round((14 * calories) / 1000);
  notes.push(`Fiber ${fiberG} g = 14 g per 1000 kcal.`);

  return { proteinG, carbsG, fatG, fiberG, notes };
}
