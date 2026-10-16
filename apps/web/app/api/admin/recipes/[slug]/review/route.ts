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
 *           reviewEvidence?: <ReviewRecord>,
 *           expectedContentHash: string | null,   ← REQUIRED (v21.6)
 *           expectedRevision: number }            ← REQUIRED (v21.7)
 *   v21.5: `expectedContentHash` is the optimistic-concurrency guard (the
 *   hash returned by the GET prefill). v21.6: the guard is REQUIRED — an
 *   absent guard is rejected with 409 `stale_recipe` (reload and retry);
 *   there is no unguarded write path anymore. Explicit `null` names a
 *   legacy NULL-hash row (the write is conditional on contentHash IS NULL —
 *   a concurrent edit moves the hash to non-null and the write 409s).
 *   v21.7: the guard is the (hash, revision) PAIR
 *   (recipe-governance.ts §5b). `expectedRevision` (integer, 0 for rows
 *   written before v21.7) is REQUIRED alongside the hash; absent is 409.
 *   The revision increments on EVERY mutation — including
 *   review/verify/clear, which never move the content hash — so a stale
 *   clear/review/verify can never silently overwrite a newer review
 *   state, and two concurrent admin actions can never both land.
 *   Every write is a single conditional updateMany on
 *   { slug, contentHash, revision } with `revision: { increment: 1 }` in
 *   the SAME statement: zero matched rows means a concurrent mutation
 *   changed the recipe or its review state mid-review → 409
 *   `stale_recipe` (safe to retry after reloading), never a review or
 *   verification recorded against content/state the reviewer never saw.
 *   The 'verify' action additionally re-reads the recipe immediately
 *   before the write to refuse verification if needsReview flipped true
 *   (defense in depth).
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
import { prisma, PrismaRuntime, type Prisma, type Recipe } from '@fitfusion/db';
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
  /**
   * v21.5 (P4): optimistic-concurrency guard — the contentHash the admin
   * read from GET. v21.6: the guard is REQUIRED (recipe-governance.ts §5) —
   * absent means the write is rejected with 409 `stale_recipe`. Explicit
   * `null` names a legacy NULL-hash row (conditional write on
   * contentHash IS NULL, never unconditional).
   */
  expectedContentHash: string | null;
  /**
   * v21.7: the second half of the guard pair
   * (recipe-governance.ts §5b) — the revision token the admin read from
   * the GET prefill (0 for rows written before v21.7). REQUIRED alongside
   * expectedContentHash; absent means 409 `stale_recipe`. The write is
   * conditional on `revision` matching, and increments it in the same
   * statement — so review/verify/clear bump the revision even though
   * they never move the content hash.
   */
  expectedRevision: number;
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
  // v21.5 (P4): the concurrency guard is a write precondition, never
  // content — reject malformed values up front so a garbage hash can never
  // silently degrade to the unguarded path.
  // v21.6: the guard is REQUIRED — an absent guard is rejected with 409
  // `stale_recipe` and an actionable message (reload the prefill, resend
  // the contentHash you read, retry). There is no unguarded write path.
  if (o.expectedContentHash === undefined) {
    return {
      ok: false,
      res: apiError(
        'stale_recipe',
        'Review write requires expectedContentHash (the contentHash from the GET prefill, or explicit null for recipes that predate hash tracking). Reload the review prefill and retry.',
        409,
        'expectedContentHash was not supplied',
      ),
    };
  }
  if (o.expectedContentHash !== null) {
    if (
      typeof o.expectedContentHash !== 'string' ||
      o.expectedContentHash.trim().length === 0 ||
      o.expectedContentHash.length > 128
    ) {
      return {
        ok: false,
        res: apiError('validation_error', 'expectedContentHash must be a non-empty string of at most 128 characters, or explicit null', 400),
      };
    }
  }
  // v21.7: the revision token is the second half of the guard pair
  // (recipe-governance.ts §5b) — REQUIRED on every review write,
  // exactly like the hash. Absent → 409 `stale_recipe` with an actionable
  // message (reload the prefill and retry); there is no unguarded path.
  if (o.expectedRevision === undefined) {
    return {
      ok: false,
      res: apiError(
        'stale_recipe',
        'Review write requires expectedRevision (the revision token from the GET prefill; 0 for recipes written before v21.7). Reload the review prefill and retry.',
        409,
        'expectedRevision was not supplied',
      ),
    };
  }
  if (
    typeof o.expectedRevision !== 'number' ||
    !Number.isInteger(o.expectedRevision) ||
    o.expectedRevision < 0
  ) {
    return {
      ok: false,
      res: apiError('validation_error', 'expectedRevision must be a non-negative integer', 400),
    };
  }
  return {
    ok: true,
    body: {
      action: o.action,
      evidence: o.evidence,
      reviewEvidence: o.reviewEvidence,
      expectedContentHash: o.expectedContentHash as string | null,
      expectedRevision: o.expectedRevision as number,
    },
  };
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

/**
 * v21.5 (P4) conditional write for optimistic concurrency, v21.6: the
 * write is ALWAYS conditional (recipe-governance.ts §5 — there is no
 * unguarded path), v21.7: the guard is the (hash, revision) pair
 * (recipe-governance.ts §5b).
 *
 * The write goes through `updateMany` on `{ slug, contentHash, revision }`
 * and increments `revision` IN THE SAME statement: it lands only if no
 * PATCH or review action touched the recipe or its review state in
 * between. An explicit `null` hash guard names a legacy NULL-hash row
 * (Prisma matches it as IS NULL — a concurrent edit moves the hash to
 * non-null, so the write fails exactly like a hash mismatch). Zero matched
 * rows → null, and the caller answers 409 `stale_recipe` (safe to retry
 * after reloading).
 *
 * Returns null on a conflict; never performs a partial write (a single
 * atomic statement either way).
 */
async function guardedReviewUpdate(
  slug: string,
  expectedContentHash: string | null,
  expectedRevision: number,
  data: Prisma.RecipeUpdateInput,
): Promise<Recipe | null> {
  const res = await prisma.recipe.updateMany({
    where: { slug, contentHash: expectedContentHash, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (res.count === 0) return null;
  // The conditional write already won the race; this read is only for the
  // response body. Null (deleted in the gap) still maps to the safe 409.
  return prisma.recipe.findUnique({ where: { slug } });
}

function staleReviewError(): NextResponse {
  return apiError(
    'stale_recipe',
    'The recipe or its review state changed while you were reviewing. Reload the recipe and re-check the current content before recording.',
    409,
    'expectedContentHash/expectedRevision did not match the stored revision',
  );
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
    // v21.5 (P4) / v21.6: the current content revision. The review form
    // sends it back as expectedContentHash (explicit null for legacy rows)
    // so a concurrent PATCH fails the write with 409 instead of recording
    // evidence against changed content. null = the recipe predates
    // content-hash tracking — the client then sends explicit null, and the
    // server writes conditionally on contentHash IS NULL.
    contentHash: recipe.contentHash ?? null,
    // v21.7: the current mutation counter (recipe-governance.ts §5b).
    // The review form sends it back as expectedRevision so a concurrent
    // review/verify/clear fails the write with 409 instead of silently
    // overwriting a newer review state. Rows written before v21.7 carry
    // revision 0 (the migration default).
    revision: recipe.revision ?? 0,
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
  const { action, evidence, reviewEvidence: suppliedReview, expectedContentHash, expectedRevision } = parsed.body;

  const recipe = await prisma.recipe.findUnique({ where: { slug: params.slug } });
  if (!recipe) return apiError('not_found', 'Recipe not found', 404);

  const identity = s.user.email;

  if (action === 'clear') {
    const updated = await guardedReviewUpdate(
      params.slug,
      expectedContentHash,
      expectedRevision,
      // Prisma Json? columns: PrismaRuntime.JsonNull writes SQL NULL.
      { verified: false, verificationEvidence: PrismaRuntime.JsonNull, reviewEvidence: PrismaRuntime.JsonNull },
    );
    // v21.5 (P4): a concurrent PATCH changed the recipe content while the
    // admin was deciding — the clear must not land on content the admin
    // never saw. 409 is safe to retry after reloading.
    // v21.7: a concurrent review/verify/clear moved the revision — the
    // stale clear 409s instead of silently undoing the newer state.
    if (!updated) return staleReviewError();
    return apiOk({
      recipe: {
        slug: updated.slug,
        tier: qualityTier({ verified: false }),
        verified: false,
        reviewEvidence: null,
        verificationEvidence: null,
        // v21.6: the current content revision.
        contentHash: updated.contentHash ?? null,
        // v21.7: the clear bumps the revision — the next guarded write
        // must carry THIS value.
        revision: updated.revision ?? 0,
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
    const updated = await guardedReviewUpdate(
      params.slug,
      expectedContentHash,
      expectedRevision,
      {
        reviewEvidence: toJsonValue(v.record),
        ...(wasVerified
          ? { verified: false, verificationEvidence: PrismaRuntime.JsonNull }
          : {}),
      },
    );
    // v21.5 (P4): concurrent content change mid-review → 409, never a
    // review recorded against content the reviewer never saw.
    if (!updated) return staleReviewError();
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
        // v21.6: the current content revision.
        contentHash: updated.contentHash ?? null,
        // v21.7: the review bumps the revision — the next guarded write
        // must carry THIS value.
        revision: updated.revision ?? 0,
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
  // v21.5 (P4) defense in depth: re-read the recipe IMMEDIATELY before the
  // write and refuse verification if needsReview flipped true since the
  // initial read — a concurrent PATCH may have made the nutrition
  // incomplete between the read and this write. (With an expectedContentHash
  // the conditional write below would also fail, because any material edit
  // moves the hash; the explicit flag check answers with the actionable
  // 400 rather than a 409.) Stale evidence can never restore a
  // verification: a material mid-review edit also destroys the stored
  // review evidence via PATCH invalidation, so finalReview above would no
  // longer meet the standard anyway.
  const fresh = await prisma.recipe.findUnique({ where: { slug: params.slug } });
  if (!fresh) return apiError('not_found', 'Recipe not found', 404);
  if (!mayVerifyNutrition(fresh.needsReview)) {
    return apiError(
      'incomplete_nutrition',
      incompleteVerificationBlockMessageForRows(
        fresh.ingredients as unknown as
          | Array<{ name: string; nutritionStatus?: string | null }>
          | null,
      ),
      400,
    );
  }
  const updated = await guardedReviewUpdate(
    params.slug,
    expectedContentHash,
    expectedRevision,
    {
      verified: true,
      verificationEvidence: toJsonValue(ve.evidence),
      reviewEvidence: toJsonValue(finalReview as ReviewRecord),
    },
  );
  // v21.5 (P4): the recipe content changed mid-review → 409, never a
  // verification stamped on content the verifier never checked.
  // v21.7: a concurrent review-state change moved the revision → 409.
  if (!updated) return staleReviewError();
  return apiOk({
    recipe: {
      slug: updated.slug,
      tier: 'verified' as QualityTier,
      verified: true,
      reviewEvidence: finalReview,
      verificationEvidence: ve.evidence,
      // v21.6: the current content revision.
      contentHash: updated.contentHash ?? null,
      // v21.7: the verify bumps the revision — the next guarded write
      // must carry THIS value.
      revision: updated.revision ?? 0,
    },
  });
}
