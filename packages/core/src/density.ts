/**
 * Ingredient-specific densities for VOLUME → MASS conversion (g per ml).
 *
 * Used by recipe-engine's toGrams() and by serving-weight normalization.
 * Every entry documents its basis in the comment — where no reliable
 * density exists for an ingredient, lookupDensity() returns null and the
 * caller must treat the conversion as UNKNOWN rather than assuming 1.0.
 *
 * Matching is by exact normalized name (lowercase, trimmed, whitespace
 * collapsed) plus the explicit alias lists below — never substring or
 * pattern matching, so "oil" alone never inherits "olive oil"'s density.
 */

export interface DensityEntry {
  /** grams per millilitre */
  density: number;
  /** Where this value came from — displayed in warnings, never invented. */
  basis: string;
}

interface DensityRow extends DensityEntry {
  names: readonly string[];
}

const TABLE: readonly DensityRow[] = [
  {
    // Definition: 1 ml of water weighs 1 g (at 4 °C).
    density: 1.0,
    basis: 'definition: 1 ml water = 1 g',
    names: ['water', 'pani'],
  },
  {
    // USDA FoodData Central: whole milk ≈ 1.03 g/ml (1 cup ≈ 244–250 g).
    density: 1.03,
    basis: 'USDA: whole/skim milk ≈ 1.03 g/ml',
    names: ['milk', 'whole milk', 'skim milk', 'skimmed milk', 'doodh', 'milk (whole)', 'milk (skim)', 'low fat milk'],
  },
  {
    // USDA FoodData Central: vegetable/canola/olive oil ≈ 0.92 g/ml
    // (1 tbsp ≈ 13.5–14 g).
    density: 0.92,
    basis: 'USDA: vegetable oil ≈ 0.92 g/ml (≈14 g/tbsp)',
    names: [
      'oil', 'cooking oil', 'olive oil', 'canola oil', 'vegetable oil',
      'mustard oil', 'sunflower oil', 'tel', 'coconut oil',
    ],
  },
  {
    // Clarified butter ≈ 0.91 g/ml (USDA ghee 1 tbsp ≈ 13 g).
    density: 0.91,
    basis: 'estimate: clarified butter ≈ 0.91 g/ml (USDA ghee 1 tbsp ≈ 13 g)',
    names: ['ghee', 'desi ghee', 'clarified butter'],
  },
  {
    // USDA: honey 1 cup = 340 g → 1.42 g/ml.
    density: 1.42,
    basis: 'USDA: honey 1 cup ≈ 340 g',
    names: ['honey', 'shehed'],
  },
  {
    // USDA: 1 cup granulated sugar = 200 g → 0.83 g/ml.
    density: 0.83,
    basis: 'USDA: 1 cup granulated sugar ≈ 200 g',
    names: ['sugar', 'white sugar', 'granulated sugar', 'cheeni'],
  },
  {
    // USDA: 1 cup all-purpose flour ≈ 125 g → 0.52 g/ml.
    density: 0.52,
    basis: 'USDA: 1 cup all-purpose flour ≈ 125 g',
    names: ['flour', 'all purpose flour', 'all-purpose flour', 'maida', 'wheat flour', 'atta'],
  },
  {
    // USDA: 1 cup cooked long-grain rice ≈ 158 g → 0.66 g/ml.
    density: 0.66,
    basis: 'USDA: 1 cup cooked rice ≈ 158 g',
    names: ['cooked rice', 'basmati rice (cooked)', 'rice (cooked)', 'chawal'],
  },
  {
    // USDA: 1 cup table salt = 288 g → 1.2 g/ml.
    density: 1.2,
    basis: 'USDA: 1 cup table salt ≈ 288 g',
    names: ['salt', 'table salt', 'namak'],
  },
  {
    // USDA: 1 cup plain yogurt ≈ 245 g → ≈ 1.02 g/ml.
    density: 1.02,
    basis: 'USDA: 1 cup plain yogurt ≈ 245 g',
    names: ['yogurt', 'plain yogurt', 'dahi', 'curd', 'dahi (plain yogurt)', 'greek yogurt'],
  },
  {
    // USDA: 1 tbsp soy sauce ≈ 16 g → ≈ 1.07 g/ml.
    density: 1.07,
    basis: 'USDA: 1 tbsp soy sauce ≈ 16 g',
    names: ['soy sauce', 'soya sauce'],
  },
  {
    // Sesame oil and mustard oil are vegetable oils (≈ 0.92 g/ml, as above).
    density: 0.92,
    basis: 'USDA: vegetable oil ≈ 0.92 g/ml (sesame/mustard oil)',
    names: ['sesame oil', 'mustard oil', 'til ka tel', 'sarson ka tel'],
  },
  {
    // USDA: 1 tbsp butter ≈ 14.2 g → ≈ 0.95 g/ml.
    density: 0.95,
    basis: 'USDA: 1 tbsp butter ≈ 14.2 g',
    names: ['butter', 'makhan'],
  },
  {
    // Distilled white vinegar ≈ 1.01 g/ml.
    density: 1.01,
    basis: 'distilled white vinegar ≈ 1.01 g/ml',
    names: ['vinegar', 'sirka', 'white vinegar'],
  },
  {
    // USDA: 1 tbsp lemon juice ≈ 15.3 g → ≈ 1.02 g/ml. A tbsp quantity of
    // 'Lemon' is juice (documented kitchen convention, like the v21 rules).
    density: 1.02,
    basis: 'USDA: 1 tbsp lemon juice ≈ 15.3 g',
    names: ['lemon juice', 'nimbu ka ras', 'lemon', 'nimbu', 'limbu', 'limon'],
  },
  {
    // USDA: 1 tbsp sesame seeds ≈ 9 g → 0.6 g/ml.
    density: 0.6,
    basis: 'USDA: 1 tbsp sesame seeds ≈ 9 g',
    names: ['sesame seeds', 'til', 'sesame'],
  },
  {
    // USDA: 1 tbsp cornstarch ≈ 8 g → ≈ 0.53 g/ml.
    density: 0.53,
    basis: 'USDA: 1 tbsp cornstarch ≈ 8 g',
    names: ['corn flour', 'cornflour', 'cornstarch', 'corn starch'],
  },
  {
    // USDA: 1 tsp cumin seed ≈ 2.1 g → 0.42 g/ml.
    density: 0.42,
    basis: 'USDA: 1 tsp cumin seed ≈ 2.1 g',
    names: ['cumin seeds', 'zeera', 'jeera', 'cumin'],
  },
  {
    // USDA: 1 tsp ground black pepper ≈ 2.3 g → 0.46 g/ml.
    density: 0.46,
    basis: 'USDA: 1 tsp ground black pepper ≈ 2.3 g',
    names: ['black pepper', 'kali mirch', 'ground black pepper'],
  },
  {
    // USDA: 1 tbsp tahini (sesame butter) ≈ 15 g → 1.0 g/ml.
    density: 1.0,
    basis: 'USDA: 1 tbsp tahini ≈ 15 g',
    names: ['tahini', 'sesame butter', 'sesame paste'],
  },
  {
    // USDA: 1 tsp prepared yellow mustard ≈ 5 g → 1.0 g/ml.
    density: 1.0,
    basis: 'USDA: 1 tsp prepared mustard ≈ 5 g',
    names: ['mustard (prepared)', 'prepared mustard', 'yellow mustard'],
  },
  {
    // USDA: 1 tbsp tomato ketchup ≈ 17 g → ≈ 1.13 g/ml.
    density: 1.13,
    basis: 'USDA: 1 tbsp tomato ketchup ≈ 17 g',
    names: ['tomato ketchup', 'ketchup'],
  },
];

const BY_NAME = new Map<string, DensityEntry>();
for (const row of TABLE) {
  for (const n of row.names) BY_NAME.set(n, { density: row.density, basis: row.basis });
}

/** Normalize a name the same way for lookup: lowercase, trim, collapse spaces. */
function norm(name: string): string {
  return (name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Ingredient-specific density in g/ml, or null when no reliable density is
 * documented. Null means "unknown" — the caller must NOT fall back to 1.0.
 *
 * Matching: exact normalized name first, then the name with its
 * parenthetical state stripped ('Maida (all-purpose flour)' → 'maida').
 * Still exact-match only — never substring matching.
 */
export function lookupDensity(name: string): DensityEntry | null {
  const n = norm(name);
  const exact = BY_NAME.get(n);
  if (exact) return exact;
  const stripped = norm(n.replace(/\([^)]*\)/g, ' '));
  if (stripped && stripped !== n) return BY_NAME.get(stripped) ?? null;
  return null;
}

/** Millilitres per unit for the volume units the engine understands. */
export const ML_PER_UNIT: Record<string, number> = {
  ml: 1,
  l: 1000,
  cup: 240,
  tbsp: 15,
  tsp: 5,
  fl_oz: 29.5735,
};
