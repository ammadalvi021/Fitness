/**
 * v21.8 — mocked route-logic tests (P1 + P2 + P5). No database required.
 *
 * These tests mock the Prisma client and the auth gates to verify the
 * ROUTE LOGIC directly:
 *  - P1: PATCH /api/menu-submissions/[id] claims the submission with a
 *    CONDITIONAL pending-state write inside the transaction (updateMany
 *    with status:'pending') — for BOTH approve and reject — and the claim
 *    is asserted before any menu item is created.
 *  - P2: POST /api/menus/confirm writes pending MenuSubmission rows inside
 *    one transaction and never calls restaurantMenuItem.create.
 *  - P2: PATCH /api/menu-submissions/[id] approve publishes inside a
 *    transaction (interactive $transaction) and stamps the review.
 *  - P5: PATCH /api/menu-items/[id] clears lastVerifiedAt on material
 *    edits, preserves it on non-material edits, and re-stamps on verify:true.
 */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => {
  const restaurantMenuItem = {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const menuSubmission = {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const restaurant = { findUnique: vi.fn() };
  const food = { findUnique: vi.fn() };
  return {
    mocks: {
      prisma: {
        restaurantMenuItem,
        menuSubmission,
        restaurant,
        food,
        $transaction: vi.fn(),
      },
      restaurantMenuItem,
      menuSubmission,
      restaurant,
      food,
    },
  };
});

vi.mock('@fitfusion/db', () => ({ prisma: mocks.prisma }));

const USER_SESSION = {
  user: { id: 'user-1', email: 'user@example.com', name: 'User' },
  profile: null,
  subscription: null,
};
const ADMIN_SESSION = {
  user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
  profile: null,
  subscription: null,
};

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => USER_SESSION),
}));
vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(async (req: NextRequest) => ADMIN_SESSION),
}));

import { POST as confirmPOST } from '@/app/api/menus/confirm/route';
import { PATCH as submissionReviewPATCH } from '@/app/api/menu-submissions/[id]/route';
import { PATCH as itemPATCH } from '@/app/api/menu-items/[id]/route';

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson(res: NextResponse): Promise<any> {
  return res.json();
}

const FOOD = {
  id: 'food-1',
  name: 'Chicken Karahi',
  servingSize: 250,
  servingUnit: 'g',
  kcal: 420,
  proteinG: 28,
  carbsG: 12,
  fatG: 30,
  fiberG: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.restaurant.findUnique.mockResolvedValue({ id: 'rest-1' });
  mocks.food.findUnique.mockResolvedValue(FOOD);
  // Array-form transaction: resolve each create op in order.
  mocks.prisma.$transaction.mockImplementation(async (ops: unknown[]) => ops);
  mocks.menuSubmission.create.mockImplementation(async (args: { data: object }) => ({
    id: `sub-${Math.random().toString(36).slice(2)}`,
    ...args.data,
  }));
});

/* ------------------------------------------------------------------ */
/* P2 — confirm writes private submissions, never publishes            */
/* ------------------------------------------------------------------ */

describe('P2 — POST /api/menus/confirm (mocked)', () => {
  it('creates pending submissions for the submitting user inside one transaction', async () => {
    const res = await confirmPOST(
      jsonRequest('http://localhost/api/menus/confirm', 'POST', {
        restaurantId: 'rest-1',
        items: [
          { name: 'Platter', portion: '1 plate' },
          { name: 'Karahi', matchedFoodId: 'food-1' },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.items).toHaveLength(2);

    // One transaction with two creates — no partial menus possible.
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.menuSubmission.create).toHaveBeenCalledTimes(2);
    for (const call of mocks.menuSubmission.create.mock.calls) {
      const data = call[0].data;
      expect(data.status).toBe('pending');
      expect(data.submittedBy).toBe('user-1');
      expect(data.source).toBe('menu_photo');
      expect(data.restaurantId).toBe('rest-1');
    }
    // Ordinary users cannot publish shared menu items.
    expect(mocks.restaurantMenuItem.create).not.toHaveBeenCalled();
  });

  it('validates the full request before starting the transaction', async () => {
    mocks.food.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'food-1' ? FOOD : null,
    );
    const res = await confirmPOST(
      jsonRequest('http://localhost/api/menus/confirm', 'POST', {
        restaurantId: 'rest-1',
        items: [{ name: 'Good Dish' }, { name: 'Bad Match', matchedFoodId: 'missing' }],
      }),
    );
    expect(res.status).toBe(404);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.menuSubmission.create).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers', async () => {
    const { requireUser } = await import('@/lib/auth');
    vi.mocked(requireUser).mockResolvedValueOnce(
      NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 }),
    );
    const res = await confirmPOST(
      jsonRequest('http://localhost/api/menus/confirm', 'POST', {
        restaurantId: 'rest-1',
        items: [{ name: 'X' }],
      }),
    );
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* P2 + P1 — admin review publishes transactionally                     */
/* ------------------------------------------------------------------ */

describe('P2 — PATCH /api/menu-submissions/[id] (mocked)', () => {
  const SUBMISSION = {
    id: 'sub-1',
    restaurantId: 'rest-1',
    name: 'Karahi',
    description: null,
    portion: '1 plate',
    kcal: 420,
    proteinG: 28,
    carbsG: 12,
    fatG: 30,
    fiberG: 3,
    nutritionStatus: 'menu_photo_estimate',
    assumptions: ['Matched by the user to the food-database entry "Chicken Karahi"'],
    source: 'menu_photo',
    matchedFoodId: 'food-1',
    status: 'pending',
    submittedBy: 'user-1',
  };

  beforeEach(() => {
    mocks.menuSubmission.findUnique.mockResolvedValue(SUBMISSION);
  });

  // v21.8 P1: the pending→approved/rejected transition is a conditional
  // write asserted INSIDE the transaction — the mock tx implements it
  // faithfully: updateMany only matches rows still pending.
  function inMemoryStore(status: string) {
    const store: Record<string, Record<string, unknown>> = {
      'sub-1': { ...SUBMISSION, status },
    };
    const createdItems: Record<string, unknown>[] = [];
    const tx = {
      restaurantMenuItem: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          const item = { id: `item-${createdItems.length + 1}`, ...args.data };
          createdItems.push(item);
          return item;
        }),
      },
      menuSubmission: {
        updateMany: vi.fn(async (args: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
          const row = store[args.where.id];
          if (!row) return { count: 0 };
          if (args.where.status !== undefined && row.status !== args.where.status) {
            return { count: 0 };
          }
          Object.assign(row, args.data);
          return { count: 1 };
        }),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = store[args.where.id] ?? {};
          Object.assign(row, args.data);
          store[args.where.id] = row;
          return row;
        }),
        findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
          const row = store[args.where.id];
          if (!row) throw new Error('row gone');
          return row;
        }),
      },
    };
    mocks.prisma.$transaction.mockImplementation(async (fn: (tx: object) => Promise<unknown>) => fn(tx));
    return { store, createdItems, tx };
  }

  it('approve publishes the item and stamps the review in one transaction', async () => {
    const { tx } = inMemoryStore('pending');
    const res = await submissionReviewPATCH(
      jsonRequest('http://localhost/api/x', 'PATCH', { action: 'approve', reviewNote: 'ok' }),
      { params: { id: 'sub-1' } },
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.submission.status).toBe('approved');
    expect(body.submission.reviewedBy).toBe('admin-1');
    expect(body.submission.reviewedAt).toBeTruthy();
    expect(body.submission.publishedItemId).toBe(body.item.id);
    expect(body.item.id).toBe('item-1');
    // P1: the claim is the conditional pending-state write.
    expect(tx.menuSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1', status: 'pending' },
        data: expect.objectContaining({ status: 'approved', reviewedBy: 'admin-1' }),
      }),
    );
    // P1: the claim is asserted BEFORE the item is created.
    const updateManyOrder = (tx.menuSubmission.updateMany as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const createOrder = (tx.restaurantMenuItem.create as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(updateManyOrder).toBeLessThan(createOrder);
  });

  it('reject keeps the submission private (no published item)', async () => {
    const { tx, createdItems } = inMemoryStore('pending');
    const res = await submissionReviewPATCH(
      jsonRequest('http://localhost/api/x', 'PATCH', { action: 'reject' }),
      { params: { id: 'sub-1' } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.submission.status).toBe('rejected');
    expect(body.submission.reviewedBy).toBe('admin-1');
    // P1: reject also claims via the conditional pending-state write,
    // inside a transaction.
    expect(tx.menuSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1', status: 'pending' },
        data: expect.objectContaining({ status: 'rejected', reviewedBy: 'admin-1' }),
      }),
    );
    // Ordinary users cannot publish shared menu items.
    expect(createdItems).toHaveLength(0);
    expect(tx.restaurantMenuItem.create).not.toHaveBeenCalled();
    expect(mocks.menuSubmission.update).not.toHaveBeenCalled();
  });

  it('re-reviewing a closed submission is rejected with 409', async () => {
    mocks.menuSubmission.findUnique.mockResolvedValue({ ...SUBMISSION, status: 'approved' });
    const res = await submissionReviewPATCH(
      jsonRequest('http://localhost/api/x', 'PATCH', { action: 'approve' }),
      { params: { id: 'sub-1' } },
    );
    expect(res.status).toBe(409);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('non-admins are blocked with 403', async () => {
    const { requireAdmin } = await import('@/lib/admin');
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }),
    );
    const res = await submissionReviewPATCH(
      jsonRequest('http://localhost/api/x', 'PATCH', { action: 'approve' }),
      { params: { id: 'sub-1' } },
    );
    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------------------------ */
/* P5 — edits invalidate verification unless explicitly re-verified    */
/* ------------------------------------------------------------------ */

describe('P5 — PATCH /api/menu-items/[id] (mocked)', () => {
  const EXISTING = {
    id: 'item-1',
    restaurantId: 'rest-1',
    name: 'Biryani',
    description: null,
    portion: '1 plate',
    kcal: 720,
    proteinG: 32,
    carbsG: 80,
    fatG: 28,
    fiberG: 4,
    nutritionStatus: 'restaurant_published',
    assumptions: [],
    source: 'restaurant website',
    lastVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date(),
  };

  beforeEach(() => {
    mocks.restaurantMenuItem.findUnique.mockResolvedValue(EXISTING);
    mocks.restaurantMenuItem.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({ ...EXISTING, ...args.data }),
    );
  });

  async function patch(body: unknown) {
    const res = await itemPATCH(jsonRequest('http://localhost/api/x', 'PATCH', body), {
      params: { id: 'item-1' },
    });
    const item = (await readJson(res)).item;
    return { status: res.status, data: mocks.restaurantMenuItem.update.mock.calls[0]?.[0]?.data as
      Record<string, unknown> | undefined, item };
  }

  it.each([
    ['name', { name: 'Biryani (Large)' }],
    ['portion', { portion: '2 plates' }],
    ['kcal', { kcal: 721 }],
    ['proteinG', { proteinG: 33 }],
    ['source', { source: 'menu photo' }],
    ['nutritionStatus', { nutritionStatus: 'calculated_estimate' }],
  ])('material change to %s clears lastVerifiedAt', async (_f, body) => {
    const { status, data } = await patch(body);
    expect(status).toBe(200);
    expect(data).toMatchObject({ lastVerifiedAt: null });
  });

  it('non-material change (description) preserves lastVerifiedAt', async () => {
    const { status, data } = await patch({ description: 'New blurb' });
    expect(status).toBe(200);
    expect(data).not.toHaveProperty('lastVerifiedAt');
  });

  it('material change + verify:true re-establishes verification', async () => {
    const { status, data } = await patch({ kcal: 750, verify: true });
    expect(status).toBe(200);
    expect(data?.lastVerifiedAt).toBeInstanceOf(Date);
    expect((data?.lastVerifiedAt as Date).getTime()).toBeGreaterThan(
      EXISTING.lastVerifiedAt.getTime(),
    );
  });

  it('verify:true alone re-stamps verification', async () => {
    const { status, data } = await patch({ verify: true });
    expect(status).toBe(200);
    expect(data?.lastVerifiedAt).toBeInstanceOf(Date);
  });

  it('verify:true on an unavailable-nutrition item is rejected', async () => {
    mocks.restaurantMenuItem.findUnique.mockResolvedValue({
      ...EXISTING,
      kcal: null,
      nutritionStatus: 'unavailable',
      lastVerifiedAt: null,
    });
    const res = await itemPATCH(jsonRequest('http://localhost/api/x', 'PATCH', { verify: true }), {
      params: { id: 'item-1' },
    });
    expect(res.status).toBe(400);
    expect(mocks.restaurantMenuItem.update).not.toHaveBeenCalled();
  });
});
