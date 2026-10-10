/**
 * Daily water guidance.
 * 35 ml/kg base, +500 ml if active/very_active, +500 ml if hotClimate.
 */

import type { ActivityLevel } from './types.js';

export interface WaterGuidance {
  mlPerDay: number;
  /** Approx 250 ml glasses, rounded. */
  glasses: number;
  note: string;
}

const ML_PER_KG = 35;
const ACTIVITY_BONUS_ML = 500;
const HOT_CLIMATE_BONUS_ML = 500;
const ML_PER_GLASS = 250;

export function waterGuidanceMl(o: {
  weightKg: number;
  activityLevel: ActivityLevel;
  hotClimate?: boolean;
}): WaterGuidance {
  const { weightKg, activityLevel, hotClimate = false } = o;
  if (!(weightKg > 0)) {
    throw new RangeError('waterGuidanceMl: weightKg must be > 0');
  }

  const parts: string[] = [`35 ml × ${weightKg} kg`];
  let ml = weightKg * ML_PER_KG;

  if (activityLevel === 'active' || activityLevel === 'very_active') {
    ml += ACTIVITY_BONUS_ML;
    parts.push(`+ 500 ml for high activity (${activityLevel})`);
  }
  if (hotClimate) {
    ml += HOT_CLIMATE_BONUS_ML;
    parts.push('+ 500 ml for hot climate');
  }

  const mlPerDay = Math.round(ml);
  const glasses = Math.round(mlPerDay / ML_PER_GLASS);

  return {
    mlPerDay,
    glasses,
    note: `Based on ${parts.join(', ')}. This is a general guide — thirst, urine color, and your clinician's advice matter more than any formula.`,
  };
}
