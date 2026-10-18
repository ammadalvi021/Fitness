/**
 * Recipe evidence shaping for the public recipes API (v21.3).
 *
 * Decision (documented): the server is the tier authority — it computes the
 * canonical `tier` from the FULL stored evidence via `qualityTier()` in
 * @fitfusion/core and returns it in the response, so clients never re-derive
 * tiers from partial data. Alongside the tier, every caller gets
 * presence + reviewer/date summaries for display:
 *   - `reviewInfo`: { reviewer, reviewedAt } | null
 *   - `verificationInfo`: { checkedBy, checkedAt, method } | null
 * Full evidence objects (`reviewEvidence`, `verificationEvidence`) are
 * returned ONLY to admins — ordinary users and anonymous callers get the
 * summaries. The `reference` free-text in a review record may contain
 * internal working notes, hence the admin-only restriction.
 */
import {
  qualityTier,
  type QualityTier,
  type ReviewRecord,
  type VerificationEvidence,
} from '@fitfusion/core';

export interface RecipeEvidenceInput {
  verified: boolean;
  verificationEvidence: unknown;
  reviewEvidence: unknown;
  /**
   * v21.8 (P4): REQUIRED — the canonical tier rule fails closed when this
   * is true (never 'verified'/'reviewed'), so the serializer cannot be
   * built without stating the review state. Full Prisma recipe rows always
   * carry this column; partial test fixtures must state it explicitly.
   */
  needsReview: boolean;
}

export interface ShapedEvidence {
  tier: QualityTier;
  reviewInfo: { reviewer: string; reviewedAt: string } | null;
  verificationInfo: { checkedBy: string; checkedAt: string; method: string } | null;
  /** Admins only — undefined for everyone else. */
  reviewEvidence?: ReviewRecord | null;
  /** Admins only — undefined for everyone else. */
  verificationEvidence?: VerificationEvidence | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asReviewRecord(v: unknown): ReviewRecord | null {
  if (!isRecord(v)) return null;
  return {
    reviewer: str(v.reviewer),
    reviewedAt: str(v.reviewedAt),
    method: str(v.method),
    reference: str(v.reference),
    dietaryRechecked: v.dietaryRechecked === true,
    allergenRechecked: v.allergenRechecked === true,
  };
}

function asVerificationEvidence(v: unknown): VerificationEvidence | null {
  if (!isRecord(v)) return null;
  return {
    checkedBy: str(v.checkedBy),
    checkedAt: str(v.checkedAt),
    method: str(v.method),
    allergenAndDietRechecked: v.allergenAndDietRechecked === true,
  };
}

/** Shape one recipe's governance fields for API output. */
export function shapeRecipeEvidence(
  r: RecipeEvidenceInput,
  isAdmin: boolean,
): ShapedEvidence {  const review = asReviewRecord(r.reviewEvidence);
  const verification = asVerificationEvidence(r.verificationEvidence);
  // v21.8 (P4): needsReview is part of the canonical tier input — a
  // recipe awaiting review never tiers above 'calculated-estimate', so
  // the public serializer and the admin review endpoint (which calls
  // qualityTier directly) always agree. Single source of truth:
  // qualityTier() in @fitfusion/core.
  const tier = qualityTier({
    verified: r.verified,
    verificationEvidence: verification,
    reviewEvidence: review,
    needsReview: r.needsReview,
  });
  const shaped: ShapedEvidence = {
    tier,
    reviewInfo:
      review && review.reviewer
        ? { reviewer: review.reviewer, reviewedAt: review.reviewedAt }
        : null,
    verificationInfo:
      verification && verification.checkedBy
        ? {
            checkedBy: verification.checkedBy,
            checkedAt: verification.checkedAt,
            method: verification.method,
          }
        : null,
  };
  if (isAdmin) {
    shaped.reviewEvidence = review;
    shaped.verificationEvidence = verification;
  }
  return shaped;
}

/**
 * Reviewer identity shown to non-admins (v21.4). The stored reviewer /
 * checkedBy value is the admin's session email (server-set by the review
 * workflow); the data model has no publication-consent field, so non-admins
 * see a role label instead of the raw email. Admins keep seeing the full
 * evidence objects (with real identities) via `shapeRecipeEvidence`.
 */
export const PUBLIC_REVIEWER_LABEL = 'FitFusion reviewer';

/**
 * Serialize a full Prisma recipe row for an API response (v21.4).
 *
 * SECURITY: never spread a raw Prisma record into a response — the row
 * carries the raw `reviewEvidence` / `verificationEvidence` JSONB columns,
 * which are admin-only. This serializer strips those two keys FIRST and only
 * then merges the shaped evidence (`shapeRecipeEvidence`), so a non-admin
 * can never receive the full evidence objects — even if the shaping helper
 * omits a key, the raw column is already gone. For non-admins, the
 * reviewer/checkedBy identities in the display summaries are replaced with
 * PUBLIC_REVIEWER_LABEL (there is no consent field on the record, so emails
 * are redacted by default).
 */
export function serializeRecipePublic<
  T extends RecipeEvidenceInput & Record<string, unknown>,
>(
  r: T,
  isAdmin: boolean,
): Omit<T, 'reviewEvidence' | 'verificationEvidence'> & ShapedEvidence {
  const {
    reviewEvidence: _droppedReviewEvidence,
    verificationEvidence: _droppedVerificationEvidence,
    ...rest
  } = r;
  const shaped = shapeRecipeEvidence(r, isAdmin);
  if (!isAdmin) {
    if (shaped.reviewInfo) {
      shaped.reviewInfo = {
        reviewer: PUBLIC_REVIEWER_LABEL,
        reviewedAt: shaped.reviewInfo.reviewedAt,
      };
    }
    if (shaped.verificationInfo) {
      shaped.verificationInfo = {
        checkedBy: PUBLIC_REVIEWER_LABEL,
        checkedAt: shaped.verificationInfo.checkedAt,
        method: shaped.verificationInfo.method,
      };
    }
  }
  return { ...rest, ...shaped };
}
