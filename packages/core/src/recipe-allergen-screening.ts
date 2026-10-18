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

// ---------------------------------------------------------------------------
// Allergen exclusion synonyms (v21.8 P3)
// ---------------------------------------------------------------------------

/**
 * User-facing exclusion terms → canonical allergen-family labels (the
 * `label` values of ALLERGEN_FAMILIES above, which are the stored
 * spellings in `Recipe.allergens`).
 *
 * Rationale: the browse API accepts `excludeAllergen` from ANY client
 * (typed input, deep links, other integrations), not just the UI's
 * canonical-label buttons. A user who types "dairy" means the milk
 * family; "gluten" means the wheat family; "tree nut" means the tree-nut
 * family. Without this mapping the DB-level NOT clause would match only
 * exact stored labels and silently return recipes the user asked to
 * exclude.
 *
 * Peanuts and tree nuts stay SEPARATE families (as in the screening
 * above — peanut is a legume, not a tree nut); "peanut/tree-nut family"
 * in the brief means both families are handled, not merged. Dairy maps
 * to the milk family; gluten maps to the wheat (gluten-cereal) family.
 * Keys are normalized (lowercase, hyphens/underscores → spaces,
 * collapsed whitespace) before lookup.
 */
const ALLERGEN_EXCLUSION_SYNONYMS: Record<string, string> = {
  // eggs
  egg: 'eggs',
  eggs: 'eggs',
  anda: 'eggs',
  // fish
  fish: 'fish',
  tuna: 'fish',
  salmon: 'fish',
  machhli: 'fish',
  machhi: 'fish',
  rohu: 'fish',
  surmai: 'fish',
  // milk (dairy)
  milk: 'milk',
  dairy: 'milk',
  lactose: 'milk',
  doodh: 'milk',
  dahi: 'milk',
  curd: 'milk',
  yogurt: 'milk',
  yoghurt: 'milk',
  paneer: 'milk',
  cheese: 'milk',
  butter: 'milk',
  ghee: 'milk',
  cream: 'milk',
  malai: 'milk',
  khoya: 'milk',
  khoa: 'milk',
  whey: 'milk',
  lassi: 'milk',
  'milk powder': 'milk',
  // peanuts
  peanut: 'peanuts',
  peanuts: 'peanuts',
  'moong phali': 'peanuts',
  groundnut: 'peanuts',
  groundnuts: 'peanuts',
  // sesame
  sesame: 'sesame',
  til: 'sesame',
  // shellfish
  shellfish: 'shellfish',
  shrimp: 'shellfish',
  shrimps: 'shellfish',
  prawn: 'shellfish',
  prawns: 'shellfish',
  crab: 'shellfish',
  crabs: 'shellfish',
  lobster: 'shellfish',
  lobsters: 'shellfish',
  jhinga: 'shellfish',
  // soy
  soy: 'soy',
  soya: 'soy',
  tofu: 'soy',
  // tree nuts
  'tree nut': 'tree nuts',
  'tree nuts': 'tree nuts',
  treenut: 'tree nuts',
  treenuts: 'tree nuts',
  almond: 'tree nuts',
  almonds: 'tree nuts',
  cashew: 'tree nuts',
  cashews: 'tree nuts',
  walnut: 'tree nuts',
  walnuts: 'tree nuts',
  pistachio: 'tree nuts',
  pistachios: 'tree nuts',
  pecan: 'tree nuts',
  pecans: 'tree nuts',
  hazelnut: 'tree nuts',
  hazelnuts: 'tree nuts',
  'brazil nut': 'tree nuts',
  'brazil nuts': 'tree nuts',
  kaju: 'tree nuts',
  badam: 'tree nuts',
  akhrot: 'tree nuts',
  // wheat (gluten cereals)
  wheat: 'wheat',
  gluten: 'wheat',
  atta: 'wheat',
  maida: 'wheat',
  bread: 'wheat',
  breads: 'wheat',
  roti: 'wheat',
  rotis: 'wheat',
  chapati: 'wheat',
  chapatis: 'wheat',
  naan: 'wheat',
  naans: 'wheat',
  paratha: 'wheat',
  parathas: 'wheat',
  kulcha: 'wheat',
  kulchas: 'wheat',
  bhatura: 'wheat',
  bhaturas: 'wheat',
  pasta: 'wheat',
  pastas: 'wheat',
  noodle: 'wheat',
  noodles: 'wheat',
  suji: 'wheat',
  semolina: 'wheat',
  barley: 'wheat',
  rye: 'wheat',
  bulgar: 'wheat',
  couscous: 'wheat',
  flour: 'wheat',
};

function normalizeExclusionTerm(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Resolve raw allergen-exclusion terms to canonical allergen-family
 * labels (deduplicated, alphabetical).
 *
 * Synonyms and canonical family names resolve to the stored family
 * labels ('dairy' → 'milk', 'gluten' → 'wheat', 'peanut' → 'peanuts',
 * 'tree nut' → 'tree nuts', …). An UNMAPPED term passes through
 * unchanged (normalized) — the caller's DB-level NOT clause still
 * applies to the raw stored label, so a user's exclusion request is
 * never silently dropped; callers must never invent matches for it.
 * Empty result = no exclusion requested.
 */
export function resolveAllergenExclusionTerms(
  terms: readonly (string | null | undefined)[],
): string[] {
  const out = new Set<string>();
  for (const term of terms) {
    if (!term) continue;
    const normalized = normalizeExclusionTerm(term);
    if (!normalized) continue;
    out.add(ALLERGEN_EXCLUSION_SYNONYMS[normalized] ?? normalized);
  }
  return [...out].sort();
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
