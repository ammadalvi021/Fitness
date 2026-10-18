import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireAdmin } from '@/lib/admin';
import { apiError, apiOk, zodMessage } from '@/lib/server-api';
import {
  MenuSubmissionReviewSchema,
  validateMenuItemHonesty,
} from '@/lib/menu-api-schema';

export const dynamic = 'force-dynamic';

/**
 * Admin: approve or reject a menu submission (v21.8 P2).
 *
 * Approving reviews dish, portion, nutrition assumptions, and source, then
 * publishes a RestaurantMenuItem copy — in ONE transaction with the review
 * stamp, so an approved submission and its published item can never drift
 * apart. Rejecting keeps the submission private forever (it is never
 * published and never appears in the public menu response).
 *
 * v21.8 P1 — concurrent review safety: the pre-transaction `findUnique` +
 * pending check below is only a fast-path UX hint; the DECISION is the
 * conditional state transition executed INSIDE the transaction
 * (`updateMany` with `status: 'pending'` in the where). Two admins racing
 * on the same submission both see it pending beforehand, but exactly one
 * conditional write matches a row. The loser gets `count === 0` → 409
 * `submission_not_pending` and its transaction rolls back, so the loser
 * publishes nothing. Both the approve and the reject path claim the
 * submission this way.
 */
class SubmissionNotPendingError extends Error {}

/** Map the lost-claim sentinel to 409; rethrow anything else. */
function claimConflictOrRethrow(err: unknown): NextResponse {
  if (err instanceof SubmissionNotPendingError) {
    return apiError(
      'submission_not_pending',
      'Submission has already been reviewed',
      409,
    );
  }
  throw err;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireAdmin(req);
  if (s instanceof NextResponse) return s;

  const submission = await prisma.menuSubmission.findUnique({
    where: { id: params.id },
  });
  if (!submission) {
    return apiError('submission_not_found', 'Menu submission not found', 404);
  }
  if (submission.status !== 'pending') {
    return apiError('submission_closed', 'Submission has already been reviewed', 409);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('invalid_json', 'Request body must be valid JSON', 400);
  }
  const parsed = MenuSubmissionReviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid review', 400, zodMessage(parsed.error));
  }
  const { action, reviewNote } = parsed.data;

  if (action === 'reject') {
    // Reject claims the submission with a conditional write INSIDE the
    // transaction: a concurrent approve/reject that already resolved the
    // submission yields count 0 → 409 and rolls back.
    try {
      const rejected = await prisma.$transaction(async (tx) => {
        const { count } = await tx.menuSubmission.updateMany({
          where: { id: params.id, status: 'pending' },
          data: {
            status: 'rejected',
            reviewedBy: s.user.id,
            reviewedAt: new Date(),
            reviewNote: reviewNote ?? null,
          },
        });
        if (count === 0) throw new SubmissionNotPendingError();
        return tx.menuSubmission.findUniqueOrThrow({ where: { id: params.id } });
      });
      return apiOk({ submission: rejected });
    } catch (err) {
      return claimConflictOrRethrow(err);
    }
  }

  // Approve: the honesty invariant must hold on what gets published.
  const honesty = validateMenuItemHonesty(submission.kcal, submission.nutritionStatus);
  if (honesty) {
    return apiError('validation_error', honesty, 400);
  }

  try {
    const published = await prisma.$transaction(async (tx) => {
      // Claim the submission FIRST with the conditional pending-state
      // transition: the loser throws here, before any menu item is created,
      // and its transaction rolls back publishing nothing.
      const { count } = await tx.menuSubmission.updateMany({
        where: { id: params.id, status: 'pending' },
        data: {
          status: 'approved',
          reviewedBy: s.user.id,
          reviewedAt: new Date(),
          reviewNote: reviewNote ?? null,
        },
      });
      if (count === 0) throw new SubmissionNotPendingError();

      const item = await tx.restaurantMenuItem.create({
        data: {
          restaurantId: submission.restaurantId,
          name: submission.name,
          description: submission.description,
          portion: submission.portion,
          kcal: submission.kcal,
          proteinG: submission.proteinG,
          carbsG: submission.carbsG,
          fatG: submission.fatG,
          fiberG: submission.fiberG,
          nutritionStatus: submission.nutritionStatus,
          assumptions: submission.assumptions ?? [],
          source: submission.source,
        },
      });
      // The claim above already holds this row inside our transaction; a
      // plain update for the publish linkage is sufficient here.
      const reviewed = await tx.menuSubmission.update({
        where: { id: params.id },
        data: { publishedItemId: item.id },
      });
      return { item, submission: reviewed };
    });
    return apiOk(published, 201);
  } catch (err) {
    return claimConflictOrRethrow(err);
  }
}
