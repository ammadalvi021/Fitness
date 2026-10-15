/**
 * FitFusion AI — Recipe ingredient database (Phase 1 of recipe expansion, v21).
 *
 * PURE DATA MODULE: no imports from @prisma/client, no side effects.
 * Recipe workers / `packages/core/src/recipe-engine.ts` import INGREDIENTS
 * and pass it into the pure engine functions. Importing this module must
 * never touch the DB (there is a purity test enforcing this).
 *
 * HONESTY CONTRACT (binding):
 *  - basis: 'USDA FoodData Central standard reference' — per-100-g values are
 *    USDA FoodData Central standard-reference values, NOT measured or
 *    lab-verified values for any specific product or brand.
 *  - Raw vs cooked (and dry vs cooked) are SEPARATE entries, e.g.
 *    'Basmati rice (raw)' vs 'Basmati rice (cooked)'. Recipe workers must use
 *    the state named in the recipe; when the recipe names no state, the
 *    engine defaults to the raw/dry variant and says so in `warnings`.
 *  - per100 is [kcal, proteinG, carbsG, fatG, fiberG] per 100 g.
 *  - Spice entries (category 'Spices') are intentionally recorded as all
 *    zeros. This is a documented simplification, not a claim that spices have
 *    no calories: recipe quantities for spices are gram-level ('to taste' →
 *    2 g), so their contribution is nutritionally negligible, and zeroing
 *    them keeps recipe totals stable. Water and salt are genuinely 0.
 *  - `pieceGrams` is a standard home-kitchen piece weight (1 medium onion =
 *    120 g, 1 egg = 50 g). The engine falls back to documented defaults when
 *    an ingredient has no pieceGrams.
 *  - `densityMl` is used only for ml/l/cup conversions (default 1.0);
 *    tbsp/tsp are flat gram conversions (15 g / 5 g) per the engine spec.
 *
 * PROVENANCE (v21.2 P9):
 *  - `source` mirrors the already-recorded `basis` in plainer terms
 *    ('USDA FoodData Central' | 'standard estimate') — populated for every
 *    entry from the existing basis; no new factual claim is introduced.
 *  - `sourceRef` holds a VERBATIM source record identifier ONLY when one
 *    was actually captured (the `usda-<fdcId>` form used by
 *    apps/web/lib/usda.ts, where fdcId is the numeric FoodData Central ID).
 *    No v21 entry has one: per-100-g values are standard-reference values,
 *    not per-record extractions, and the FDC IDs were never captured at
 *    generation time. An absent sourceRef is honest; a fabricated one would
 *    be data fraud — NEVER invent one to fill the field.
 *  - `lastReviewedAt` is an ISO-8601 date the values were last checked
 *    against the source. Absent = never recorded. Never backfilled.
 */

export interface IngredientSeed {
  /** Canonical name. Raw/cooked state is always in parentheses when relevant. */
  name: string;
  category: string;
  /** Per-100-g: [kcal, proteinG, carbsG, fatG, fiberG]. */
  per100: [number, number, number, number, number];
  /** English + Roman Urdu aliases, lowercased by convention. */
  aliases: string[];
  /** Grams per countable piece (1 egg, 1 medium onion, ...). */
  pieceGrams?: number;
  /** g per ml for volume→weight conversion (default 1.0). */
  densityMl?: number;
  basis: 'USDA FoodData Central standard reference' | 'Standard reference estimate';
  /**
   * Where the per-100-g values came from, in plainer terms than `basis`.
   * Populated for every entry from the already-recorded basis.
   */
  source: 'USDA FoodData Central' | 'standard estimate';
  /**
   * Verbatim source record identifier, ONLY when actually captured
   * (e.g. 'usda-173944' — the `usda-<fdcId>` form from apps/web/lib/usda.ts).
   * NEVER invented. Absent for all v21 entries (IDs never captured).
   */
  sourceRef?: string;
  /**
   * ISO-8601 date the values were last checked against the source.
   * Absent = never recorded. Never backfilled with a guess.
   */
  lastReviewedAt?: string;
}

const USDA = 'USDA FoodData Central standard reference' as const;
const EST = 'Standard reference estimate' as const;
const ZERO: [number, number, number, number, number] = [0, 0, 0, 0, 0];

export const INGREDIENTS: IngredientSeed[] = [
  // ------------------------------------------------------- Meat, Fish & Eggs
  { name: 'Chicken breast (raw)', category: 'Meat, Fish & Eggs', per100: [120, 22.5, 0, 2.6, 0], aliases: ['chicken breast', 'chicken ka seena', 'murghi breast'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chicken breast (cooked)', category: 'Meat, Fish & Eggs', per100: [165, 31.0, 0, 3.6, 0], aliases: ['cooked chicken breast', 'grilled chicken breast'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chicken thigh (raw)', category: 'Meat, Fish & Eggs', per100: [144, 17.9, 0, 7.2, 0], aliases: ['chicken thigh', 'murghi ki raan'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chicken thigh (cooked)', category: 'Meat, Fish & Eggs', per100: [195, 26.0, 0, 10.1, 0], aliases: ['cooked chicken thigh'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chicken drumstick (raw)', category: 'Meat, Fish & Eggs', per100: [161, 18.1, 0, 9.2, 0], aliases: ['chicken drumstick', 'chicken leg'], pieceGrams: 110, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chicken wings (raw)', category: 'Meat, Fish & Eggs', per100: [191, 17.3, 0, 12.9, 0], aliases: ['chicken wings'], pieceGrams: 90, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chicken keema (raw)', category: 'Meat, Fish & Eggs', per100: [143, 17.4, 0.1, 8.1, 0], aliases: ['minced chicken', 'chicken mince', 'murghi ka keema', 'chicken qeema'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chicken liver (raw)', category: 'Meat, Fish & Eggs', per100: [119, 17.3, 0.9, 5.9, 0], aliases: ['chicken liver', 'murghi ki kaleji'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Beef (raw, lean)', category: 'Meat, Fish & Eggs', per100: [144, 20.0, 0, 7.0, 0], aliases: ['beef', 'lean beef', 'gaye ka gosht'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Beef (cooked, lean)', category: 'Meat, Fish & Eggs', per100: [198, 27.7, 0, 9.5, 0], aliases: ['cooked beef'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Beef keema (raw)', category: 'Meat, Fish & Eggs', per100: [254, 17.2, 0, 20.0, 0], aliases: ['minced beef', 'beef mince', 'keema', 'qeema', 'beef qeema'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mutton (raw)', category: 'Meat, Fish & Eggs', per100: [143, 27.1, 0, 3.0, 0], aliases: ['mutton', 'goat meat', 'bakray ka gosht'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mutton (cooked)', category: 'Meat, Fish & Eggs', per100: [205, 26.3, 0, 9.7, 0], aliases: ['cooked mutton', 'cooked goat meat'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Fish - Rohu (raw)', category: 'Meat, Fish & Eggs', per100: [97, 17.0, 0, 3.0, 0], aliases: ['rohu', 'rohu fish', 'machli', 'machhi'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Fish - white fish (cooked)', category: 'Meat, Fish & Eggs', per100: [105, 22.0, 0, 2.6, 0], aliases: ['cooked fish', 'cooked white fish'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Salmon (raw)', category: 'Meat, Fish & Eggs', per100: [208, 20.0, 0, 13.0, 0], aliases: ['salmon'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Prawns (raw)', category: 'Meat, Fish & Eggs', per100: [85, 20.1, 0.2, 0.5, 0], aliases: ['prawns', 'shrimp', 'jheenga', 'jhinga'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Tuna (canned in water)', category: 'Meat, Fish & Eggs', per100: [132, 27.7, 0, 1.3, 0], aliases: ['canned tuna', 'tuna'], pieceGrams: 145, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Egg (raw)', category: 'Meat, Fish & Eggs', per100: [143, 12.6, 0.7, 9.5, 0], aliases: ['egg', 'anda', 'anday'], pieceGrams: 50, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Egg (boiled)', category: 'Meat, Fish & Eggs', per100: [155, 12.6, 1.1, 10.6, 0], aliases: ['boiled egg', 'uble hue anday', 'hard boiled egg'], pieceGrams: 50, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Egg white (raw)', category: 'Meat, Fish & Eggs', per100: [52, 10.9, 0.7, 0.2, 0], aliases: ['egg white', 'anday ki safedi'], pieceGrams: 33, basis: USDA, source: 'USDA FoodData Central' },

  // ------------------------------------------------------------ Daals & Beans
  { name: 'Masoor daal (dry)', category: 'Daals & Beans', per100: [352, 24.6, 63.4, 1.1, 10.7], aliases: ['masoor daal', 'red lentils', 'lal masoor', 'masoor dal'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Masoor daal (cooked)', category: 'Daals & Beans', per100: [116, 9.0, 20.1, 0.4, 7.9], aliases: ['cooked masoor daal', 'cooked red lentils'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Moong daal (dry, split)', category: 'Daals & Beans', per100: [347, 23.9, 62.6, 1.2, 16.3], aliases: ['moong daal', 'split mung beans', 'dhuli moong', 'moong dal'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Moong daal (cooked)', category: 'Daals & Beans', per100: [105, 7.0, 19.2, 0.4, 7.6], aliases: ['cooked moong daal'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chana daal (dry)', category: 'Daals & Beans', per100: [364, 19.3, 60.7, 6.0, 17.4], aliases: ['chana daal', 'chana dal', 'split bengal gram'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chana daal (cooked)', category: 'Daals & Beans', per100: [162, 9.0, 27.4, 2.6, 7.6], aliases: ['cooked chana daal'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Urad daal (dry)', category: 'Daals & Beans', per100: [341, 25.2, 58.9, 1.6, 18.3], aliases: ['urad daal', 'urad dal', 'dhuli urad', 'split black gram'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Urad daal (cooked)', category: 'Daals & Beans', per100: [117, 8.7, 20.9, 0.4, 8.0], aliases: ['cooked urad daal'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Kale chane (dry)', category: 'Daals & Beans', per100: [364, 19.3, 60.7, 6.0, 17.4], aliases: ['kale chane', 'kala chana', 'black chickpeas', 'kala chane'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Kale chane (cooked)', category: 'Daals & Beans', per100: [164, 9.0, 27.4, 2.6, 7.6], aliases: ['cooked kale chane', 'cooked black chickpeas'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Kabuli chana (dry)', category: 'Daals & Beans', per100: [364, 19.3, 60.7, 6.0, 17.4], aliases: ['kabuli chana', 'safed chana', 'white chickpeas', 'garbanzo beans'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Kabuli chana (cooked)', category: 'Daals & Beans', per100: [164, 9.0, 27.4, 2.6, 7.6], aliases: ['cooked kabuli chana', 'cooked white chickpeas', 'cooked garbanzo beans'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Rajma (dry)', category: 'Daals & Beans', per100: [333, 23.4, 60.0, 0.8, 24.9], aliases: ['rajma', 'kidney beans', 'red kidney beans', 'lal lobia'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Rajma (cooked)', category: 'Daals & Beans', per100: [127, 8.7, 22.8, 0.5, 7.4], aliases: ['cooked rajma', 'cooked kidney beans'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Black-eyed peas (dry)', category: 'Daals & Beans', per100: [336, 23.5, 60.0, 1.3, 10.6], aliases: ['black-eyed peas', 'black eyed peas', 'lobia'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Black-eyed peas (cooked)', category: 'Daals & Beans', per100: [97, 7.7, 17.9, 0.4, 6.5], aliases: ['cooked black-eyed peas', 'cooked lobia'], basis: USDA, source: 'USDA FoodData Central' },

  // ------------------------------------------------------------ Rice & Grains
  { name: 'Basmati rice (raw)', category: 'Rice & Grains', per100: [360, 6.6, 79.9, 0.6, 1.3], aliases: ['basmati rice', 'basmati', 'chawal'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Basmati rice (cooked)', category: 'Rice & Grains', per100: [130, 2.7, 28.2, 0.3, 0.4], aliases: ['cooked basmati rice', 'cooked rice', 'uble hue chawal', 'pake hue chawal'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Brown rice (raw)', category: 'Rice & Grains', per100: [370, 7.9, 77.2, 2.9, 3.5], aliases: ['brown rice'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Brown rice (cooked)', category: 'Rice & Grains', per100: [112, 2.3, 23.5, 0.8, 1.8], aliases: ['cooked brown rice'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Atta (whole wheat flour)', category: 'Flours', per100: [340, 13.2, 72.0, 2.5, 10.7], aliases: ['atta', 'whole wheat flour', 'gehu ka atta', 'wheat flour'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Maida (all-purpose flour)', category: 'Flours', per100: [364, 10.3, 76.3, 1.0, 2.7], aliases: ['maida', 'all-purpose flour', 'all purpose flour', 'refined flour'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Besan (gram flour)', category: 'Flours', per100: [387, 22.4, 57.8, 6.7, 10.8], aliases: ['besan', 'gram flour', 'chickpea flour'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Rice flour', category: 'Flours', per100: [366, 6.0, 80.1, 1.4, 2.4], aliases: ['chawal ka atta'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Corn flour', category: 'Flours', per100: [381, 0.3, 91.3, 0.1, 0.9], aliases: ['cornflour', 'cornstarch', 'corn starch'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Oats', category: 'Flours', per100: [389, 16.9, 66.3, 6.9, 10.6], aliases: ['oatmeal', 'jai', 'rolled oats'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Sooji (semolina)', category: 'Flours', per100: [360, 12.7, 72.8, 1.1, 3.9], aliases: ['sooji', 'suji', 'semolina', 'rava'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Bajra (pearl millet)', category: 'Flours', per100: [378, 11.0, 72.8, 4.2, 8.5], aliases: ['bajra', 'pearl millet', 'bajre ka atta'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Roti (whole wheat)', category: 'Bread & Bakery', per100: [265, 7.9, 49.0, 2.6, 6.0], aliases: ['roti', 'chapati', 'phulka', 'whole wheat roti'], pieceGrams: 35, basis: USDA, source: 'USDA FoodData Central' },

  // ------------------------------------------------------------------- Dairy
  { name: 'Milk (whole)', category: 'Dairy', per100: [61, 3.2, 4.8, 3.3, 0], aliases: ['milk', 'whole milk', 'doodh'], densityMl: 1.03, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Milk (skim)', category: 'Dairy', per100: [34, 3.4, 5.0, 0.1, 0], aliases: ['skim milk', 'skimmed milk', 'fat free milk'], densityMl: 1.03, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Dahi (plain yogurt)', category: 'Dairy', per100: [63, 3.5, 4.7, 3.3, 0], aliases: ['dahi', 'yogurt', 'curd', 'plain yogurt'], densityMl: 1.03, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Greek yogurt', category: 'Dairy', per100: [97, 9.0, 3.9, 5.0, 0], aliases: ['greek yoghurt', 'hung curd'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Butter', category: 'Dairy', per100: [717, 0.9, 0.1, 81.1, 0], aliases: ['makhan'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Paneer', category: 'Dairy', per100: [265, 18.3, 3.6, 20.8, 0], aliases: ['paneer', 'indian cottage cheese'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cheddar cheese', category: 'Dairy', per100: [403, 24.9, 3.3, 33.1, 0], aliases: ['cheddar', 'cheddar cheese'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mozzarella', category: 'Dairy', per100: [280, 27.5, 3.1, 17.1, 0], aliases: ['mozzarella cheese'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cream (heavy)', category: 'Dairy', per100: [345, 2.8, 4.4, 36.1, 0], aliases: ['cream', 'heavy cream', 'malai'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Khoya', category: 'Dairy', per100: [413, 14.6, 17.3, 30.6, 0], aliases: ['khoya', 'khoa', 'mawa'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Milk powder', category: 'Dairy', per100: [496, 26.3, 38.4, 26.7, 0], aliases: ['milk powder', 'powdered milk', 'dry milk', 'khushk doodh'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Evaporated milk', category: 'Dairy', per100: [134, 6.9, 10.0, 7.6, 0], aliases: ['evaporated milk'], basis: USDA, source: 'USDA FoodData Central' },

  // --------------------------------------------------------------- Vegetables
  { name: 'Onion', category: 'Vegetables', per100: [40, 1.1, 9.3, 0.1, 1.7], aliases: ['pyaz', 'pyaaz', 'onions'], pieceGrams: 120, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Tomato', category: 'Vegetables', per100: [18, 0.9, 3.9, 0.2, 1.2], aliases: ['tamatar', 'tomatoes'], pieceGrams: 100, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Potato', category: 'Vegetables', per100: [77, 2.0, 17.6, 0.1, 2.1], aliases: ['aloo', 'alu', 'potatoes'], pieceGrams: 150, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Garlic', category: 'Vegetables', per100: [149, 6.4, 33.1, 0.5, 2.1], aliases: ['lehsan', 'lahsan'], pieceGrams: 4, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Ginger', category: 'Vegetables', per100: [80, 1.8, 17.8, 0.8, 2.0], aliases: ['adrak'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Green chili', category: 'Vegetables', per100: [40, 1.9, 9.5, 0.4, 1.5], aliases: ['green chili', 'green chilli', 'hari mirch', 'green chilies'], pieceGrams: 5, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Bell pepper', category: 'Vegetables', per100: [31, 1.0, 6.0, 0.3, 2.1], aliases: ['shimla mirch', 'capsicum'], pieceGrams: 120, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Spinach', category: 'Vegetables', per100: [23, 2.9, 3.6, 0.4, 2.2], aliases: ['palak'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cauliflower', category: 'Vegetables', per100: [25, 1.9, 5.0, 0.3, 2.0], aliases: ['phool gobhi', 'gobhi'], pieceGrams: 500, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cabbage', category: 'Vegetables', per100: [25, 1.3, 5.8, 0.1, 2.5], aliases: ['band gobhi', 'patta gobhi'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Carrot', category: 'Vegetables', per100: [41, 0.9, 9.6, 0.2, 2.8], aliases: ['gajar', 'gajjar'], pieceGrams: 60, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Peas', category: 'Vegetables', per100: [81, 5.4, 14.5, 0.4, 5.1], aliases: ['matar', 'green peas', 'mutter'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Okra', category: 'Vegetables', per100: [33, 1.9, 7.5, 0.2, 3.2], aliases: ['bhindi', 'ladyfinger', 'lady finger'], pieceGrams: 10, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Eggplant', category: 'Vegetables', per100: [25, 1.0, 5.9, 0.2, 3.0], aliases: ['baingan', 'brinjal'], pieceGrams: 200, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Bitter gourd', category: 'Vegetables', per100: [17, 1.0, 3.7, 0.2, 2.8], aliases: ['karela'], pieceGrams: 100, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cucumber', category: 'Vegetables', per100: [15, 0.7, 3.6, 0.1, 0.5], aliases: ['kheera', 'kakri'], pieceGrams: 200, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Lemon', category: 'Vegetables', per100: [29, 1.1, 9.3, 0.3, 2.8], aliases: ['nimbu', 'limbu', 'limon'], pieceGrams: 60, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Coriander leaves', category: 'Vegetables', per100: [23, 2.1, 3.7, 0.5, 2.8], aliases: ['dhania', 'cilantro', 'hara dhania', 'coriander'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mint', category: 'Vegetables', per100: [44, 3.3, 8.0, 0.6, 6.8], aliases: ['pudina'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Curry leaves', category: 'Vegetables', per100: [108, 6.1, 18.7, 1.0, 6.4], aliases: ['kari patta', 'karhi patta'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Fenugreek leaves', category: 'Vegetables', per100: [49, 4.4, 8.4, 0.9, 4.9], aliases: ['methi', 'methi leaves'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mustard greens', category: 'Vegetables', per100: [27, 2.9, 4.7, 0.4, 3.2], aliases: ['saag', 'sarson ka saag', 'mustard leaves'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Bottle gourd', category: 'Vegetables', per100: [14, 0.6, 3.4, 0.02, 0.5], aliases: ['lauki', 'ghiya', 'dudhi'], pieceGrams: 500, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mushroom', category: 'Vegetables', per100: [22, 3.1, 3.3, 0.3, 1.0], aliases: ['khumbi', 'mushrooms'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Sweet corn', category: 'Vegetables', per100: [86, 3.3, 18.7, 1.4, 2.0], aliases: ['makai', 'corn', 'bhutta'], pieceGrams: 150, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Turnip', category: 'Vegetables', per100: [28, 0.9, 6.4, 0.1, 1.8], aliases: ['shalgam'], pieceGrams: 150, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Radish', category: 'Vegetables', per100: [16, 0.7, 3.4, 0.1, 1.6], aliases: ['mooli', 'muli'], pieceGrams: 100, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Beetroot', category: 'Vegetables', per100: [43, 1.6, 9.6, 0.2, 2.8], aliases: ['chukandar'], pieceGrams: 100, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Green beans', category: 'Vegetables', per100: [31, 1.8, 7.0, 0.2, 2.7], aliases: ['phali', 'french beans'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Broccoli', category: 'Vegetables', per100: [34, 2.8, 6.6, 0.4, 2.6], aliases: ['hari gobhi'], basis: USDA, source: 'USDA FoodData Central' },

  // -------------------------------------------------------------------- Fruits
  { name: 'Banana', category: 'Fruits', per100: [89, 1.1, 22.8, 0.3, 2.6], aliases: ['kela'], pieceGrams: 120, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Apple', category: 'Fruits', per100: [52, 0.3, 13.8, 0.2, 2.4], aliases: ['seb'], pieceGrams: 180, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mango', category: 'Fruits', per100: [60, 0.8, 15.0, 0.4, 1.6], aliases: ['aam'], pieceGrams: 200, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Orange', category: 'Fruits', per100: [47, 0.9, 11.8, 0.1, 2.4], aliases: ['santra', 'malta', 'kinnow'], pieceGrams: 130, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Papaya', category: 'Fruits', per100: [43, 0.5, 10.8, 0.3, 1.7], aliases: ['papita'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Guava', category: 'Fruits', per100: [68, 2.6, 14.3, 1.0, 5.4], aliases: ['amrood'], pieceGrams: 100, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Grapes', category: 'Fruits', per100: [69, 0.7, 18.1, 0.2, 0.9], aliases: ['angoor'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Watermelon', category: 'Fruits', per100: [30, 0.6, 7.6, 0.2, 0.4], aliases: ['tarbooz'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Pineapple', category: 'Fruits', per100: [50, 0.5, 13.1, 0.1, 1.4], aliases: ['ananas'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Dates', category: 'Fruits', per100: [282, 2.5, 75.0, 0.4, 8.0], aliases: ['khajoor', 'khajur'], pieceGrams: 8, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Raisins', category: 'Fruits', per100: [299, 3.1, 79.2, 0.5, 4.5], aliases: ['kishmish'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Coconut (fresh)', category: 'Fruits', per100: [354, 3.3, 15.2, 33.5, 9.0], aliases: ['nariyal', 'khopra', 'coconut'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Coconut milk', category: 'Fruits', per100: [230, 2.3, 5.5, 23.8, 2.2], aliases: ['nariyal ka doodh'], densityMl: 1.0, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Pomegranate', category: 'Fruits', per100: [83, 1.7, 18.7, 1.2, 4.0], aliases: ['anar'], pieceGrams: 200, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Strawberry', category: 'Fruits', per100: [32, 0.7, 7.7, 0.3, 2.0], aliases: ['strawberries'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Pear', category: 'Fruits', per100: [57, 0.4, 15.2, 0.1, 3.1], aliases: ['nashpati'], pieceGrams: 180, basis: USDA, source: 'USDA FoodData Central' },

  // -------------------------------------------------------------- Oils & Ghee
  { name: 'Ghee', category: 'Oils & Ghee', per100: [876, 0.3, 0, 99.5, 0], aliases: ['desi ghee', 'clarified butter'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Olive oil', category: 'Oils & Ghee', per100: [884, 0, 0, 100, 0], aliases: ['zaitoon ka tel'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Canola oil', category: 'Oils & Ghee', per100: [884, 0, 0, 100, 0], aliases: ['cooking oil', 'canola', 'vegetable oil', 'tel', 'banaspati'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mustard oil', category: 'Oils & Ghee', per100: [884, 0, 0, 100, 0], aliases: ['sarson ka tel'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Sunflower oil', category: 'Oils & Ghee', per100: [884, 0, 0, 100, 0], aliases: ['surajmukhi tel'], basis: USDA, source: 'USDA FoodData Central' },

  // -------------------------------------------------------------- Nuts & Seeds
  { name: 'Almonds', category: 'Nuts & Seeds', per100: [579, 21.2, 21.6, 49.9, 12.5], aliases: ['badam'], pieceGrams: 1.2, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Walnuts', category: 'Nuts & Seeds', per100: [654, 15.2, 13.7, 65.2, 6.7], aliases: ['akhrot'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cashews', category: 'Nuts & Seeds', per100: [553, 18.2, 30.2, 43.9, 3.3], aliases: ['kaju'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Pistachios', category: 'Nuts & Seeds', per100: [562, 20.2, 27.2, 45.3, 10.6], aliases: ['pista'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Peanuts', category: 'Nuts & Seeds', per100: [567, 25.8, 16.1, 49.2, 8.5], aliases: ['moong phali', 'groundnuts'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Sesame seeds', category: 'Nuts & Seeds', per100: [573, 17.7, 23.4, 49.7, 11.8], aliases: ['til', 'sesame'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Sunflower seeds', category: 'Nuts & Seeds', per100: [584, 20.8, 20.0, 51.5, 8.6], aliases: ['surajmukhi ke beej'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Flaxseed', category: 'Nuts & Seeds', per100: [534, 18.3, 28.9, 42.2, 27.3], aliases: ['alsi', 'flax seeds', 'linseed'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Pumpkin seeds', category: 'Nuts & Seeds', per100: [559, 30.2, 10.7, 49.0, 6.0], aliases: ['kaddu ke beej'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chia seeds', category: 'Nuts & Seeds', per100: [486, 16.5, 42.1, 30.7, 34.4], aliases: ['chia'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Desiccated coconut', category: 'Nuts & Seeds', per100: [660, 6.9, 23.7, 64.5, 16.3], aliases: ['khopra bura', 'dried coconut'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Peanut butter', category: 'Nuts & Seeds', per100: [588, 25.1, 21.6, 50.0, 6.3], aliases: ['moong phali ka makkhan'], basis: USDA, source: 'USDA FoodData Central' },

  // ------ Spices (0-kcal by documented design decision — see module header) ---
  { name: 'Salt', category: 'Spices', per100: [...ZERO], aliases: ['namak', 'table salt'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Water', category: 'Spices', per100: [...ZERO], aliases: ['pani'], densityMl: 1.0, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Black pepper', category: 'Spices', per100: [...ZERO], aliases: ['kali mirch'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Turmeric', category: 'Spices', per100: [...ZERO], aliases: ['haldi', 'haldee'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Red chili powder', category: 'Spices', per100: [...ZERO], aliases: ['lal mirch', 'red chilli powder'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cumin seeds', category: 'Spices', per100: [...ZERO], aliases: ['zeera', 'jeera', 'cumin'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Coriander powder', category: 'Spices', per100: [...ZERO], aliases: ['dhania powder', 'ground coriander', 'sukha dhania'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Garam masala', category: 'Spices', per100: [...ZERO], aliases: ['garam masalah'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cardamom', category: 'Spices', per100: [...ZERO], aliases: ['elaichi', 'ilaichi', 'green cardamom'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cinnamon', category: 'Spices', per100: [...ZERO], aliases: ['dalchini'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Cloves', category: 'Spices', per100: [...ZERO], aliases: ['laung', 'long'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Bay leaf', category: 'Spices', per100: [...ZERO], aliases: ['tez patta', 'tezpatta'], pieceGrams: 0.5, basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Karahi masala', category: 'Spices', per100: [...ZERO], aliases: ['karahi masalah'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Chat masala', category: 'Spices', per100: [...ZERO], aliases: ['chaat masala', 'chat masalah'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Baking powder', category: 'Spices', per100: [...ZERO], aliases: ['baking soda'], basis: USDA, source: 'USDA FoodData Central' },

  // ------------------------------------------------------- Sauces & Condiments
  { name: 'Tomato ketchup', category: 'Sauces & Condiments', per100: [101, 1.7, 24.8, 0.2, 0.3], aliases: ['ketchup'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Soy sauce', category: 'Sauces & Condiments', per100: [53, 8.1, 4.9, 0.6, 0.1], aliases: ['soya sauce'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mustard (prepared)', category: 'Sauces & Condiments', per100: [66, 3.9, 6.0, 3.3, 3.3], aliases: ['prepared mustard', 'rai paste'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Mayonnaise', category: 'Sauces & Condiments', per100: [680, 1.0, 0.6, 74.9, 0], aliases: ['mayo'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Hot sauce', category: 'Sauces & Condiments', per100: [11, 0.5, 2.2, 0.6, 0.8], aliases: ['tabasco', 'chili sauce'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Honey', category: 'Sauces & Condiments', per100: [304, 0.3, 82.4, 0, 0.2], aliases: ['shehad'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Sugar (white)', category: 'Sauces & Condiments', per100: [387, 0, 100, 0, 0], aliases: ['sugar', 'cheeni', 'chini', 'white sugar'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Brown sugar', category: 'Sauces & Condiments', per100: [380, 0.1, 98.1, 0, 0], aliases: ['bhoori cheeni'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Jaggery', category: 'Sauces & Condiments', per100: [383, 0.4, 97.3, 0.1, 0], aliases: ['gur', 'gud'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Vinegar', category: 'Sauces & Condiments', per100: [18, 0, 0.9, 0, 0], aliases: ['sirka', 'white vinegar'], basis: USDA, source: 'USDA FoodData Central' },

  // --------------------------------- V21 expansion: worker-requested gaps
  // Daals & Beans
  { name: 'White beans (dry)', category: 'Daals & Beans', per100: [333, 23.4, 60.3, 0.9, 15.2], aliases: ['white beans', 'cannellini beans', 'safed lobia'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'White beans (cooked)', category: 'Daals & Beans', per100: [139, 9.7, 25.1, 0.4, 6.3], aliases: ['cooked white beans', 'cooked cannellini'], basis: USDA, source: 'USDA FoodData Central' },
  // Rice & Grains
  { name: 'Bulgur wheat (dry)', category: 'Rice & Grains', per100: [342, 12.3, 75.9, 1.3, 18.3], aliases: ['bulgur', 'bulgur wheat', 'cracked wheat'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Bulgur wheat (cooked)', category: 'Rice & Grains', per100: [83, 3.1, 18.6, 0.2, 4.5], aliases: ['cooked bulgur'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Poha / flattened rice (dry)', category: 'Rice & Grains', per100: [350, 7.5, 78, 0.8, 2], aliases: ['poha', 'flattened rice', 'rice flakes', 'chiwda'], basis: EST, source: 'standard estimate' },
  { name: 'Rice noodles (dry)', category: 'Rice & Grains', per100: [364, 5.9, 82.4, 0.6, 1.6], aliases: ['rice noodles', 'rice sticks'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Glass noodles (dry)', category: 'Rice & Grains', per100: [351, 0.2, 86.1, 0.1, 0.5], aliases: ['glass noodles', 'cellophane noodles', 'mung bean noodles'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Rice cakes (plain)', category: 'Rice & Grains', per100: [387, 8.2, 81.5, 2.8, 0.3], aliases: ['rice cakes'], basis: USDA, source: 'USDA FoodData Central' },
  // Flours
  { name: 'Sattu (roasted chickpea flour)', category: 'Flours', per100: [360, 20, 58, 6, 11], aliases: ['sattu'], basis: EST, source: 'standard estimate' },
  // Bread & Bakery
  { name: 'White bread', category: 'Bread & Bakery', per100: [265, 9, 49, 3.2, 2.7], aliases: ['white bread', 'bread slices', 'double roti'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Pita bread', category: 'Bread & Bakery', per100: [275, 9.1, 55.7, 1.2, 2.2], aliases: ['pita', 'pita bread', 'khubz'], basis: USDA, source: 'USDA FoodData Central' },
  // Dairy
  { name: 'Halloumi cheese', category: 'Dairy', per100: [321, 21.3, 2.4, 24, 0], aliases: ['halloumi', 'halloumi cheese'], basis: USDA, source: 'USDA FoodData Central' },
  // Vegetables
  { name: 'Tinda (apple gourd)', category: 'Vegetables', per100: [20, 0.8, 4, 0.2, 1.5], aliases: ['tinda', 'apple gourd'], basis: EST, source: 'standard estimate' },
  { name: 'Parsley (fresh)', category: 'Vegetables', per100: [36, 3, 6.3, 0.8, 3.3], aliases: ['parsley', 'fresh parsley'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Romaine lettuce', category: 'Vegetables', per100: [17, 1.2, 3.3, 0.3, 2.1], aliases: ['romaine', 'romaine lettuce'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Lemongrass', category: 'Vegetables', per100: [99, 1.8, 25.3, 0.5, 0], aliases: ['lemongrass', 'lemon grass'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Galangal', category: 'Vegetables', per100: [70, 1, 15, 0.8, 2], aliases: ['galangal'], basis: EST, source: 'standard estimate' },
  { name: 'Thai basil', category: 'Vegetables', per100: [23, 3.2, 2.7, 0.6, 1.6], aliases: ['thai basil'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Edamame', category: 'Vegetables', per100: [121, 11.9, 8.9, 5.2, 5.2], aliases: ['edamame', 'green soybeans'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Seaweed (dried nori)', category: 'Vegetables', per100: [35, 5.8, 5.1, 0.3, 3.6], aliases: ['seaweed', 'nori', 'dried seaweed'], basis: USDA, source: 'USDA FoodData Central' },
  // Soy & Fermented
  { name: 'Tofu (firm)', category: 'Dairy', per100: [76, 8.1, 1.9, 4.8, 0.3], aliases: ['tofu', 'firm tofu', 'soy paneer'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Miso paste', category: 'Sauces & Condiments', per100: [199, 11.7, 26.5, 6, 5.4], aliases: ['miso', 'miso paste'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Doenjang (Korean soybean paste)', category: 'Sauces & Condiments', per100: [199, 12, 25, 6, 5], aliases: ['doenjang', 'korean soybean paste'], basis: EST, source: 'standard estimate' },
  { name: 'Kimchi', category: 'Vegetables', per100: [15, 1.1, 2.4, 0.5, 1.6], aliases: ['kimchi'], basis: USDA, source: 'USDA FoodData Central' },
  // Sauces & Condiments
  { name: 'Tahini', category: 'Sauces & Condiments', per100: [595, 17, 21, 54, 9.3], aliases: ['tahini', 'sesame paste', 'tehina'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Fish sauce', category: 'Sauces & Condiments', per100: [35, 5.1, 3.6, 0.1, 0], aliases: ['fish sauce', 'nam pla'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Gochujang', category: 'Sauces & Condiments', per100: [200, 5, 43, 3, 4], aliases: ['gochujang', 'korean chili paste'], basis: EST, source: 'standard estimate' },
  { name: 'Pomegranate molasses', category: 'Sauces & Condiments', per100: [300, 1, 75, 0, 1], aliases: ['pomegranate molasses', 'anar molasses'], basis: EST, source: 'standard estimate' },
  { name: 'Thai red curry paste', category: 'Sauces & Condiments', per100: [120, 3, 10, 8, 5], aliases: ['thai red curry paste', 'red curry paste'], basis: EST, source: 'standard estimate' },
  { name: 'Japanese curry powder', category: 'Spices', per100: [325, 14, 56, 10, 33], aliases: ['japanese curry powder', 'curry powder'], basis: EST, source: 'standard estimate' },
  // Spices (zeroed by design — trace quantities)
  { name: 'Sumac', category: 'Spices', per100: ZERO, aliases: ['sumac', 'ground sumac'], basis: USDA, source: 'USDA FoodData Central' },
  { name: 'Black tea leaves', category: 'Spices', per100: ZERO, aliases: ['black tea', 'black tea leaves', 'chai patti'], basis: USDA, source: 'USDA FoodData Central' },
];
