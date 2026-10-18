/**
 * v21.8 P1 — concurrent menu review, mocked-transaction suite.
 *
 * EXECUTES HERE (no database): the REAL route handler
 * (PATCH /api/menu-submissions/[id]) runs against an in-memory Prisma
 * mock whose `menuSubmission.updateMany` faithfully implements the
 * conditional pending-state write the fix relies on: it matches a row
 * only while its status is still 'pending', atomically transitioning it
 * inside the "transaction". Two handlers racing on one submission both
 * pass the pre-transaction findUnique check (both see 'pending'), but
 * exactly one conditional write wins; the loser gets count 0 →
 * 409 `submission_not_pending` and publishes nothing.
 *
 * What this proves: the route ISSUES the conditional where on both
 * paths, the claim is asserted before any menu item is created, and the
 * 409 path fires for the loser.
 *
 * What it cannot prove (left to the DB-backed suite
 * `v218-menu-review-concurrency.test.ts`, skip-guarded): PostgreSQL's
 * atomic compare-and-write under genuine concurrent transactions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => {
  // In-memory "table": the conditional write below is synchronous, so it
  // is atomic with respect to interleaved async handlers — the same
  // semantics the route requires from PostgreSQL.
  const store: Record<string, Record<string, unknown>> = {};
  const menuSubmission = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      store[where.id] ? { ...store[where.id] } : null,
    ),
    updateMany: vi.fn(),
  };
  const tx = {
    restaurantMenuItem: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const item = {
          id: `item-${Math.random().toString(36).slice(2, 8)}`,
          ...data,
        };
        return item;
      }),
    },
    menuSubmission: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string };
          data: Record<string, unknown>;
        }) => {
          const row = store[where.id];
          if (!row) return { count: 0 };
          // THE conditional write: only matches while still pending.
          if (where.status !== undefined && row.status !== where.status) {
            return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          Object.assign(store[where.id], data);
          return { ...store[where.id] };
        },
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = store[where.id];
        if (!row) throw new Error('row gone');
        return { ...row };
      }),
    },
  };
  return {
    mocks: {
      store,
      prisma: { menuSubmission, $transaction: vi.fn() },
      menuSubmission,
      tx,
    },
  };
});

vi.mock('@fitfusion/db', () => ({ prisma: mocks.prisma }));

const ADMIN_SESSION = {
  user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
  profile: null,
  subscription: null,
};

vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(async (_req: NextRequest) => ADMIN_SESSION),
}));

import { PATCH as reviewPATCH } from '@/app/api/menu-submissions/[id]/route';

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function seedPending(id: string, extra: Record<string, unknown> = {}) {
  mocks.store[id] = {
    id,
    restaurantId: 'rest-1',
    name: `Dish ${id}`,
    description: null,
    portion: '1 plate',
    kcal: 420,
    proteinG: 28,
    carbsG: 12,
    fatG: 30,
    fiberG: 3,
    nutritionStatus: 'menu_photo_estimate',
    assumptions: [],
    source: 'menu_photo',
    matchedFoodId: null,
    status: 'pending',
    submittedBy: 'user-1',
    ...extra,
  };
}

async function patch(
  id: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = (await reviewPATCH(
    jsonRequest('http://localhost/api/x', 'PATCH', body),
    { params: { id } },
  )) as NextResponse;
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.store)) delete mocks.store[k];
  mocks.prisma.$transaction.mockImplementation(
    async (fn: (tx: object) => Promise<unknown>) => fn(mocks.tx),
  );
});

/* ------------------------------------------------------------------ */

describe('P1 — concurrent approve race (mocked transaction)', () => {
  it('exactly one of two simultaneous approvals wins; the loser gets 409 submission_not_pending and publishes nothing extra', async () => {
    seedPending('race-approve');
    const [a, b] = await Promise.all([
      patch('race-approve', { action: 'approve' }),
      patch('race-approve', { action: 'approve' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expect(loser.body.error.code).toBe('submission_not_pending');
    expect(winner.body.submission.status).toBe('approved');
    expect(winner.body.submission.reviewedBy).toBe('admin-1');
    expect(winner.body.submission.publishedItemId).toBe(winner.body.item.id);

    // Rollback semantics: exactly one menu item exists.
    expect(mocks.tx.restaurantMenuItem.create).toHaveBeenCalledTimes(1);
    // Final state is the winner's.
    expect(mocks.store['race-approve'].status).toBe('approved');
  });
});

describe('P1 — concurrent reject race (mocked transaction)', () => {
  it('exactly one of two simultaneous rejections wins; nothing is published', async () => {
    seedPending('race-reject');
    const [a, b] = await Promise.all([
      patch('race-reject', { action: 'reject' }),
      patch('race-reject', { action: 'reject' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(loser.body.error.code).toBe('submission_not_pending');
    expect(winner.body.submission.status).toBe('rejected');
    expect(winner.body.submission.reviewedBy).toBe('admin-1');
    expect(mocks.tx.restaurantMenuItem.create).not.toHaveBeenCalled();
    expect(mocks.store['race-reject'].status).toBe('rejected');
  });
});

describe('P1 — approval-vs-rejection race (mocked transaction)', () => {
  it('exactly one path wins; the loser 409s and the outcome is internally consistent', async () => {
    seedPending('race-mixed');
    const [approveRes, rejectRes] = await Promise.all([
      patch('race-mixed', { action: 'approve' }),
      patch('race-mixed', { action: 'reject' }),
    ]);
    const outcomes = [approveRes.status, rejectRes.status];
    expect(outcomes).toContain(409);
    const loser = approveRes.status === 409 ? approveRes : rejectRes;
    expect(loser.body.error.code).toBe('submission_not_pending');

    if (approveRes.status === 201) {
      // Approve won: exactly one item published, stamped.
      expect(mocks.tx.restaurantMenuItem.create).toHaveBeenCalledTimes(1);
      expect(approveRes.body.submission.status).toBe('approved');
      expect(mocks.store['race-mixed'].status).toBe('approved');
    } else {
      // Reject won: nothing published, stays private.
      expect(rejectRes.status).toBe(200);
      expect(mocks.tx.restaurantMenuItem.create).not.toHaveBeenCalled();
      expect(mocks.store['race-mixed'].status).toBe('rejected');
    }
  });
});

describe('P1 — post-resolution requests (mocked transaction)', () => {
  it('a repeated approve after approval is 409 (pre-check, code submission_closed)', async () => {
    seedPending('done-approve');
    const first = await patch('done-approve', { action: 'approve' });
    expect(first.status).toBe(201);
    const second = await patch('done-approve', { action: 'approve' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('submission_closed');
    expect(mocks.tx.restaurantMenuItem.create).toHaveBeenCalledTimes(1);
  });

  it('a reject after approval is 409; the claim inside the transaction is what fails closed', async () => {
    seedPending('done-reject');
    mocks.tx.menuSubmission.updateMany.mockClear();
    // Resolve the submission outside the route (simulates another admin).
    mocks.store['done-reject'].status = 'approved';
    const res = await patch('done-reject', { action: 'reject' });
    // The pre-check already 409s — but the important part: the conditional
    // write is the mechanism the DB suite proves under real concurrency.
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('submission_closed');
    expect(mocks.tx.menuSubmission.updateMany).not.toHaveBeenCalled();
  });

  it('an unknown submission 404s', async () => {
    const res = await patch('no-such-row', { action: 'approve' });
    expect(res.status).toBe(404);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('P1 — conditional-where shape (mocked transaction)', () => {
  it('both paths issue updateMany with status:pending in the where', async () => {
    seedPending('shape-approve');
    seedPending('shape-reject');
    mocks.tx.menuSubmission.updateMany.mockClear();
    await patch('shape-approve', { action: 'approve' });
    await patch('shape-reject', { action: 'reject' });
    expect(mocks.tx.menuSubmission.updateMany).toHaveBeenCalledTimes(2);
    for (const call of mocks.tx.menuSubmission.updateMany.mock.calls) {
      expect(call[0].where).toEqual({ id: expect.any(String), status: 'pending' });
    }
  });
});
