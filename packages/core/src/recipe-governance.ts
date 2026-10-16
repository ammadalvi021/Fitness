/**
 * FitFusion AI — recipe review/verification governance (v21.4).
 *
 * CANONICAL HOME of the rules that keep recorded review/verification
 * evidence honest when recipe content changes. PURE DATA MODULE: no imports
 * from @prisma/client, no side effects. Both the recipe PATCH route
 * (apps/web/app/api/recipes/[slug]/route.ts) and the admin review route
 * (apps/web/app/api/admin/recipes/[slug]/review/route.ts) implement THIS
 * policy — they must never re-declare it.
 *
 * ---------------------------------------------------------------------------
 * 1. MATERIAL-CHANGE SET
 * ---------------------------------------------------------------------------
 *
 * A "material change" is any edit that can move the numbers or claims a
 * recorded review/verification was checked against:
 *
 *   MATERIAL (invalidates prior review AND verification evidence):
 *   - `ingredients` — added, removed, or quantity-changed rows. The review
 *     record's dietary/allergen rechecks were run against the OLD list, and
 *     the recorded per-serving nutrition no longer matches.
 *   - `portions` (servings) — the yield the batch totals are divided by.
 *     Per-serving values are totals ÷ portions, so a portions change
 *     re-bases every recorded number.
 *   - `dietCategory` — the vegetarian/non_vegetarian claim itself.
 *   - `tags` — material claims (e.g. 'high-protein', 'halal-friendly');
 *     the review's dietary recheck covered the old claim set.
 *   - `allergens` — allergen declarations; the review's allergen recheck
 *     covered the old list.
 *   - Nutrition VALUES (kcal/protein/carbs/fat/fiber per serving) — these
 *     are DERIVED from ingredients + portions, never edited directly, so an
 *     ingredient/yield change already covers them. They are listed here so
 *     a future direct-edit path cannot slip through: a direct nutrition
 *     edit is material by definition.
 *
 *   NOT material (metadata-only — review/verification survive):
 *   - `name`/`title`, `prepMin`, `cookMin`, `difficulty`, `instructions`,
 *     `imageUrl`, `videoUrl`, `mealType`, `cuisineId`, and `yieldGrams`.
 *     None of these touch the numbers or claims the evidence was checked
 *     against. `yieldGrams` is the cook's informational reference for the
 *     actual cooked batch weight (see §4 — it is NOT a divisor in the
 *     per-serving math).
 *
 * NOTE (v21.5): `yieldGrams` was previously listed with `portions` as "the
 * yield". That was inaccurate — per-serving values are batch totals divided
 * by `portions`, never by `yieldGrams`. An earlier comment claimed a
 * yieldGrams change "re-bases every recorded number"; it re-bases nothing.
 * It was moved to the non-material set in v21.5 with the contract in §4.
 *
 * DECISION (documented): a material change lapses the REVIEW as well as the
 * verification. A review is not a free-floating "someone looked at it" —
 * the review record certifies dietary/allergen rechecks against a specific
 * ingredient list and a method/reference tied to specific nutrition values.
 * Keeping a 'reviewed' tier on content the reviewer never saw would be the
 * same overreach the v21.3 evidence badges were built to prevent.
 *
 * ---------------------------------------------------------------------------
 * 2. VERIFICATION-OF-INCOMPLETE-NUTRITION POLICY
 * ---------------------------------------------------------------------------
 *
 * A recipe with `needsReview === true` (unresolved ingredients / incomplete
 * nutrition) can NEVER receive a Verified nutrition badge. The required path
 * is: resolve the missing nutritional values or serving info → recalculate
 * → re-review → then verify. `needsReview` is never cleared just to permit
 * verification.
 *
 * ---------------------------------------------------------------------------
 * 3. REVIEW-ON-VERIFIED POLICY
 * ---------------------------------------------------------------------------
 *
 * Recording a NEW review on an already-verified recipe resets the
 * verification (verified=false, verification evidence destroyed) UNLESS a
 * fresh verification is performed in the same explicitly supported
 * workflow. The supported atomic workflow is the admin 'verify' action with
 * `reviewEvidence` supplied in the same call (review saved first, then the
 * verification). A bare 'review' action never preserves a verification —
 * the old verification evidence was tied to the earlier review/content.
 *
 * ---------------------------------------------------------------------------
 * 4. yieldGrams CONTRACT (v21.5 — Option A, informational)
 * ---------------------------------------------------------------------------
 *
 * `yieldGrams` is the cook's reference for the actual cooked weight of the
 * whole batch (grams). It is INFORMATIONAL and NON-MATERIAL:
 *
 * - Per-serving nutrition is ALWAYS batch totals ÷ `portions` (servings).
 *   The server recomputes it from `recipeNutrition(rows, portions)`; the
 *   recipe detail page, diary payloads, and meal-plan additions all use
 *   per-serving × N servings. `yieldGrams` is never an input to any of
 *   these paths.
 * - No UI or API derives a per-100-g display or a serving-weight from
 *   `yieldGrams`. The detail page never reads it. The new-recipe form
 *   stores it as "Optional — cooked weight of the whole batch."
 * - CONSEQUENCE: a yieldGrams-only PATCH MUST NOT recompute, alter, or
 *   "normalize" any nutrition value, MUST NOT lapse prior review evidence,
 *   and MUST NOT reset `verified`. Changing a recorded calorie count just
 *   to clear a review flag — or lapsing evidence for an edit that changed
 *   nothing under review — is exactly the overreach this module exists to
 *   prevent. (If a future UI/API ever drives per-100-g display or
 *   serving-weight derivation from yieldGrams, that is a new contract and
 *   must move yieldGrams back to the material set with the recalculation
 *   implemented and tested first.)
 *
 * ---------------------------------------------------------------------------
 * 5. OPTIMISTIC-CONCURRENCY POLICY (v21.6)
 * ---------------------------------------------------------------------------
 *
 * The content hash (`contentHash`, recomputed on every PATCH in the same
 * atomic update as the content it describes) is a lost-update guard for
 * the GUARDED WORKFLOWS — material recipe PATCH, admin review, admin verify,
 * admin clear. The hash is a concurrency PRECONDITION ONLY: it proves the
 * client read the current revision before writing, never an authorization
 * proof — all owner/admin checks apply independently and unchanged.
 *
 * RULES (the routes implement this section; they must never re-declare it):
 *
 *  - The guard is REQUIRED on every write in a guarded workflow. A write
 *    with no `expectedContentHash` (absent/undefined) is rejected with 409
 *    `stale_recipe` and an actionable message ("reload and retry") — there
 *    is NO silent unconditional write path (the pre-v21.6 fallback was
 *    removed in v21.6 precisely because it let a stale client overwrite a
 *    concurrent edit without noticing).
 *  - Metadata-only PATCH edits are guarded too. Every PATCH recomputes the
 *    hash, so every PATCH is a revision that must be conditional; a
 *    metadata-only carve-out would be client-declared and unenforceable
 *    (the server cannot distinguish "this client claims metadata-only"
 *    from a real edit), i.e. a downgrade hole back to unconditional
 *    writes. (Evidence preservation on metadata-only edits is §1 and is
 *    unchanged — the guard governs concurrency, not invalidation.)
 *  - Legacy rows that predate hash tracking (contentHash IS NULL — the
 *    backfill has not run everywhere yet) use the EXPLICIT `null` guard:
 *    the server writes conditionally on `{ id, contentHash: null }`. A
 *    concurrent edit moves the hash to non-null, so the conditional write
 *    fails with 409 — the legacy path stays concurrency-safe too. The GET
 *    responses (recipe detail, admin review prefill) return
 *    `contentHash: null` for these rows so clients know which guard to
 *    send. An absent guard on a legacy row is rejected exactly like any
 *    other missing guard.
 *  - A mismatched guard (the stored hash moved since the client read it)
 *    is rejected with 409 `stale_recipe`. The client must reload and
 *    retry — a retry never silently overwrites.
 *  - Material changes and evidence invalidation stay atomic (same single
 *    conditional update), so a stale review/verify write can never
 *    resurrect evidence a concurrent material edit just invalidated: the
 *    edit moves the hash, the stale guard no longer matches, the stale
 *    write fails 409.
 *
 * ---------------------------------------------------------------------------
 * 5b. REVISION TOKEN (v21.7) — the pair that closes the review-state hole
 * ---------------------------------------------------------------------------
 *
 * The hash alone does not change on review/verify/clear (they touch no
 * content), so two concurrent admin actions could pass the SAME hash guard
 * and overwrite each other's review state. `revision` closes this: it is
 * a mutation counter, not content identity.
 *
 *  - `contentHash` = CONTENT IDENTITY. It changes only on a material
 *    content change (recomputed on every PATCH from the merged post-write
 *    content — identical content recomputes the identical hash, e.g. on
 *    metadata-only edits). It answers: "is this the content I read?"
 *  - `revision` = MUTATION COUNTER. It increments by 1 on EVERY recipe or
 *    review-state mutation — material PATCH, metadata-only PATCH, admin
 *    review, admin verify, admin clear — in the SAME atomic conditional
 *    `updateMany` as the mutation itself (`revision: { increment: 1 }`
 *    inside `data`). It answers: "did anything touch this record since I
 *    read it?" Review/verify/clear move the revision even though the hash
 *    stays put, so a stale clear can never silently undo a newer verify.
 *
 * The client sends the PAIR it read — `expectedContentHash` (string, or
 * explicit null for legacy NULL-hash rows) AND `expectedRevision`
 * (integer). The write's `where` matches BOTH (`{ id|slug,
 * contentHash, revision }`); zero matched rows → 409 `stale_recipe`,
 * whichever guard failed. As with the hash, the guard is a write
 * precondition, never an authorization proof — owner/admin checks run
 * first and unchanged.
 *
 * UNCHANGED by the revision token: content-evidence invalidation is
 * still §1 — a metadata-only PATCH increments the revision but preserves
 * review/verification evidence exactly as before; a material PATCH
 * invalidates per policy. The backfill script writes contentHash only
 * (conditional on contentHash IS NULL) and NEVER touches revision. The
 * revision is never derived from content and never resets to 0 after a
 * write.
 */

import { unresolvedIngredientNames } from './incomplete-nutrition.js';

/**
 * Pure-TypeScript SHA-256 (no `node:crypto`).
 *
 * This module is re-exported through the `@fitfusion/core` barrel, which
 * client pages import — a top-level `node:crypto` import breaks the Next.js
 * browser bundle (webpack `UnhandledSchemeError`). The hash only needs to
 * be a stable content fingerprint for optimistic concurrency, so a
 * dependency-free implementation keeps the module isomorphic.
 */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  // Padding: 0x80 then zeros, then 64-bit big-endian length.
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Field names whose change invalidates prior review/verification evidence.
 * Mirrors the writable fields of CustomRecipePatchSchema plus the
 * claim-bearing fields an admin/edit path can touch.
 */
export const MATERIAL_RECIPE_FIELDS = [
  'ingredients',
  'portions',
  'dietCategory',
  'tags',
  'allergens',
  // Nutrition values are derived, never direct-edited; listed so a future
  // direct-edit path is material by construction.
  'kcalPerServing',
  'proteinPerServing',
  'carbsPerServing',
  'fatPerServing',
  'fiberPerServing',
] as const;

export type MaterialRecipeField = (typeof MATERIAL_RECIPE_FIELDS)[number];

/** Writable fields that never touch the numbers or claims evidence covers. */
export const NON_MATERIAL_RECIPE_FIELDS = [
  'name',
  'title',
  'prepMin',
  'cookMin',
  'difficulty',
  'instructions',
  'imageUrl',
  'videoUrl',
  'mealType',
  'cuisineId',
  // v21.5: yieldGrams is informational (see §4 of the module doc) — the
  // cook's reference for actual cooked batch weight. It is not a divisor in
  // the per-serving math, so changing it touches none of the numbers or
  // claims the recorded evidence was checked against.
  'yieldGrams',
] as const;

function isMaterialField(f: string): f is MaterialRecipeField {
  return (MATERIAL_RECIPE_FIELDS as readonly string[]).includes(f);
}

/**
 * Which material fields a patch touches. `patchKeys` are the keys present
 * in the parsed patch body (presence = the field was edited). Returns the
 * material subset, in MATERIAL_RECIPE_FIELDS order.
 */
export function materialFieldsTouched(patchKeys: readonly string[]): MaterialRecipeField[] {
  const touched = new Set(patchKeys);
  return MATERIAL_RECIPE_FIELDS.filter((f) => touched.has(f));
}

export interface InvalidationDecision {
  /** True when the recipe's stored review evidence must be destroyed. */
  invalidateReview: boolean;
  /** True when verified must be reset and verification evidence destroyed. */
  invalidateVerification: boolean;
  /** Human-readable reason, recorded in logs/audit copy. */
  reason: string;
}

/**
 * The invalidation decision for an edit. ANY material field touched →
 * both the review and the verification lapse (see the module doc for why
 * the review lapses too). Metadata-only edits preserve everything.
 */
export function invalidationForEdit(
  patchKeys: readonly string[],
): InvalidationDecision {
  const material = materialFieldsTouched(patchKeys);
  if (material.length === 0) {
    return {
      invalidateReview: false,
      invalidateVerification: false,
      reason: 'metadata-only edit — review/verification evidence preserved',
    };
  }
  return {
    invalidateReview: true,
    invalidateVerification: true,
    reason:
      `material change (${material.join(', ')}) — prior review and ` +
      'verification evidence were checked against the previous content',
  };
}

/**
 * ---------------------------------------------------------------------------
 * 5. RECIPE CONTENT REVISION HASH (v21.5 — optimistic concurrency)
 * ---------------------------------------------------------------------------
 *
 * CANONICALIZATION (computeRecipeContentHash). Every call site — the
 * recipe PATCH route, the creation route, and the admin review route —
 * MUST build the snapshot with `buildContentSnapshot` (same module, same
 * rules), then hash it with `computeRecipeContentHash`. Canonicalization,
 * in this order:
 *
 *   - `ingredients`: each row contributes its STABLE identity plus the
 *     claim/evidence surface:
 *       - `foodId` — the catalogue food ID when the row is linked to a
 *         Food (trimmed; empty/missing → null; NEVER lowercased — IDs are
 *         case-sensitive). Two rows with identical display names and grams
 *         but different foodIds are DIFFERENT ingredients → different hash.
 *       - `canonicalName` — the canonical DB food name (Food.name) when
 *         available, trimmed + lowercased; FALLS BACK to the normalized
 *         display name for legacy rows that predate canonical identity.
 *         A display-name-only rename of the same canonical food is NOT a
 *         new revision (same convention as `storedRowAllergenKey`).
 *       - `name` — the display name, trimmed + lowercased.
 *       - `grams` — rounded to 3 decimals (absorbs float-format noise).
 *       - `quantity` / `unit` — validated free text the stored row carries
 *         (seed-library rows store e.g. quantity "800 g"): trimmed,
 *         lowercased, 1–200 chars; anything else → null (never throws).
 *         Already hashed in the payload; since v21.7 also part of the SORT
 *         (see below) so ties are fully broken.
 *     Rows are SORTED by (foodId ?? '', canonicalName, name, grams,
 *     quantity ?? '', unit ?? '') — every canonical ingredient field
 *     participates, so the hash is ingredient-order-insensitive: a pure
 *     reorder is not a "new revision". Rows with no usable name AND no
 *     foodId are dropped.
 *
 * NOTE (v21.7 — canonical-form change): the pre-v21.6 sort stopped at
 * grams, so rows that tied on (foodId, canonicalName, name, grams) but
 * differed in quantity/unit free text kept their input order and could
 * hash differently from array order alone. v21.7 breaks those ties on
 * quantity and unit. CONSEQUENCE: stored v21.6-era hashes remain valid
 * ONLY where no such tie exists — rows that tie on the first four keys
 * AND differ in quantity/unit adopt the new (now fully deterministic)
 * form on their next write or backfill, and their hash changes. Rows
 * without such ties hash EXACTLY as in v21.6 (the payload shape is
 * unchanged, and the extra comparisons never execute when an earlier key
 * already decides the order). The concurrency guard compares at write
 * time, so this is safe: a row carrying the old form simply fails a stale
 * guard and is rewritten with the new form.
 *   - `servings`: the number as-is.
 *   - `dietCategory`: trimmed + lowercased.
 *   - `yieldGrams`: null/undefined → null, otherwise rounded to 3 decimals.
 *   - `tags` / `allergens`: trimmed, lowercased, deduplicated, sorted
 *     (claim sets, not sequences — order carries no meaning).
 *
 * DELIBERATELY EXCLUDED (same rule as section 1):
 *   - Per-serving nutrition VALUES (kcal/protein/carbs/fat/fiber) — they
 *     are DERIVED from ingredients + servings, so any real nutrition
 *     change already moves the hash; a float-format-only recompute of the
 *     same content must NOT look like a new revision and invalidate
 *     recorded evidence.
 *   - Metadata-only fields (name/title, prepMin, cookMin, difficulty,
 *     instructions, imageUrl, videoUrl, mealType, cuisineId) — a
 *     metadata-only PATCH recomputes the SAME hash, which is exactly how
 *     review/verification survive renames.
 *
 * NOTE — hash change ≠ evidence invalidation. The hash detects ANY
 * content change (including a yieldGrams edit, which §1 treats as
 * non-material since v21.5). Its only job is revision detection for
 * optimistic concurrency: a changed hash means "someone edited this since
 * you read it — reload and retry", never "the evidence lapsed". Evidence
 * invalidation stays governed exclusively by §1.
 *
 * The snapshot is serialized as a single JSON.stringify (fixed key order)
 * and hashed with SHA-256 (hex). Keys of the JSON are hardcoded, never
 * derived from user data.
 */

/** One ingredient entry in a content snapshot (v21.6 expanded identity).
 *
 * `foodId` / `canonicalName` are the STABLE identity; `name` / `grams` are
 * the claim surface; `quantity` / `unit` are validated free text the stored
 * row carries (e.g. seed-library rows store quantity "800 g"). Every field
 * except `name`/`grams` is optional so snapshots built by older call sites
 * (`{ name, grams }` only) remain valid input — missing identity degrades
 * gracefully to the normalized display name (see computeRecipeContentHash).
 */
export interface RecipeContentSnapshotIngredient {
  name: string;
  grams: number;
  foodId?: string | null;
  canonicalName?: string | null;
  quantity?: string | null;
  unit?: string | null;
}

/** Canonical content snapshot — the ONLY input to the revision hash. */
export interface RecipeContentSnapshot {
  ingredients: ReadonlyArray<RecipeContentSnapshotIngredient>;
  servings: number;
  dietCategory: string;
  yieldGrams?: number | null;
  tags?: readonly string[] | null;
  allergens?: readonly string[] | null;
}

/** Round to 3 decimals to absorb float-format noise in stored gram values. */
function round3(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function canonClaimList(list: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const v of list ?? []) {
    const s = String(v ?? '').trim().toLowerCase();
    if (s) seen.add(s);
  }
  return [...seen].sort();
}

/** Max length for validated identity free-text (foodId, quantity, unit). */
const MAX_IDENTITY_TEXT = 200;

/**
 * Validated identity free-text: string, trimmed + lowercased, 1–200 chars.
 * Anything else (non-string, empty, absurdly long) → null. Never throws —
 * canonicalization must be total over whatever the JSON column holds.
 */
function canonIdentityText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s.length > 0 && s.length <= MAX_IDENTITY_TEXT ? s : null;
}

/**
 * Validated food ID: trimmed, never lowercased (IDs are case-sensitive),
 * 1–200 chars. Missing/empty → null.
 */
function canonFoodId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 && s.length <= MAX_IDENTITY_TEXT ? s : null;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pure, deterministic SHA-256 hex digest of the canonical recipe content.
 * Same material content (in any ingredient/tag/allergen order) → same
 * hash. Any material edit (ingredient add/remove/quantity/identity change,
 * servings, dietCategory, yieldGrams, tag, or allergen change) → a
 * different hash. Two rows with identical display names + grams but
 * different `foodId`s are different ingredients → different hashes; rows
 * without identity fall back to the normalized display name, so legacy
 * `{name, grams}` snapshots hash exactly as they did before v21.6. Used
 * for optimistic concurrency: a client sends the hash it read
 * (`expectedContentHash`) and the server rejects the write with 409
 * `stale_recipe` when the stored hash no longer matches.
 */
export function computeRecipeContentHash(content: RecipeContentSnapshot): string {
  const canonIngredients = (content.ingredients ?? [])
    .map((r) => {
      const name = String(r?.name ?? '').trim().toLowerCase();
      return {
        foodId: canonFoodId(r?.foodId),
        // Legacy rows predate canonicalName — the normalized display name
        // is the deterministic fallback (same convention as
        // storedRowAllergenKey: canonicalName ?? name).
        canonicalName: canonIdentityText(r?.canonicalName) ?? name,
        name,
        grams: round3(Number(r?.grams)),
        quantity: canonIdentityText(r?.quantity),
        unit: canonIdentityText(r?.unit),
      };
    })
    .filter((r) => r.name.length > 0 || r.foodId !== null)
    // v21.7: the sort must cover EVERY field of the canonical ingredient
    // object — foodId, canonicalName, name, grams, quantity, unit. The
    // payload already includes quantity/unit, but the pre-v21.7 comparator
    // stopped at grams: rows that tied on the first four keys kept their
    // INPUT order (JS sort is stable), so the same content could hash
    // differently purely from array order. With all six fields covered the
    // sort is fully deterministic and the hash is order-insensitive.
    .sort((a, b) =>
      cmpStr(a.foodId ?? '', b.foodId ?? '') ||
      cmpStr(a.canonicalName, b.canonicalName) ||
      cmpStr(a.name, b.name) ||
      a.grams - b.grams ||
      cmpStr(a.quantity ?? '', b.quantity ?? '') ||
      cmpStr(a.unit ?? '', b.unit ?? ''),
    );
  const canon = {
    ingredients: canonIngredients,
    servings: content.servings,
    dietCategory: String(content.dietCategory ?? '').trim().toLowerCase(),
    yieldGrams:
      content.yieldGrams === null || content.yieldGrams === undefined
        ? null
        : round3(Number(content.yieldGrams)),
    tags: canonClaimList(content.tags),
    allergens: canonClaimList(content.allergens),
  };
  return sha256Hex(JSON.stringify(canon));
}

/**
 * Shape accepted by buildContentSnapshot — a STORED recipe record's
 * material fields. `ingredients` is the raw Prisma Json value (an array of
 * row objects, or anything else when the column holds garbage); every
 * other field is the raw column value. Nothing here throws.
 */
export interface StoredRecipeContentInput {
  ingredients: unknown;
  servings: unknown;
  dietCategory: unknown;
  yieldGrams?: unknown;
  tags?: unknown;
  allergens?: unknown;
}

function asClaimListOrNull(v: unknown): readonly string[] | null {
  return Array.isArray(v) ? (v as readonly string[]) : null;
}

/**
 * SINGLE SOURCE OF TRUTH for building the hash snapshot. Every write path
 * (creation route, PATCH route, the backfill script) MUST build its
 * snapshot through this helper — never by re-declaring which fields feed
 * the hash. It defensively extracts the v21.6 identity fields
 * (foodId/canonicalName/quantity/unit) from stored ingredient rows;
 * legacy rows that lack them degrade to `{name, grams}` exactly as before.
 * Canonicalization itself (lowercasing, round3, sorting) stays inside
 * computeRecipeContentHash, so the two functions together are the one
 * canonical form — call sites cannot drift.
 */
export function buildContentSnapshot(
  stored: StoredRecipeContentInput,
): RecipeContentSnapshot {
  const rawRows = Array.isArray(stored.ingredients) ? stored.ingredients : [];
  const ingredients: RecipeContentSnapshotIngredient[] = [];
  for (const r of rawRows) {
    if (typeof r !== 'object' || r === null) continue;
    const row = r as Record<string, unknown>;
    ingredients.push({
      name: typeof row.name === 'string' ? row.name : '',
      grams: typeof row.grams === 'number' ? row.grams : 0,
      foodId: typeof row.foodId === 'string' ? row.foodId : null,
      canonicalName:
        typeof row.canonicalName === 'string' ? row.canonicalName : null,
      quantity: typeof row.quantity === 'string' ? row.quantity : null,
      unit: typeof row.unit === 'string' ? row.unit : null,
    });
  }
  const servings = Number(stored.servings);
  return {
    ingredients,
    servings: Number.isFinite(servings) ? servings : 0,
    dietCategory:
      typeof stored.dietCategory === 'string' ? stored.dietCategory : '',
    yieldGrams:
      typeof stored.yieldGrams === 'number' ? stored.yieldGrams : null,
    tags: asClaimListOrNull(stored.tags),
    allergens: asClaimListOrNull(stored.allergens),
  };
}

/**
 * Canonical verify gate: a recipe whose nutrition is incomplete
 * (`needsReview === true`) can NEVER be verified. Returns false when
 * verification must be refused.
 */
export function mayVerifyNutrition(
  needsReview: boolean | null | undefined,
): boolean {
  return needsReview !== true;
}

export interface IngredientRowLike {
  name: string;
  nutritionStatus?: string | null;
}

/**
 * The 400 error message for a verification attempt on an incomplete recipe.
 * Names the unresolved ingredients when they are known; otherwise falls
 * back to the generic wording. Always states the required path — resolve,
 * recalculate, re-review, then verify — so an admin never clears
 * `needsReview` just to get past the gate.
 */
export function incompleteVerificationBlockMessage(
  unresolvedNames: readonly string[],
): string {
  const items =
    unresolvedNames.length > 0
      ? `unresolved ingredients: ${unresolvedNames.join(', ')}`
      : 'ingredients with unknown nutrition';
  return (
    `Cannot verify: recipe nutrition is incomplete (${items}). ` +
    'Required path: resolve the missing nutritional values or serving info, ' +
    'recalculate, re-review, then verify. Do not clear the needsReview flag ' +
    'to bypass this check.'
  );
}

/**
 * Convenience: build the block message straight from stored ingredient rows.
 * Rows are the resolved rows persisted on the recipe (each may carry a
 * `nutritionStatus` of 'ok' | 'unknown' | 'incomplete').
 */
export function incompleteVerificationBlockMessageForRows(
  rows: readonly IngredientRowLike[] | null | undefined,
): string {
  return incompleteVerificationBlockMessage(
    unresolvedIngredientNames(rows ?? []),
  );
}
