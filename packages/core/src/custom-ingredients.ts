/**
 * P4 — classification of custom-recipe ingredient rows that have NO trusted
 * catalogue foodId.
 *
 * Rules (binding):
 *  - A name+grams-only row must NEVER default nutrients to 0 silently.
 *  - `KNOWN_ZERO_INGREDIENTS` is an EXPLICIT list of genuinely zero-calorie
 *    items (water, salt, and the plain spices the ingredient catalogue
 *    records as 0-kcal by documented design decision — see
 *    packages/db/prisma/seed-ingredients.ts header). Membership is by exact
 *    normalized name or explicit alias — never name-pattern matching, so a
 *    user typing "chicken salt" or "salted peanuts" is NOT zeroed.
 *  - Rows with declared nutrient values require ALL FIVE macros + a basis
 *    ('usda' | 'label' | 'estimate', documented, never invented).
 *  - Anything else → 'unknown': contributes 0 but is flagged
 *    "nutrition unknown" so the recipe is marked needsReview and the UI shows
 *    "nutrition incomplete". Partial calculation is never marked complete.
 */

export type NutrientBasis = 'usda' | 'label' | 'estimate';

export interface DeclaredNutrients {
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  basis?: NutrientBasis;
}

export type CustomIngredientStatus = 'known_zero' | 'declared' | 'unknown';

export interface CustomIngredientClassification {
  status: CustomIngredientStatus;
  warnings: string[];
}

/**
 * Explicit zero-calorie list. Each entry: canonical name + the explicit
 * aliases that also count. Additions must be genuinely zero-calorie at any
 * plausible recipe quantity — this list is a claim, keep it honest.
 */
export const KNOWN_ZERO_INGREDIENTS: readonly {
  name: string;
  aliases: readonly string[];
}[] = [
  { name: 'water', aliases: ['pani'] },
  { name: 'salt', aliases: ['namak', 'table salt'] },
  { name: 'black pepper', aliases: ['kali mirch'] },
  { name: 'turmeric', aliases: ['haldi', 'haldee'] },
  { name: 'red chili powder', aliases: ['lal mirch', 'red chilli powder'] },
  { name: 'cumin seeds', aliases: ['zeera', 'jeera', 'cumin'] },
  { name: 'coriander powder', aliases: ['dhania powder', 'ground coriander', 'sukha dhania'] },
  { name: 'garam masala', aliases: ['garam masalah'] },
];

const ZERO_NAMES = new Set<string>();
for (const e of KNOWN_ZERO_INGREDIENTS) {
  ZERO_NAMES.add(normName(e.name));
  for (const a of e.aliases) ZERO_NAMES.add(normName(a));
}

function normName(name: string): string {
  return (name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Exact normalized-name membership — never pattern matching. */
export function isKnownZeroIngredient(name: string): boolean {
  return ZERO_NAMES.has(normName(name));
}

const NUTRIENT_KEYS = ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;

/**
 * Classify a non-foodId ingredient row. Pure — the API route applies the
 * verdict (zeros / declared values / unknown flag).
 */
export function classifyCustomIngredient(
  name: string,
  nutrients: DeclaredNutrients,
): CustomIngredientClassification {
  const label = `"${name}"`;

  if (isKnownZeroIngredient(name)) {
    const declaredNonZero = NUTRIENT_KEYS.some(
      (k) => nutrients[k] !== undefined && Number(nutrients[k]) !== 0,
    );
    return {
      status: 'known_zero',
      warnings: declaredNonZero
        ? [`${label} is on the known-zero list — declared non-zero nutrients ignored.`]
        : [],
    };
  }

  const declared = NUTRIENT_KEYS.filter((k) => nutrients[k] !== undefined);
  if (declared.length === 0) {
    return {
      status: 'unknown',
      warnings: [
        `${label}: no catalogue food and no declared nutrients — nutrition unknown. ` +
        `Contributes 0 to totals; recipe must be flagged needsReview ("nutrition incomplete").`,
      ],
    };
  }
  if (declared.length < NUTRIENT_KEYS.length) {
    return {
      status: 'unknown',
      warnings: [
        `${label}: only ${declared.length}/5 nutrients declared (${declared.join(', ')}) — ` +
        `treated as unknown. Declare all five + basis, or link a catalogue food.`,
      ],
    };
  }
  if (!nutrients.basis) {
    return {
      status: 'unknown',
      warnings: [
        `${label}: all nutrients declared but no basis given — treated as unknown. ` +
        `Basis must be one of: usda | label | estimate.`,
      ],
    };
  }
  return { status: 'declared', warnings: [] };
}
