/**
 * FitFusion AI — vegetarian dietCategory conflict screening (v21.5 P3).
 *
 * PURE DATA MODULE: no imports from @prisma/client, no side effects, no I/O.
 * Single source of truth for checking a recipe's declared `dietCategory`
 * against its ingredient reality. Used by POST /api/recipes (creation) and
 * PATCH /api/recipes/[slug] (ingredient or dietCategory change).
 *
 * DESIGN DECISIONS (binding):
 *
 *  1. CONFLICTS are conservative: only UNAMBIGUOUS meat / poultry / fish /
 *     seafood triggers a rejection (chicken, beef, mutton, pork, fish,
 *     prawn, keema, offal … — word-boundary, plural-tolerant, in the same
 *     style as recipe-allergen-screening.ts). A declared 'vegetarian' with
 *     such an ingredient is REJECTED with a 400 naming the ingredient(s)
 *     (reject-with-clear-message) — never silently stored, never
 *     auto-corrected.
 *
 *  2. DAIRY AND EGGS ARE NOT CONFLICTS. Lacto-ovo vegetarian is the
 *     dominant vegetarian interpretation in this product's market
 *     (Pakistan / South Asia: paneer, dahi, desi ghee, anda are everyday
 *     vegetarian foods). Flagging them would false-positive the majority
 *     of genuine vegetarian recipes, so dairy/egg name patterns and the
 *     'Dairy' / 'Eggs' food categories are treated as CLEAR, never as
 *     conflicts.
 *
 *  3. AMBIGUITY IS NEVER RESOLVED IN FAVOUR OF VEGETARIAN. A free-text
 *     ingredient with no catalogue match, no trusted source and no
 *     known-vegetarian pattern hit ("chef's special mix") keeps the recipe
 *     under review (`needsReview` stays true) with a warning naming the
 *     ingredient. Unfamiliar ≠ vegetarian. The known-vegetarian
 *     vocabulary below is deliberately FINITE (common South-Asian staples
 *     plus everyday western items) — anything outside it is ambiguous,
 *     not clear.
 *
 *  4. NAME-BASED ONLY. Like the allergen screener, this is screening of
 *     ingredient NAMES, never a certified dietary analysis. A catalogue
 *     category signal ('Chicken, Meat & Fish') is trusted only as an exact
 *     (case-insensitive) match; vague categories ('Snacks & Street
 *     Food', 'Breakfast') carry no diet signal.
 *
 *  5. 'non_vegetarian' is never screened — there is nothing to conflict
 *     with. Screening runs only for dietCategory === 'vegetarian'.
 */

/** One ingredient row as the diet screener sees it. */
export interface DietScreenRow {
  /** Ingredient display name (user-typed or stored). */
  name: string;
  /**
   * Canonical catalogue name when the row resolved from a foodId
   * (v21.5: `canonicalName ?? name`). Screened alongside `name`.
   */
  canonicalName?: string | null;
  /**
   * Trusted Food.category name for foodId rows only (e.g.
   * 'Chicken, Meat & Fish'). Never invented — null when unknown.
   */
  foodCategoryName?: string | null;
  /** True when the row resolved from a trusted foodId catalogue lookup. */
  catalogueMatch?: boolean;
  /** True when the row is on the explicit known-zero list (salt, water, spices). */
  knownZero?: boolean;
}

/** Screening outcome for one vegetarian-declared recipe. */
export interface DietScreenResult {
  /** Display names with UNAMBIGUOUS meat/poultry/fish/seafood → reject. */
  conflicts: string[];
  /** Display names that could NOT be confirmed vegetarian → keep under review. */
  ambiguous: string[];
}

/**
 * Food-category names that are an unambiguous meat/poultry/fish signal.
 * Compared case-insensitively after trimming. 'Dairy' and 'Eggs' are
 * deliberately ABSENT (see decision 2 above).
 */
const MEAT_CATEGORY_NAMES = new Set(['chicken, meat & fish']);

/**
 * Unambiguous meat / poultry / fish / seafood name patterns.
 * Word-boundary, plural-tolerant — same style as the allergen screener.
 * Deliberately flesh foods only: dishes with vegetarian variants
 * (kebab, tikka, biryani, haleem, nihari) are NOT here.
 */
const MEAT_PATTERNS: RegExp[] = [
  // poultry
  /\bchickens?\b/, /\bmurgh[ai]\b/, /\bmurghi\b/,
  /\bturkeys?\b/, /\bducks?\b/, /\bbatakh\b/,
  /\bquails?\b/, /\bbatair\b/,
  // red meat
  /\bbeefs?\b/, /\bmuttons?\b/, /\bporks?\b/, /\bsuar\b/,
  /\bgoats?\b/, /\bbakr[ai]\b/, /\blambs?\b/,
  /\bvenisons?\b/, /\bhiran\b/,
  // fish
  /\bfish\b/, /\bfishes\b/, /\bmachhli\b/, /\bmachhi\b/,
  /\btunas?\b/, /\bsalmons?\b/, /\brohu\b/, /\bsurmai\b/,
  /\bpomfrets?\b/, /\bhilsa\b/, /\bsardines?\b/, /\bmackerels?\b/,
  /\bsquids?\b/,
  // shellfish / seafood
  /\bprawns?\b/, /\bjhinga\b/, /\bshrimps?\b/,
  /\bcrabs?\b/, /\bkekr[ae]\b/, /\blobsters?\b/,
  // offal (unambiguous flesh)
  /\blivers?\b/, /\bkaleji\b/, /\bkidneys?\b/, /\bgurd[ae]\b/,
  /\brains?\b/, /\bmaghaz\b/, /\bpaya\b/,
  // processed meat
  /\bsausages?\b/, /\bbacons?\b/, /\bhams?\b/,
  /\bsalamis?\b/, /\bpepperonis?\b/,
  // bare "meat" — see the masala carve-out in screenVegetarianDiet
  /\bmeat\b/,
];

/** Minced-meat words. Guarded: "soya keema" / "nutri keema" are vegetarian. */
const KEEMA_RE = /\bkeema\b|\bqeema\b/;
const KEEMA_VEG_GUARD = /\bsoya?\b|\bnutri\b|\bveg\b|\bvegetables?\b/;

/**
 * "X masala" blends (meat masala, chicken masala, fish masala) are spice
 * mixes and vegetarian; the same words name meat dishes. Genuinely
 * ambiguous → never a hard conflict, always flagged for review.
 */
const MASALA_RE = /\bmasalas?\b/;

/**
 * Known-vegetarian vocabulary: unambiguous plant / dairy / egg terms.
 * Deliberately FINITE — anything not matched here (and not from a trusted
 * source) is AMBIGUOUS, never assumed vegetarian (decision 3).
 */
const VEGETARIAN_PATTERNS: RegExp[] = [
  // lentils, beans, pulses
  /\bda?als?\b/, /\bmasoor\b/, /\bmoong\b/, /\burad\b/, /\bmah\b/,
  /\bchan[ae]\b/, /\bchana\b/, /\bchickpeas?\b/, /\bkabuli\b/,
  /\brajma\b/, /\blobia\b/, /\barhar\b/, /\btoor\b/,
  /\bmatar\b/, /\bpeas?\b/, /\bsoy\b/, /\bsoya\b/, /\btofu\b/, /\bnutri\b/,
  /\bkidney beans?\b/, /\bblack eyed peas?\b/, /\bblack-eyed peas?\b/,
  // vegetables
  /\bvegetables?\b/, /\bsabzi\b/, /\bsabziyan\b/,
  /\baloo\b/, /\bpotato(es)?\b/,
  /\bgobhi\b/, /\bgobi\b/, /\bcauliflowers?\b/, /\bband gobhi\b/,
  /\bpalak\b/, /\bspinach\b/, /\bsaag\b/,
  /\bbhindi\b/, /\bokras?\b/,
  /\bpyaz\b/, /\bonions?\b/,
  /\btamatar\b/, /\btomato(es)?\b/,
  /\bgajar\b/, /\bcarrots?\b/,
  /\bcabbages?\b/,
  /\bbaingan\b/, /\beggplants?\b/, /\bbrinjals?\b/,
  /\bshimla mirch\b/, /\bbell peppers?\b/, /\bcapsicums?\b/,
  /\blauki\b/, /\bbottle gourds?\b/, /\bghiya\b/,
  /\btori\b/, /\btoriyan\b/, /\bsponge gourds?\b/,
  /\bkarela\b/, /\bbitter gourds?\b/,
  /\bmooli\b/, /\bradish(es)?\b/,
  /\bshalgam\b/, /\bturnips?\b/,
  /\barvi\b/, /\btaro\b/,
  /\bmushrooms?\b/,
  /\bcorns?\b/, /\bmakai\b/, /\bbhutta\b/,
  /\bkheera\b/, /\bcucumbers?\b/,
  /\bgreen beans?\b/, /\bfrench beans?\b/,
  /\bsalad\b/, /\bsalad patta\b/,
  /\blemons?\b/, /\bnimbu\b/, /\blimes?\b/,
  /\badrak\b/, /\bginger\b/, /\blehsan\b/, /\bgarlic\b/,
  /\bhara dhaniya\b/, /\bcoriander leaves\b/,
  /\bpapaya\b/, /\bpapita\b/,
  // dairy (decision 2: clear, never a conflict)
  /\bmilk\b/, /\bdoodh\b/, /\bdahi\b/, /\bcurd\b/,
  /\byogurt\b/, /\byoghurt\b/, /\bpaneer\b/, /\bcheese\b/,
  /\bbutter\b/, /\bmakkhan\b/, /\bghee\b/, /\bdesi ghee\b/,
  /\bcream\b/, /\bmalai\b/, /\bkhoya\b/, /\bkhoa\b/,
  /\bwhey\b/, /\blassi\b/, /\bmilk powder\b/,
  // eggs (decision 2: clear, never a conflict)
  /\beggs?\b/, /\banda\b/,
  // grains & flours
  /\batta\b/, /\bmaida\b/, /\bbesan\b/,
  /\brotis?\b/, /\bchapatis?\b/, /\bnaans?\b/, /\bparathas?\b/,
  /\bkulchas?\b/, /\bbhatur[ae]s?\b/, /\bpooris?\b/, /\bbreads?\b/,
  /\brice\b/, /\bchawal\b/, /\bbiryani rice\b/,
  /\bwheat\b/, /\bsuji\b/, /\bsemolina\b/,
  /\boats?\b/, /\bbarley\b/, /\bquinoa\b/, /\bcornflour\b/,
  /\bpastas?\b/, /\bnoodles?\b/, /\bvermicelli\b/, /\bseviyan\b/,
  // fruits
  /\bfruits?\b/, /\bphal\b/,
  /\bapples?\b/, /\bseb\b/, /\bbananas?\b/, /\bkela\b/,
  /\bmangoes?\b/, /\baam\b/, /\boranges?\b/, /\bsantra\b/, /\bmaltas?\b/,
  /\bgrapes?\b/, /\bangoor\b/, /\bwatermelons?\b/, /\btarbooz\b/,
  /\bmelons?\b/, /\bkharbooja\b/, /\bpineapples?\b/, /\bananas\b/,
  /\bpomegranates?\b/, /\banaar\b/, /\bguavas?\b/, /\bamrood\b/,
  /\bpeaches?\b/, /\baaroo\b/, /\bpears?\b/, /\bnashpati\b/,
  /\bplums?\b/, /\baloo bukhara\b/, /\bdates?\b/, /\bkhajoor\b/,
  /\bfigs?\b/, /\banjeer\b/, /\bcoconuts?\b/, /\bnariyal\b/,
  /\bstrawberr(y|ies)\b/,
  // spices, oils, sweeteners
  /\bsalt\b/, /\bnamak\b/, /\bwater\b/, /\bpani\b/,
  /\bhaldi\b/, /\bturmeric\b/,
  /\bmirch\b/, /\bchill?ies\b/, /\blal mirch\b/, /\bkali mirch\b/,
  /\bblack peppers?\b/, /\bzeera\b/, /\bcumin\b/,
  /\bdhaniya\b/, /\bcoriander\b/, /\bgaram masala\b/, /\bchat masala\b/,
  /\bmasalas?\b/, /\bajwain\b/, /\brai\b/, /\bmustard seeds?\b/,
  /\bkalonji\b/, /\bmethi\b/, /\bfenugreek\b/,
  /\belaichi\b/, /\bcardamoms?\b/, /\blaung\b/, /\bcloves?\b/,
  /\bdalchini\b/, /\bcinnamon\b/, /\bimli\b/, /\btamarind\b/,
  /\baamchur\b/, /\bhing\b/, /\basafoetida\b/,
  /\boils?\b/, /\btel\b/, /\bsugar\b/, /\bcheeni\b/,
  /\bgur\b/, /\bjaggery\b/, /\bhoney\b/, /\bshehad\b/,
  /\bvinegar\b/, /\bsirka\b/, /\bbaking powder\b/, /\bbaking soda\b/,
  /\byeast\b/, /\bkhameer\b/, /\btea\b/, /\bchai\b/, /\bcoffee\b/,
];

function candidatesOf(row: DietScreenRow): string[] {
  return [row.name, row.canonicalName]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .map((s) => s.toLowerCase());
}

function dedupe(names: string[]): string[] {
  return [...new Set(names)];
}

/**
 * Screen ingredient rows for a 'vegetarian' declaration.
 *
 * Returns the UNAMBIGUOUS meat/poultry/fish/seafood hits (`conflicts`)
 * and the free-text rows that could not be confirmed vegetarian
 * (`ambiguous`). Pure: no I/O, no side effects.
 *
 * Decision order per row:
 *  1. Trusted category signal ('Chicken, Meat & Fish') → conflict.
 *  2. Unambiguous meat name pattern (name or canonicalName) → conflict,
 *     EXCEPT "X masala" blends → ambiguous, and guarded keema
 *     ("soya keema") → not a conflict.
 *  3. Trusted source (catalogue match / known-zero list) or a
 *     known-vegetarian pattern hit → clear.
 *  4. Otherwise → ambiguous (never assumed vegetarian).
 */
export function screenVegetarianDiet(rows: DietScreenRow[]): DietScreenResult {
  const conflicts: string[] = [];
  const ambiguous: string[] = [];

  for (const row of rows) {
    const display = row.name;
    const lowered = candidatesOf(row);
    if (lowered.length === 0) continue;

    // 1. Trusted category signal (foodId rows only; never invented).
    const category = (row.foodCategoryName ?? '').trim().toLowerCase();
    if (category && MEAT_CATEGORY_NAMES.has(category)) {
      conflicts.push(display);
      continue;
    }

    // 2. Unambiguous meat / poultry / fish / seafood in the name.
    const meatHit = lowered.some((c) => MEAT_PATTERNS.some((p) => p.test(c)));
    const keemaHit = lowered.some(
      (c) => KEEMA_RE.test(c) && !KEEMA_VEG_GUARD.test(c),
    );
    if (meatHit || keemaHit) {
      // "X masala" blends are genuinely ambiguous (spice mix vs dish).
      const masalaBlend = lowered.some((c) => MASALA_RE.test(c));
      if (masalaBlend) ambiguous.push(display);
      else conflicts.push(display);
      continue;
    }

    // 3. Trusted source or known-vegetarian vocabulary → clear.
    if (row.catalogueMatch || row.knownZero) continue;
    if (lowered.some((c) => VEGETARIAN_PATTERNS.some((p) => p.test(c)))) continue;

    // 4. Unfamiliar free text → ambiguous, never assumed vegetarian.
    ambiguous.push(display);
  }

  return { conflicts: dedupe(conflicts), ambiguous: dedupe(ambiguous) };
}

/** Verdict the routes act on. `ok: false` → the route must 400. */
export interface DietCheckVerdict {
  ok: boolean;
  conflicts: string[];
  ambiguous: string[];
}

/**
 * Route-level check: only dietCategory === 'vegetarian' is screened
 * (exact enum values from CustomRecipeSchema). 'non_vegetarian' (or
 * anything else) is never a conflict — there is nothing to conflict with.
 */
export function checkRecipeDiet(
  rows: DietScreenRow[],
  dietCategory: string,
): DietCheckVerdict {
  if (dietCategory !== 'vegetarian') {
    return { ok: true, conflicts: [], ambiguous: [] };
  }
  const { conflicts, ambiguous } = screenVegetarianDiet(rows);
  return { ok: conflicts.length === 0, conflicts, ambiguous };
}

/**
 * 400 message for a rejected vegetarian declaration. Names the offending
 * ingredient(s) and tells the user exactly how to fix it (remove the
 * ingredient or declare non_vegetarian).
 */
export function dietConflictMessage(
  conflicts: string[],
  dietCategory: string,
): string {
  const list = conflicts.map((c) => `"${c}"`).join(', ');
  const verb = conflicts.length === 1 ? 'is' : 'are';
  return (
    `Diet conflict: ${list} ${verb} meat, poultry, fish or seafood and ` +
    `cannot be in a recipe declared '${dietCategory}'. Remove the ` +
    `ingredient or change the diet category to 'non_vegetarian'.`
  );
}

/**
 * Warning for ambiguous free-text ingredients on a vegetarian declaration.
 * Surfaced to the client and paired with needsReview = true — vegetarian
 * is never claimed for these ingredients.
 */
export function dietAmbiguityWarning(ambiguous: string[]): string {
  const list = ambiguous.map((c) => `"${c}"`).join(', ');
  return (
    `Could not confirm vegetarian for ${list} (no catalogue match and no ` +
    `recognised vegetarian ingredient) — kept under review. Vegetarian is ` +
    `not claimed for these ingredients.`
  );
}
