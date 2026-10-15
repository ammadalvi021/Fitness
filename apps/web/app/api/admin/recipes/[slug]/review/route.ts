/**
 * Admin recipe review workflow (v21.3).
 *
 * GET  /api/admin/recipes/[slug]/review — admin-only. Returns the recipe's
 *   current governance state (tier, full evidence) plus the reviewer's
 *   identity (session email) for the admin panel prefill. Ordinary users and
 *   anonymous callers get 401/403 from requireAdmin.
 *
 * POST /api/admin/recipes/[slug]/review — admin-only.
 *   Body: { action: 'review' | 'verify' | 'clear',
 *           evidence?: <ReviewRecord | VerificationEvidence>,
 *           reviewEvidence?: <ReviewRecord> }
 *   - 'review': records a human review. `evidence` must be a complete
 *     ReviewRecord (validated field-by-field, then against
 *     meetsReviewedStandard()). Sets reviewEvidence. v21.4: when the recipe
 *     is currently verified, the verification is RESET in the same update
 *     (verified=false, verification evidence destroyed) — the old
 *     verification was tied to the earlier review/content, and a bare
 *     review never preserves it. Re-verify via the 'verify' action.
 *   - 'verify': records verification. `evidence` must be a complete
 *     VerificationEvidence (meetsVerifiedStandard()) AND a complete review
 *     record must exist — either already stored on the recipe, or supplied
 *     as `reviewEvidence` in the same call (both-in-one-call is accepted;
 *     the review is saved first, then the verification). Sets verified=true
 *     and stores verificationEvidence. v21.4: REJECTED with 400
 *     `incomplete_nutrition` when recipe.needsReview is true — incomplete
 *     nutrition can never be verified (resolve → recalculate → re-review →
 *     then verify).
 *   - 'clear': removes all status — verified=false, both evidence columns
 *     set to NULL. Evidence is destroyed, not hidden.
 *
 * Anti-forgery: the reviewer/checkedBy identity is ALWAYS taken from the
 * authenticated session (s.user.email) — a client-supplied identity is
 * overwritten server-side. Every other field is validated server-side:
 * strings must be non-blank, recheck flags must be === true, dates must be
 * ISO-parseable. A bare client claim with no evidence never changes the tier.
 *
 * Canonical policy: `qualityTier`, `meetsVerifiedStandard`,
 * `meetsReviewedStandard` from @fitfusion/core (single source of truth).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma, PrismaRuntime, type Prisma } from '@fitfusion/db';
import {
  REVIEW_DATE_MIN_ISO,
  REVIEW_METHODS,
  VERIFICATION_METHODS,
  incompleteVerificationBlockMessageForRows,
  isReviewMethod,
  isVerificationMethod,
  mayVerifyNutrition,
  meetsReviewedStandard,
  meetsVerifiedStandard,
  qualityTier,
  reviewDateInWindow,
  type QualityTier,
  type ReviewRecord,
  type VerificationEvidence,
} from '@fitfusion/core';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, readJson } from '@/lib/server-api';
import { incompleteStatusForAdmin } from '@/lib/recipe-incomplete';

export const dynamic = 'force-dynamic';

type Action = 'review' | 'verify' | 'clear';

interface ValidatedBody {
  action: Action;
  evidence: unknown;
  reviewEvidence: unknown;
}

function parseBody(data: unknown): { ok: true; body: ValidatedBody } | { ok: false; res: NextResponse } {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, res: apiError('validation_error', 'Request body must be a JSON object', 400) };
  }
  const o = data as Record<string, unknown>;
  if (o.action !== 'review' && o.action !== 'verify' && o.action !== 'clear') {
    return {
      ok: false,
      res: apiError('validation_error', "action must be 'review', 'verify', or 'clear'", 400),
    };
  }
  return { ok: true, body: { action: o.action, evidence: o.evidence, reviewEvidence: o.reviewEvidence } };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonBlank(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate a client-supplied review record. Identity comes from the server
 * (session email) — the client's `reviewer` field, if present, is ignored
 * (never read, never stored). Method is validated against the controlled
 * REVIEW_METHODS vocabulary (blank / invented / oversized strings are all
 * rejected — the only accepted values are the enum members), and the date
 * must fall inside the permitted review window (real ISO calendar date, not
 * before the app existed, not in the future).
 * Returns field-level errors so the admin UI can show actionable messages.
 */
function validateReviewRecord(
  v: unknown,
  reviewerIdentity: string,
): { ok: true; record: ReviewRecord } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(v)) return { ok: false, errors: ['evidence must be an object'] };
  if (!isReviewMethod(v.method))
    errors.push(`method must be one of: ${REVIEW_METHODS.join(', ')}`);
  if (!nonBlank(v.reference)) errors.push('reference is required (what evidence was used?)');
  if (!reviewDateInWindow(v.reviewedAt))
    errors.push(
      `reviewedAt must be a real ISO date (YYYY-MM-DD) on/after ${REVIEW_DATE_MIN_ISO} and not in the future`,
    );
  if (v.dietaryRechecked !== true) errors.push('dietaryRechecked must be checked (dietary claims re-checked against the ingredient list)');
  if (v.allergenRechecked !== true) errors.push('allergenRechecked must be checked (allergen list re-checked against the ingredient list)');
  const record: ReviewRecord = {
    reviewer: reviewerIdentity,
    reviewedAt: typeof v.reviewedAt === 'string' ? v.reviewedAt.trim() : '',
    method: typeof v.method === 'string' ? v.method.trim() : '',
    reference: typeof v.reference === 'string' ? v.reference.trim() : '',
    dietaryRechecked: v.dietaryRechecked === true,
    allergenRechecked: v.allergenRechecked === true,
  };
  // The canonical completeness gate runs on the final object (with the
  // server-set identity) — a belt-and-suspenders check on top of the
  // field-level messages above.
  if (!meetsReviewedStandard(record)) errors.push('review record is incomplete');
  return errors.length ? { ok: false, errors } : { ok: true, record };
}

/**
 * Validate a client-supplied verification record. Identity (checkedBy) is
 * server-set from the session, same anti-forgery rule as reviews. Method is
 * validated against the controlled VERIFICATION_METHODS vocabulary, and the
 * date must fall inside the permitted review window. A non-empty method
 * string alone never constitutes verification — the v21.3 evidence
 * requirements (complete record, recheck flags, and a complete review first)
 * stay in force on top of this.
 */
function validateVerificationEvidence(
  v: unknown,
  checkerIdentity: string,
): { ok: true; evidence: VerificationEvidence } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(v)) return { ok: false, errors: ['evidence must be an object'] };
  if (!isVerificationMethod(v.method))
    errors.push(`method must be one of: ${VERIFICATION_METHODS.join(', ')}`);
  if (!reviewDateInWindow(v.checkedAt))
    errors.push(
      `checkedAt must be a real ISO date (YYYY-MM-DD) on/after ${REVIEW_DATE_MIN_ISO} and not in the future`,
    );
  if (v.allergenAndDietRechecked !== true)
    errors.push('allergenAndDietRechecked must be checked (dietary + allergen claims re-checked at verification time)');
  const evidence: VerificationEvidence = {
    checkedBy: checkerIdentity,
    checkedAt: typeof v.checkedAt === 'string' ? v.checkedAt.trim() : '',
    method: typeof v.method === 'string' ? v.method.trim() : '',
    allergenAndDietRechecked: v.allergenAndDietRechecked === true,
  };
  if (!meetsVerifiedStandard(evidence)) errors.push('verification evidence is incomplete');
  return errors.length ? { ok: false, errors } : { ok: true, evidence };
}

function asReviewRecord(v: unknown): ReviewRecord | null {
  if (!isRecord(v)) return null;
  return {
    reviewer: typeof v.reviewer === 'string' ? v.reviewer : '',
    reviewedAt: typeof v.reviewedAt === 'string' ? v.reviewedAt : '',
    method: typeof v.method === 'string' ? v.method : '',
    reference: typeof v.reference === 'string' ? v.reference : '',
    dietaryRechecked: v.dietaryRechecked === true,
    allergenRechecked: v.allergenRechecked === true,
  };
}

function asVerificationEvidence(v: unknown): VerificationEvidence | null {
  if (!isRecord(v)) return null;
  return {
    checkedBy: typeof v.checkedBy === 'string' ? v.checkedBy : '',
    checkedAt: typeof v.checkedAt === 'string' ? v.checkedAt : '',
    method: typeof v.method === 'string' ? v.method : '',
    allergenAndDietRechecked: v.allergenAndDietRechecked === true,
  };
}

interface Params {
  params: { slug: string };
}

function toJsonValue(v: object): Prisma.InputJsonValue {
  return v as unknown as Prisma.InputJsonValue;
}

export async function GET(req: NextRequest, { params }: Params) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const recipe = await prisma.recipe.findUnique({ where: { slug: params.slug } });
  if (!recipe) return apiError('not_found', 'Recipe not found', 404);

  const reviewEvidence = asReviewRecord(recipe.reviewEvidence);
  const verificationEvidence = asVerificationEvidence(recipe.verificationEvidence);
  const tier: QualityTier = qualityTier({
    verified: recipe.verified,
    verificationEvidence,
    reviewEvidence,
  });
  // v21.4: the admin panel must see WHY verification is blocked on an
  // incomplete recipe — the needsReview flag plus the unresolved ingredient
  // names. (Verification is refused server-side regardless; this is display.)
  const incomplete = incompleteStatusForAdmin({
    needsReview: recipe.needsReview,
    ingredients: recipe.ingredients,
  });
  return apiOk({
    recipe: { slug: recipe.slug, title: recipe.title, verified: recipe.verified },
    tier,
    reviewEvidence,
    verificationEvidence,
    needsReview: incomplete.needsReview,
    unresolvedIngredients: incomplete.unresolvedIngredients,
    verificationBlocked: incomplete.verificationBlocked,
    // Reviewer identity is prefilled from the session, never typed by hand.
    reviewer: s.user.email,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = parseBody(body.data);
  if (!parsed.ok) return parsed.res;
  const { action, evidence, reviewEvidence: suppliedReview } = parsed.body;

  const recipe = await prisma.recipe.findUnique({ where: { slug: params.slug } });
  if (!recipe) return apiError('not_found', 'Recipe not found', 404);

  const identity = s.user.email;

  if (action === 'clear') {
    const updated = await prisma.recipe.update({
      where: { slug: params.slug },
      // Prisma Json? columns: PrismaRuntime.JsonNull writes SQL NULL.
      data: { verified: false, verificationEvidence: PrismaRuntime.JsonNull, reviewEvidence: PrismaRuntime.JsonNull },
    });
    return apiOk({
      recipe: {
        slug: updated.slug,
        tier: qualityTier({ verified: false }),
        verified: false,
        reviewEvidence: null,
        verificationEvidence: null,
      },
    });
  }

  if (action === 'review') {
    const v = validateReviewRecord(evidence, identity);
    if (!v.ok) {
      return apiError('validation_error', 'Review evidence is incomplete', 400, v.errors.join('; '));
    }
    // v21.4: a NEW review on an already-verified recipe resets the
    // verification (canonical policy in packages/core/src/recipe-governance.ts).
    // The old verification evidence was tied to the earlier review/content;
    // a bare 'review' never preserves a verification. The supported atomic
    // re-verify path is the 'verify' action with fresh verification evidence
    // (which accepts reviewEvidence in the same call).
    const wasVerified = recipe.verified === true;
    const updated = await prisma.recipe.update({
      where: { slug: params.slug },
      data: {
        reviewEvidence: toJsonValue(v.record),
        ...(wasVerified
          ? { verified: false, verificationEvidence: PrismaRuntime.JsonNull }
          : {}),
      },
    });
    const verificationEvidenceAfter = wasVerified
      ? null
      : asVerificationEvidence(updated.verificationEvidence);
    return apiOk({
      recipe: {
        slug: updated.slug,
        tier: qualityTier({
          verified: updated.verified,
          verificationEvidence: verificationEvidenceAfter,
          reviewEvidence: v.record,
        }),
        verified: updated.verified,
        reviewEvidence: v.record,
        verificationEvidence: verificationEvidenceAfter,
        verificationReset: wasVerified,
      },
    });
  }

  // action === 'verify'
  // v21.4 canonical policy (packages/core/src/recipe-governance.ts): a
  // recipe with needsReview=true (unresolved ingredients / incomplete
  // nutrition) can NEVER be verified — no matter how complete the evidence
  // looks. The required path is: resolve the missing nutritional values or
  // serving info → recalculate → re-review → then verify. The flag is never
  // cleared just to permit verification.
  if (!mayVerifyNutrition(recipe.needsReview)) {
    return apiError(
      'incomplete_nutrition',
      incompleteVerificationBlockMessageForRows(
        recipe.ingredients as unknown as
          | Array<{ name: string; nutritionStatus?: string | null }>
          | null,
      ),
      400,
    );
  }
  // A complete review record is required: either already stored, or supplied
  // in this call (saved alongside the verification).
  let finalReview: ReviewRecord | null = asReviewRecord(recipe.reviewEvidence);
  if (!meetsReviewedStandard(finalReview) && suppliedReview !== undefined) {
    const v = validateReviewRecord(suppliedReview, identity);
    if (!v.ok) {
      return apiError(
        'validation_error',
        'Verification requires a complete review record first',
        400,
        v.errors.join('; '),
      );
    }
    finalReview = v.record;
  }
  if (!meetsReviewedStandard(finalReview)) {
    return apiError(
      'validation_error',
      'Verification requires a complete review record first',
      400,
      'record a review first, or supply reviewEvidence in this call',
    );
  }
  const ve = validateVerificationEvidence(evidence, identity);
  if (!ve.ok) {
    return apiError('validation_error', 'Verification evidence is incomplete', 400, ve.errors.join('; '));
  }
  const updated = await prisma.recipe.update({
    where: { slug: params.slug },
    data: {
      verified: true,
      verificationEvidence: toJsonValue(ve.evidence),
      reviewEvidence: toJsonValue(finalReview as ReviewRecord),
    },
  });
  return apiOk({
    recipe: {
      slug: updated.slug,
      tier: 'verified' as QualityTier,
      verified: true,
      reviewEvidence: finalReview,
      verificationEvidence: ve.evidence,
    },
  });
}
