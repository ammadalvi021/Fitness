/**
 * FitFusion AI — ingredient-name allergen screening + diet/allergen
 * recheck signalling (v21.4).
 *
 * PURE DATA MODULE: no imports from @prisma/client, no side effects, no I/O.
 * Single source of truth for the two operations every custom-recipe flow
 * needs:
 *
 *  1. `screenIngredientAllergens(names)` — screens a list of ingredient
 *     names against the nine major allergen families and returns the
 *     detected family labels (stable spellings, alphabetical order).
 *
 *     This is NAME-BASED SCREENING (the same basis the seed lists are
 *     "declared from ingredient names" under — see ALLERGEN_CAVEAT in
 *     recipe-claims.ts), NEVER a certified allergen analysis. In particular
 *     it NEVER promises allergen-free: an empty result means "nothing
 *     detected in the ingredient names", not "safe for allergy sufferers".
 *     Sub-ingredients, shared equipment and cross-contamination are not
 *     assessed. Callers must show the caveat wherever this output appears.
 *
 *  2. `dietAllergenRecheckNeeded(prev, next)` — true when a material change
 *     to the ingredient list or diet category means dietary/allergen claims
 *     must be re-screened. Used by POST /api/recipes (creation screens
 *     unconditionally; the helper documents the material-change rule) and by
 *     the PATCH /api/recipes/[slug] material-change path owned by the PATCH
 *     worker.
 */

/** Stable allergen-family label, and the name patterns that detect it. */
interface AllergenFamily {
  label: string;
  /** Case-insensitive patterns matched against the lowercased name. */
  patterns: RegExp[];
}

const ALLERGEN_FAMILIES: AllergenFamily[] = [
  {
    label: 'eggs',
    patterns: [
      /\beggs?\b/, // 'eggs', 'egg' — but NOT 'eggplant' (no word boundary there)
      /\banda\b/,
    ],
  },
  {
    label: 'fish',
    patterns: [
      /\bfish\b/,
      /\btuna\b/,
      /\bsalmon\b/,
      /\bmachhli\b/,
      /\bmachhi\b/,
      /\brohu\b/,
      /\bsurmai\b/,
    ],
  },
  {
    label: 'milk',
    patterns: [
      /\bmilk\b/,
      /\bdoodh\b/,
      /\bdahi\b/,
      /\bcurd\b/,
      /\byogurt\b/,
      /\byoghurt\b/,
      /\bpaneer\b/,
      /\bcheese\b/,
      /\bbutter\b/,
      /\bghee\b/,
      /\bdesi ghee\b/,
      /\bcream\b/,
      /\bmalai\b/,
      /\bkhoya\b/,
      /\bkhoa\b/,
      /\bwhey\b/,
      /\blassi\b/,
      /\bmilk powder\b/,
    ],
  },
  {
    label: 'peanuts',
    patterns: [/\bpeanut/, /\bmoong phali\b/],
  },
  {
    label: 'sesame',
    patterns: [/\bsesames?\b/, /\btil\b/],
  },
  {
    label: 'shellfish',
    patterns: [/\bshrimp\b/, /\bprawns?\b/, /\bcrab\b/, /\blobster\b/, /\bjhinga\b/],
  },
  {
    label: 'soy',
    patterns: [/\bsoy\b/, /\bsoya\b/, /\btofu\b/],
  },
  {
    label: 'tree nuts',
    // NOTE: deliberately NO bare /\bnut\b/ — it would match 'coconut'
    // (a drupe, not a tree nut for screening purposes here) and 'peanut'
    // (its own family, checked separately). Explicit nut names only.
    patterns: [
      /\balmonds?\b/,
      /\bcashews?\b/,
      /\bwalnuts?\b/,
      /\bpistachios?\b/,
      /\bpecans?\b/,
      /\bhazelnuts?\b/,
      /\bbrazil nuts?\b/,
      /\bkaju\b/,
      /\bbadam\b/,
      /\bakhrot\b/,
    ],
  },
  {
    label: 'wheat',
    // Gluten-cereal family detected by wheat itself AND by common
    // wheat-flour preparations (atta, maida, roti, naan, paratha) — a
    // screening is better over-inclusive here than silently missing wheat.
    patterns: [
      /\bwheat\b/,
      /\batta\b/,
      /\bmaida\b/,
      /\bbreads?\b/,
      /\brotis?\b/,
      /\bchapatis?\b/,
      /\bnaans?\b/,
      /\bparathas?\b/,
      /\bkulchas?\b/,
      /\bbhaturas?\b/,
      /\bpastas?\b/,
      /\bnoodles?\b/,
      /\bsuji\b/,
      /\bsemolina\b/,
      /\bbarley\b/,
      /\brye\b/,
      /\bbulgar\b/,
      /\bcouscous\b/,
      /\bflour\b/,
    ],
  },
];

/**
 * Screen ingredient names against the major allergen families.
 *
 * Returns the detected family labels (alphabetical, deduplicated).
 * EMPTY RESULT ≠ ALLERGEN-FREE: it means only "nothing detected in the
 * ingredient names". Never present this as a safety promise — always pair
 * it with ALLERGEN_CAVEAT (recipe-claims.ts).
 */
export function screenIngredientAllergens(
  names: (string | null | undefined)[],
): string[] {
  const hits = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    const lowered = name.toLowerCase();
    for (const family of ALLERGEN_FAMILIES) {
      if (family.patterns.some((p) => p.test(lowered))) {
        hits.add(family.label);
      }
    }
  }
  return [...hits].sort();
}

/** The claim inputs a recheck decision is made from. */
export interface DietAllergenInputs {
  /** Ingredient names (resolved row names at creation; stored row names at edit). */
  ingredients: (string | null | undefined)[];
  /** 'vegetarian' | 'non_vegetarian' (or null/unknown). */
  dietCategory?: string | null;
}

function nameKey(names: (string | null | undefined)[]): string {
  return names
    .map((n) => (n ?? '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * True when a material change between the previous and next recipe state
 * requires the dietary and allergen claims to be re-screened.
 *
 * Material = the ingredient NAME set changed (order-insensitive; a
 * grams-only change is not material for diet/allergen purposes) OR the
 * diet category changed. A portions-only change returns false.
 *
 * `prev` null/undefined = first record (creation): returns false — there is
 * nothing to *re*-check; the creation flow screens unconditionally.
 */
export function dietAllergenRecheckNeeded(
  prev: DietAllergenInputs | null | undefined,
  next: DietAllergenInputs,
): boolean {
  if (!prev) return false;
  if ((prev.dietCategory ?? '') !== (next.dietCategory ?? '')) return true;
  return nameKey(prev.ingredients) !== nameKey(next.ingredients);
}
