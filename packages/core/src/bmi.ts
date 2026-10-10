/**
 * BMI calculation with adult-only classification.
 * For age < 18 no adult classification is applied — pediatric guidance is
 * returned instead, per contract safety rules.
 */

export interface BmiResult {
  /** Rounded to 1 decimal. */
  bmi: number;
  isMinor: boolean;
  classificationKey: 'underweight' | 'healthy' | 'overweight' | 'obesity' | null;
  /** Null for minors. */
  classificationLabel: string | null;
  /** Always: "BMI is a screening measure, not a diagnosis." */
  screeningNote: string;
  /** Set for minors: directs to pediatric assessment. */
  pediatricGuidance?: string;
}

export const BMI_SCREENING_NOTE = 'BMI is a screening measure, not a diagnosis.';

export const BMI_PEDIATRIC_GUIDANCE =
  'BMI interpretation for children and teens requires age- and sex-specific ' +
  'percentiles. Please consult a pediatrician or qualified health professional ' +
  'for assessment.';

export function calculateBMI(o: {
  weightKg: number;
  heightCm: number;
  ageYears?: number;
}): BmiResult {
  const { weightKg, heightCm, ageYears } = o;
  if (!(weightKg > 0)) {
    throw new RangeError('calculateBMI: weightKg must be > 0');
  }
  if (!(heightCm > 0)) {
    throw new RangeError('calculateBMI: heightCm must be > 0');
  }

  const raw = weightKg / (heightCm / 100) ** 2;
  const bmi = Math.round(raw * 10) / 10;

  const isMinor = ageYears !== undefined && ageYears < 18;

  if (isMinor) {
    return {
      bmi,
      isMinor: true,
      classificationKey: null,
      classificationLabel: null,
      screeningNote: BMI_SCREENING_NOTE,
      pediatricGuidance: BMI_PEDIATRIC_GUIDANCE,
    };
  }

  let classificationKey: BmiResult['classificationKey'];
  let classificationLabel: string;
  if (bmi < 18.5) {
    classificationKey = 'underweight';
    classificationLabel = 'Underweight';
  } else if (bmi < 25) {
    classificationKey = 'healthy';
    classificationLabel = 'Healthy weight';
  } else if (bmi < 30) {
    classificationKey = 'overweight';
    classificationLabel = 'Overweight';
  } else {
    classificationKey = 'obesity';
    classificationLabel = 'Obesity';
  }

  return {
    bmi,
    isMinor: false,
    classificationKey,
    classificationLabel,
    screeningNote: BMI_SCREENING_NOTE,
  };
}
