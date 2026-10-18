/**
 * v21.8 P1 — concurrent menu review, REAL PostgreSQL proof.
 *
 * >>> THE REAL CONCURRENCY PROOF <<<
 *
 * The mocked suite (v218-menu-review-concurrency-mocked) exercises the
 * REAL route code but replaces PostgreSQL with an in-memory map: it proves
 * the routes ISSUE conditional writes and interpret the row counts
 * correctly, but it cannot prove the database's atomic compare-and-write
 * behavior under genuine concurrency. THESE tests do: real route handlers,
 * real Prisma `updateMany` against a real PostgreSQL, two handlers
 * genuinely racing on the same submission row.
 *
 * Skip-guarded via db-guard: on this VM (no PostgreSQL) every test skips —
 * never fails. CI with a database runs them for real.
 * Run: DATABASE_URL=<redacted>
 * v218-menu-review-concurrency
 *
 *  - two simultaneous approvals → exactly one 201, one 409
 *    (`submission_not_pending`); exactly one published item;
 *  - two simultaneous rejections → exactly one 200, one 409; nothing
 *    published;
 *  - approval vs rejection race → exactly one winner, one 409, and the
 *    final state is internally consistent (approved ⇒ one item,
 *    rejected ⇒ no item);
 *  - a repeated request after resolution → 409;
 *  - rollback: the loser publishes nothing (item count unchanged).
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { PATCH as submissionReviewPATCH } from '@/app/api/menu-submissions/[id]/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

let userToken = '';
let adminToken = '';
let userId = '';
let restaurantId = '';
const createdSubmissionIds: string[] = [];
const createdMenuItemIds: string[] = [];

beforeAll(async () => {
  if (!HAS_DB) return;
  const userEmail = uniqueEmail('ff-v218-p1-user');
  const adminEmail = uniqueEmail('ff-v218-p1-admin');
  process.env.ADMIN_EMAILS = adminEmail;

  const user = await registerAndLogin(registerPOST, loginPOST, userEmail);
  const admin = await registerAndLogin(registerPOST, loginPOST, adminEmail);
  userToken = user.token;
  adminToken = admin.token;
  userId = user.userId;

  const restaurant = await prisma.restaurant.create({
    data: { provider: 'manual', name: 'V218 P1 Race Kitchen', city: 'Lahore' },
  });
  restaurantId = restaurant.id;
});

afterAll(async () => {
  if (!HAS_DB) return;
  for (const id of createdSubmissionIds) {
    await prisma.menuSubmission.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdMenuItemIds) {
    await prisma.restaurantMenuItem.delete({ where: { id } }).catch(() => {});
  }
  if (restaurantId) await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => {});
  delete process.env.ADMIN_EMAILS;
  await cleanupUsers();
});

/** Create a fresh pending submission; tracks it for cleanup. */
async function makePending(name: string): Promise<string> {
  const sub = await prisma.menuSubmission.create({
    data: {
      restaurantId,
      name,
      portion: '1 plate',
      kcal: 420,
      nutritionStatus: 'menu_photo_estimate',
      source: 'menu_photo',
      submittedBy: userId,
    },
  });
  createdSubmissionIds.push(sub.id);
  return sub.id;
}

async function review(
  id: string,
  action: 'approve' | 'reject',
  token = adminToken,
): Promise<{ status: number; body: any }> {
  const res = await submissionReviewPATCH(
    authed(jsonRequest('http://localhost/api/x', 'PATCH', { action }), token),
    { params: { id } },
  );
  return { status: res.status, body: await readJson(res) };
}

async function publishedItemCount(): Promise<number> {
  return prisma.restaurantMenuItem.count({ where: { restaurantId } });
}

describe.skipIf(!HAS_DB)('P1 — real concurrent review (PostgreSQL)', () => {
  it('two simultaneous approvals: exactly one wins, the loser 409s and publishes nothing', async () => {
    const id = await makePending(`V218 P1 Approvals ${Date.now()}`);
    const before = await publishedItemCount();
    const [a, b] = await Promise.all([
      review(id, 'approve'),
      review(id, 'approve'),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    // The loser may read before the winner commits (in-transaction guard →
// 'submission_not_pending') or after (pre-check fast path →
// 'submission_closed'). Both are 409 "you lost the race".
    expect(['submission_closed', 'submission_not_pending']).toContain(
      loser.body.error.code,
    );
    expect(winner.body.submission.status).toBe('approved');
    expect(winner.body.submission.publishedItemId).toBe(winner.body.item.id);
    createdMenuItemIds.push(winner.body.item.id);

    // Rollback: exactly one item was published by the winner.
    expect(await publishedItemCount()).toBe(before + 1);

    const row = await prisma.menuSubmission.findUnique({ where: { id } });
    expect(row!.status).toBe('approved');
    expect(row!.reviewedBy).toBeTruthy();
    expect(row!.reviewedAt).toBeTruthy();
  });

  it('two simultaneous rejections: exactly one wins, the loser 409s, nothing published', async () => {
    const id = await makePending(`V218 P1 Rejections ${Date.now()}`);
    const before = await publishedItemCount();
    const [a, b] = await Promise.all([
      review(id, 'reject'),
      review(id, 'reject'),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    // The loser may read before the winner commits (in-transaction guard →
// 'submission_not_pending') or after (pre-check fast path →
// 'submission_closed'). Both are 409 "you lost the race".
    expect(['submission_closed', 'submission_not_pending']).toContain(
      loser.body.error.code,
    );
    expect(winner.body.submission.status).toBe('rejected');
    expect(winner.body.submission.reviewedBy).toBeTruthy();

    expect(await publishedItemCount()).toBe(before);
    const row = await prisma.menuSubmission.findUnique({ where: { id } });
    expect(row!.status).toBe('rejected');
    expect(row!.publishedItemId).toBeNull();
  });

  it('approval vs rejection race: exactly one winner, internally consistent state', async () => {
    const id = await makePending(`V218 P1 Mixed ${Date.now()}`);
    const before = await publishedItemCount();
    const [approveRes, rejectRes] = await Promise.all([
      review(id, 'approve'),
      review(id, 'reject'),
    ]);
    expect([approveRes.status, rejectRes.status]).toContain(409);
    const loser = approveRes.status === 409 ? approveRes : rejectRes;
    // The loser may read before the winner commits (in-transaction guard →
// 'submission_not_pending') or after (pre-check fast path →
// 'submission_closed'). Both are 409 "you lost the race".
    expect(['submission_closed', 'submission_not_pending']).toContain(
      loser.body.error.code,
    );

    const row = await prisma.menuSubmission.findUnique({ where: { id } });
    if (approveRes.status === 201) {
      createdMenuItemIds.push(approveRes.body.item.id);
      expect(await publishedItemCount()).toBe(before + 1);
      expect(row!.status).toBe('approved');
      expect(row!.publishedItemId).toBe(approveRes.body.item.id);
    } else {
      expect(rejectRes.status).toBe(200);
      expect(await publishedItemCount()).toBe(before);
      expect(row!.status).toBe('rejected');
      expect(row!.publishedItemId).toBeNull();
    }
  });

  it('a repeated request after resolution is 409 (pre-check)', async () => {
    const id = await makePending(`V218 P1 Repeat ${Date.now()}`);
    const first = await review(id, 'approve');
    expect(first.status).toBe(201);
    createdMenuItemIds.push(first.body.item.id);

    const again = await review(id, 'approve');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('submission_closed');

    const cross = await review(id, 'reject');
    expect(cross.status).toBe(409);
  });

  it('the loser never leaves a published item behind (rollback proof)', async () => {
    // Five approvers at once: one item, not five, not zero.
    const id = await makePending(`V218 P1 Flood ${Date.now()}`);
    const before = await publishedItemCount();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => review(id, 'approve')),
    );
    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(4);
    // Both 409 codes are legitimate loser outcomes: a loser whose pre-check
    // ran after the winner committed sees `submission_closed`; a loser whose
    // pre-check ran before but whose transaction lost the conditional write
    // sees `submission_not_pending`. Either way nothing is published twice.
    for (const r of lost) {
      expect(['submission_closed', 'submission_not_pending']).toContain(r.body.error.code);
    }
    createdMenuItemIds.push(won[0].body.item.id);
    expect(await publishedItemCount()).toBe(before + 1);
  });

  it('non-admins still cannot review (authz preserved)', async () => {
    const id = await makePending(`V218 P1 Authz ${Date.now()}`);
    const res = await review(id, 'approve', userToken);
    expect(res.status).toBe(403);
    const row = await prisma.menuSubmission.findUnique({ where: { id } });
    expect(row!.status).toBe('pending');
  });
});
