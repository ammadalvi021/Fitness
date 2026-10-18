/**
 * v21.8 — Restaurant menu integrity (P2 + P5).
 *
 * P2: POST /api/menus/confirm stores PRIVATE pending submissions; they never
 * reach the public GET /api/restaurants/[id]/menu until an admin approves
 * them via PATCH /api/menu-submissions/[id] (transactional publish).
 *
 * P5: PATCH /api/menu-items/[id] clears lastVerifiedAt on material edits
 * unless the same request explicitly re-verifies (verify:true).
 *
 * DB-backed — skipped gracefully when no PostgreSQL is reachable.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import {
  GET as menuGET,
  POST as menuPOST,
} from '@/app/api/restaurants/[id]/menu/route';
import { PATCH as itemPATCH } from '@/app/api/menu-items/[id]/route';
import { POST as confirmPOST } from '@/app/api/menus/confirm/route';
import { GET as submissionsGET } from '@/app/api/menu-submissions/route';
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

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

let userToken = '';
let adminToken = '';
let restaurantId = '';
let foodId = '';
const createdSubmissionIds: string[] = [];
const createdMenuItemIds: string[] = [];

beforeAll(async () => {
  if (!HAS_DB) return;
  const userEmail = uniqueEmail('ff-v218-user');
  const adminEmail = uniqueEmail('ff-v218-admin');
  process.env.ADMIN_EMAILS = adminEmail;

  const user = await registerAndLogin(registerPOST, loginPOST, userEmail);
  const admin = await registerAndLogin(registerPOST, loginPOST, adminEmail);
  userToken = user.token;
  adminToken = admin.token;

  const restaurant = await prisma.restaurant.create({
    data: { provider: 'manual', name: 'V218 Test Kitchen', city: 'Lahore' },
  });
  restaurantId = restaurant.id;

  const food = await prisma.food.create({
    data: {
      name: `V218 Test Food ${Date.now()}`,
      servingSize: 250,
      servingUnit: 'g',
      kcal: 420,
      proteinG: 28,
      carbsG: 12,
      fatG: 30,
      fiberG: 3,
      source: 'test',
    },
  });
  foodId = food.id;
});

afterAll(async () => {
  if (!HAS_DB) return;
  for (const id of createdSubmissionIds) {
    await prisma.menuSubmission.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdMenuItemIds) {
    await prisma.restaurantMenuItem.delete({ where: { id } }).catch(() => {});
  }
  if (foodId) await prisma.food.delete({ where: { id: foodId } }).catch(() => {});
  if (restaurantId) await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => {});
  delete process.env.ADMIN_EMAILS;
  await cleanupUsers();
});

function menuParams() {
  return { params: { id: restaurantId } };
}

async function publicItemNames(): Promise<string[]> {
  const res = await menuGET(
    authed(new NextRequest('http://localhost/api/x'), userToken),
    menuParams(),
  );
  expect(res.status).toBe(200);
  const body = await readJson(res);
  return (body.items as { name: string }[]).map((i) => i.name);
}

/* ------------------------------------------------------------------ */
/* P2: submission vs publication                                       */
/* ------------------------------------------------------------------ */

describe.skipIf(!HAS_DB)('P2 — customer confirm creates private submissions', () => {
  it('an ordinary user confirm returns 201 with pending submissions', async () => {
    const res = await confirmPOST(
      authed(
        jsonRequest('http://localhost/api/menus/confirm', 'POST', {
          restaurantId,
          items: [
            { name: 'V218 Pending Platter', portion: '1 plate' },
            { name: 'V218 Pending Karahi', matchedFoodId: foodId },
          ],
        }),
        userToken,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.items).toHaveLength(2);
    for (const sub of body.items) {
      expect(sub.status).toBe('pending');
      expect(sub.source).toBe('menu_photo');
      createdSubmissionIds.push(sub.id);
    }
    // unmatched -> unavailable with no guessed numbers
    expect(body.items[0].nutritionStatus).toBe('unavailable');
    expect(body.items[0].kcal).toBeNull();
    // matched -> photo estimate from the food record
    expect(body.items[1].nutritionStatus).toBe('menu_photo_estimate');
    expect(body.items[1].kcal).toBe(420);
  });

  it('an ordinary user cannot publish shared menu items', async () => {
    const count = await prisma.restaurantMenuItem.count({ where: { restaurantId } });
    expect(count).toBe(0);
  });

  it('pending submissions are invisible to the public menu GET', async () => {
    const names = await publicItemNames();
    expect(names).not.toContain('V218 Pending Platter');
    expect(names).not.toContain('V218 Pending Karahi');
  });

  it('non-admins cannot read the submission queue', async () => {
    const res = await submissionsGET(
      authed(new NextRequest('http://localhost/api/menu-submissions?status=pending'), userToken),
    );
    expect(res.status).toBe(403);
  });

  it('non-admins cannot review submissions', async () => {
    const res = await submissionReviewPATCH(
      authed(
        jsonRequest('http://localhost/api/x', 'PATCH', { action: 'approve' }),
        userToken,
      ),
      { params: { id: createdSubmissionIds[0] } },
    );
    expect(res.status).toBe(403);
  });

  it('admin queue lists the pending submissions with submitter info', async () => {
    const res = await submissionsGET(
      authed(new NextRequest('http://localhost/api/menu-submissions?status=pending'), adminToken),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const ids = (body.submissions as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(createdSubmissionIds[0]);
    const first = body.submissions.find((s: { id: string }) => s.id === createdSubmissionIds[0]);
    expect(first.submitter.email).toContain('ff-v218-user');
    expect(first.restaurant.name).toBe('V218 Test Kitchen');
  });

  it('approving publishes the item (transactionally) and it becomes public', async () => {
    const res = await submissionReviewPATCH(
      authed(
        jsonRequest('http://localhost/api/x', 'PATCH', {
          action: 'approve',
          reviewNote: 'Looks right.',
        }),
        adminToken,
      ),
      { params: { id: createdSubmissionIds[1] } },
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.submission.status).toBe('approved');
    expect(body.submission.reviewedBy).toBeTruthy();
    expect(body.submission.reviewedAt).toBeTruthy();
    expect(body.submission.publishedItemId).toBe(body.item.id);
    expect(body.item.name).toBe('V218 Pending Karahi');
    expect(body.item.kcal).toBe(420);
    expect(body.item.nutritionStatus).toBe('menu_photo_estimate');
    createdMenuItemIds.push(body.item.id);

    const names = await publicItemNames();
    expect(names).toContain('V218 Pending Karahi');
    expect(names).not.toContain('V218 Pending Platter');
  });

  it('re-reviewing an approved submission is rejected with 409', async () => {
    const res = await submissionReviewPATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { action: 'reject' }), adminToken),
      { params: { id: createdSubmissionIds[1] } },
    );
    expect(res.status).toBe(409);
  });

  it('rejecting keeps the submission private forever', async () => {
    const res = await submissionReviewPATCH(
      authed(
        jsonRequest('http://localhost/api/x', 'PATCH', {
          action: 'reject',
          reviewNote: 'Not a real dish.',
        }),
        adminToken,
      ),
      { params: { id: createdSubmissionIds[0] } },
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).submission.status).toBe('rejected');

    const names = await publicItemNames();
    expect(names).not.toContain('V218 Pending Platter');
  });

  it('a failed batch leaves no partial submissions', async () => {
    const before = await prisma.menuSubmission.count({ where: { restaurantId } });
    const res = await confirmPOST(
      authed(
        jsonRequest('http://localhost/api/menus/confirm', 'POST', {
          restaurantId,
          items: [
            { name: 'V218 Doomed Dish' },
            { name: 'V218 Bad Match', matchedFoodId: 'nope-not-real' },
          ],
        }),
        userToken,
      ),
    );
    expect(res.status).toBe(404);
    const after = await prisma.menuSubmission.count({ where: { restaurantId } });
    expect(after).toBe(before);
    const names = await publicItemNames();
    expect(names).not.toContain('V218 Doomed Dish');
  });

  it('reviewing an unknown submission 404s', async () => {
    const res = await submissionReviewPATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { action: 'approve' }), adminToken),
      { params: { id: 'nope-not-real' } },
    );
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/* P5: verification invalidation on edit                               */
/* ------------------------------------------------------------------ */

describe.skipIf(!HAS_DB)('P5 — material edits invalidate verification', () => {
  async function makeVerifiedItem(name: string): Promise<string> {
    const created = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name,
          portion: '1 plate',
          kcal: 500,
          proteinG: 20,
          carbsG: 60,
          fatG: 18,
          fiberG: 3,
          nutritionStatus: 'calculated_estimate',
          source: 'restaurant website',
        }),
        adminToken,
      ),
      menuParams(),
    );
    expect(created.status).toBe(201);
    const id = (await readJson(created)).item.id;
    createdMenuItemIds.push(id);
    const verified = await itemPATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { verify: true }), adminToken),
      { params: { id } },
    );
    expect(verified.status).toBe(200);
    expect((await readJson(verified)).item.lastVerifiedAt).toBeTruthy();
    return id;
  }

  async function patchItem(id: string, body: unknown) {
    const res = await itemPATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', body), adminToken),
      { params: { id } },
    );
    return { status: res.status, item: (await readJson(res)).item as { lastVerifiedAt: string | null } };
  }

  it.each([
    ['name', { name: 'V218 Renamed Dish' }],
    ['portion', { portion: '2 plates' }],
    ['kcal', { kcal: 501 }],
    ['proteinG', { proteinG: 21 }],
    ['carbsG', { carbsG: 61 }],
    ['fatG', { fatG: 19 }],
    ['fiberG', { fiberG: 4 }],
    ['source', { source: 'menu photo' }],
    ['nutritionStatus', { nutritionStatus: 'restaurant_published' }],
  ])('edit to %s clears lastVerifiedAt', async (_field, patch) => {
    const id = await makeVerifiedItem(`V218 Clear ${_field} ${Date.now()}`);
    const { status, item } = await patchItem(id, patch);
    expect(status).toBe(200);
    expect(item.lastVerifiedAt).toBeNull();
  });

  it('a non-material edit (description) preserves verification', async () => {
    const id = await makeVerifiedItem(`V218 Keep ${Date.now()}`);
    const { status, item } = await patchItem(id, { description: 'New editorial blurb' });
    expect(status).toBe(200);
    expect(item.lastVerifiedAt).toBeTruthy();
  });

  it('a no-op patch (same values) preserves verification', async () => {
    const id = await makeVerifiedItem(`V218 Noop ${Date.now()}`);
    const { status, item } = await patchItem(id, { kcal: 500, portion: '1 plate' });
    expect(status).toBe(200);
    expect(item.lastVerifiedAt).toBeTruthy();
  });

  it('material change + verify:true in the same request re-establishes verification', async () => {
    const id = await makeVerifiedItem(`V218 Reverify ${Date.now()}`);
    const before = (await prisma.restaurantMenuItem.findUnique({ where: { id } }))!.lastVerifiedAt!;
    const { status, item } = await patchItem(id, { kcal: 550, verify: true });
    expect(status).toBe(200);
    expect(item.lastVerifiedAt).toBeTruthy();
    expect(new Date(item.lastVerifiedAt!).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('verify:true on an item with unavailable nutrition is rejected', async () => {
    const created = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name: `V218 Unavail ${Date.now()}`,
          nutritionStatus: 'unavailable',
        }),
        adminToken,
      ),
      menuParams(),
    );
    expect(created.status).toBe(201);
    const id = (await readJson(created)).item.id;
    createdMenuItemIds.push(id);

    const res = await itemPATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { verify: true }), adminToken),
      { params: { id } },
    );
    expect(res.status).toBe(400);
  });

  it('the honesty invariant still holds on PATCH', async () => {
    const id = await makeVerifiedItem(`V218 Honest ${Date.now()}`);
    const res = await itemPATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { nutritionStatus: 'unavailable' }), adminToken),
      { params: { id } },
    );
    expect(res.status).toBe(400);
  });
});
