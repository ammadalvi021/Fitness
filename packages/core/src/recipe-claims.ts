/**
 * FitFusion AI — recipe claims policy (v21.3).
 *
 * CANONICAL HOME of the data-governance rules for recipe claims. PURE DATA
 * MODULE: no imports from @prisma/client, no side effects. This module moved
 * here from `packages/db/prisma/recipe-claims-policy.ts` (v21.2, P8) so the
 * web client can import the SAME policy (`apps/web/lib/recipe-tier.ts`
 * re-exports it) instead of mirroring it — the db file is now a re-export
 * shim and must never re-declare any of this logic.
 *
 * Encodes three policies:
 *
 *  1. HALAL (replaces the pork-absence inference): the tag 'halal-friendly'
 *     may appear ONLY when a human reviewer asserted it and the review is
 *     recorded ({ reviewer, reviewedAt }). "No pork-family ingredient was
 *     identified in the ingredient list" is a *screening observation*, not a
 *     halal claim — it must never be presented as certification, and it never
 *     grants the tag. These are different claims; the UI must distinguish
 *     them (see docs/recipe-data-quality.md for the badge spec).
 *  2. ALLERGENS: the `allergens` lists in seed data are *declared from
 *     ingredient names* at generation time — a name-based screening, not a
 *     certified allergen analysis. No allergen-safety promise may be derived
 *     from name matching. Wherever the basis is not a recorded human review,
 *     the ALLERGEN_CAVEAT must be shown.
 *  3. VERIFIED / REVIEWED: the nutrition "verified" label requires the
 *     evidence in VERIFIED_STANDARD_EVIDENCE; the "reviewed" label requires a
 *     complete ReviewRecord. A bare `verified: true` flag with no evidence is
 *     NOT a stronger claim and tiers as 'calculated-estimate' (the honest
 *     default for all 270 seed recipes and every AI/engine-generated recipe).
 *
 * Data-quality tiers (UI badge spec lives in docs/recipe-data-quality.md):
 *  - 'calculated-estimate': nutrition is an estimate (engine-computed or
 *    hand-authored) — not human reviewed, not independently verified.
 *  - 'reviewed': a named human checked the recipe and recorded the review
 *    (all ReviewRecord fields present).
 *  - 'verified': the independent verification process ran with recorded
 *    evidence (see VERIFIED_STANDARD_EVIDENCE) AND a complete review record.
 *
 * v21.8 (P4): `needsReview: true` caps the tier at 'calculated-estimate' —
 * a recipe awaiting review NEVER carries a Verified (or Reviewed) badge,
 * no matter what the stored evidence claims. needsReview means the
 * nutrition is incomplete or the content changed since the last check, so
 * the evidence describes a state that no longer holds. Legacy
 * inconsistent records (verified evidence + needsReview true) fail closed
 * here until they are resolved and properly reviewed.
 */

// ---------------------------------------------------------------------------
// Halal claim policy
// ---------------------------------------------------------------------------

/** A recorded human halal review — the ONLY path to the 'halal-friendly' tag. */
export interface HalalReview {
  /** Who asserted halal-friendly (name or role — never anonymous). */
  reviewer: string;
  /** ISO-8601 date of the review. */
  reviewedAt: string;
}

export interface HalalClaimInput {
  tags: string[];
  halalReview?: HalalReview | null;
}

/**
 * True only when the recipe carries the 'halal-friendly' tag AND a recorded
 * human review backs it. Pork-absence alone NEVER returns true — that is the
 * old inference, and it is dead.
 */
export function mayClaimHalalFriendly(r: HalalClaimInput): boolean {
  return (
    r.tags.includes('halal-friendly') &&
    !!r.halalReview &&
    r.halalReview.reviewer.trim().length > 0 &&
    r.halalReview.reviewedAt.trim().length > 0
  );
}

/**
 * Policy invariant for seed data: no recipe may carry 'halal-friendly'
 * without a recorded review. Returns the offending slugs (empty = policy holds).
 */
export function halalPolicyViolations(
  recipes: Array<{ slug: string; tags: string[]; halalReview?: HalalReview | null }>,
): string[] {
  return recipes
    .filter(
      (r) =>
        r.tags.includes('halal-friendly') && !mayClaimHalalFriendly(r),
    )
    .map((r) => r.slug);
}

// ---------------------------------------------------------------------------
// Allergen provenance policy
// ---------------------------------------------------------------------------

/** How a recipe's `allergens` list was produced. */
export type AllergenBasis = 'declared-from-ingredient-names' | 'human-reviewed';

/**
 * Canonical caveat shown wherever allergen data is name-derived rather than
 * human-reviewed. UI surfaces must render this verbatim (or a faithful
 * translation) — never a softened paraphrase that implies safety.
 */
export const ALLERGEN_CAVEAT =
  'Allergen information is declared from the recipe\u2019s ingredient names only. ' +
  'It is not a certified allergen analysis: unlisted sub-ingredients, shared cooking ' +
  'equipment, and cross-contamination are not assessed. If you have a food allergy, ' +
  'verify every ingredient yourself before cooking.';

/**
 * Returns the caveat text when the allergen basis is anything other than a
 * recorded human review, null when a human review covers it. An absent basis
 * is treated as name-derived (the honest default for all seed data).
 */
export function allergenCaveat(basis: AllergenBasis | undefined): string | null {
  return basis === 'human-reviewed' ? null : ALLERGEN_CAVEAT;
}

// ---------------------------------------------------------------------------
// Review record (v21.3) — the evidence behind the "reviewed" tier
// ---------------------------------------------------------------------------

/** Methods an admin review may use to check a recipe. */
export const REVIEW_METHODS = [
  'independent recomputation',
  'label cross-check',
  'lab analysis',
  'other',
] as const;
export type ReviewMethod = (typeof REVIEW_METHODS)[number];

/**
 * Methods an independent verification may use (v21.4). Kept as its own
 * controlled vocabulary next to REVIEW_METHODS so the verification policy
 * can evolve independently of the review policy. It currently mirrors the
 * review vocabulary because the admin panel uses a single method dropdown
 * for both actions — every value the UI can send is accepted here, and
 * anything else (blank, oversized, or invented strings) is rejected.
 */
export const VERIFICATION_METHODS = [
  'independent recomputation',
  'authoritative source cross-check',
  'label cross-check',
  'lab analysis',
  'other',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

function includesMethod(
  list: readonly string[],
  v: unknown,
): boolean {
  return typeof v === 'string' && list.includes(v.trim());
}

/** True when v (trimmed) is one of REVIEW_METHODS. */
export function isReviewMethod(v: unknown): v is ReviewMethod {
  return includesMethod(REVIEW_METHODS, v);
}

/** True when v (trimmed) is one of VERIFICATION_METHODS. */
export function isVerificationMethod(v: unknown): v is VerificationMethod {
  return includesMethod(VERIFICATION_METHODS, v);
}

/**
 * A recorded human review of a recipe (nutrition + claims checked).
 * EVERY field is required — a partial record is not a review.
 */
export interface ReviewRecord {
  /** Who reviewed (admin identity — server-set from the session, never client-forged). */
  reviewer: string;
  /** ISO-8601 date of the review. */
  reviewedAt: string;
  /** How the nutrition/claims were checked. */
  method: string;
  /** The reference/evidence used (e.g. "USDA SR Legacy #170923", independent spreadsheet). */
  reference: string;
  /** Dietary claims (tags, dietCategory) re-checked against the ingredient list. */
  dietaryRechecked: boolean;
  /** Allergen list re-checked against the ingredient list. */
  allergenRechecked: boolean;
}

/**
 * True only when every required review field is present, non-blank, and
 * both recheck flags are true. String fields are trimmed; a blank reviewer,
 * date, method, or reference fails. Dates must be parseable (ISO-8601).
 */
export function meetsReviewedStandard(
  record: ReviewRecord | null | undefined,
): boolean {
  return (
    !!record &&
    record.reviewer.trim().length > 0 &&
    isParseableDate(record.reviewedAt) &&
    record.method.trim().length > 0 &&
    record.reference.trim().length > 0 &&
    record.dietaryRechecked === true &&
    record.allergenRechecked === true
  );
}

function isParseableDate(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    !Number.isNaN(Date.parse(v.trim()))
  );
}

// ---------------------------------------------------------------------------
// Verification standard + data-quality tiers
// ---------------------------------------------------------------------------

/**
 * What the "verified" nutrition label requires. ALL four must hold, with the
 * evidence recorded (who / when / method). "The author wrote it carefully"
 * and "the engine recomputed the same number" are NOT verification — the
 * latter is a regression check (see docs/recipe-data-quality.md).
 */
export const VERIFIED_STANDARD_EVIDENCE: readonly string[] = [
  'An independent check of the recorded per-serving nutrition against an authoritative source or an independent recomputation.',
  'A recorded reviewer identity (checkedBy) distinct from the recipe author or generator.',
  'A recorded check date (checkedAt) and method.',
  'Dietary and allergen claims re-checked against the ingredient list at verification time.',
] as const;

/** Recorded evidence for the verified label. Every field is required. */
export interface VerificationEvidence {
  checkedBy: string;
  checkedAt: string;
  method: string;
  allergenAndDietRechecked: boolean;
}

/** True only when every required evidence field is present and non-empty. */
export function meetsVerifiedStandard(
  evidence: VerificationEvidence | null | undefined,
): boolean {
  return (
    !!evidence &&
    evidence.checkedBy.trim().length > 0 &&
    isParseableDate(evidence.checkedAt) &&
    evidence.method.trim().length > 0 &&
    evidence.allergenAndDietRechecked === true
  );
}

// ---------------------------------------------------------------------------
// Review/verification date policy (v21.4)
// ---------------------------------------------------------------------------

/**
 * Earliest date a review or verification may claim. FitFusion AI was
 * commissioned on 2026-10-09 — no review could have been recorded through
 * this product before it existed, so earlier dates are rejected as
 * backdated/fictional. NOTE: this gate applies to NEW writes via the admin
 * review endpoint only; it does not re-tier or rewrite already-stored
 * evidence (see the tier functions below, which keep the looser
 * parseable-date check for stored data).
 */
export const REVIEW_DATE_MIN_ISO = '2026-10-09';

/** True when v is a strict ISO-8601 calendar date (YYYY-MM-DD, real month/day). */
export function isStrictIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // Reject impossible calendar dates (e.g. 2026-02-30).
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  );
}

function localTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * The permitted window for a review/verification date (v21.4): a real ISO
 * calendar date, on/after REVIEW_DATE_MIN_ISO, and not in the future
 * (backdated or future-dated evidence is rejected). `todayYmd` is
 * injectable (YYYY-MM-DD) for deterministic tests; it defaults to the
 * server's local calendar date.
 */
export function reviewDateInWindow(v: unknown, todayYmd?: string): boolean {
  if (!isStrictIsoDate(v)) return false;
  const date = v.trim();
  if (date < REVIEW_DATE_MIN_ISO) return false;
  const today = todayYmd ?? localTodayYmd();
  return date <= today;
}

/** The three data-quality tiers the recipe UI must visually distinguish. */
export type QualityTier = 'calculated-estimate' | 'reviewed' | 'verified';

export interface QualityTierInput {
  /** The persisted `verified` flag — a CLAIM that evidence exists. */
  verified: boolean;
  /** Recorded verification evidence (see VERIFIED_STANDARD_EVIDENCE). */
  verificationEvidence?: VerificationEvidence | null;
  /** A recorded human review (v21.3 — replaces the old `humanReviewed` boolean). */
  reviewEvidence?: ReviewRecord | null;
  /**
   * v21.8 (P4): when true, the tier NEVER rises above
   * 'calculated-estimate' — not 'verified', not 'reviewed'. needsReview
   * means the nutrition is incomplete or the content changed since the
   * last check; stored evidence, however complete, describes a state that
   * no longer holds. Optional for backward compatibility (absent = the
   * pre-v21.8 behavior); every serializer MUST pass the real value (see
   * `RecipeEvidenceInput` in apps/web/lib/recipe-evidence.ts).
   */
  needsReview?: boolean;
}

/**
 * Maps a recipe's governance state to its data-quality tier.
 * 'verified' requires BOTH the flag and complete verification evidence (a
 * bare `verified: true` with no evidence falls through — an unevidenced
 * flag is not a stronger claim).
 * 'reviewed' requires a complete review record.
 * Everything else is 'calculated-estimate' — the honest default for seed,
 * AI-generated, and engine-calculated recipes.
 *
 * v21.8 (P4): `needsReview: true` fails closed to 'calculated-estimate'
 * FIRST, before any evidence is considered. A recipe awaiting review must
 * never display a Verified badge while the 'Awaiting review' marker is
 * shown; legacy inconsistent records (evidence claims verified +
 * needsReview true) stay capped until they are resolved and properly
 * reviewed.
 */
export function qualityTier(r: QualityTierInput): QualityTier {
  if (r.needsReview === true) return 'calculated-estimate';
  if (r.verified && meetsVerifiedStandard(r.verificationEvidence)) return 'verified';
  if (meetsReviewedStandard(r.reviewEvidence)) return 'reviewed';
  return 'calculated-estimate';
}
