/**
 * Phase D — Restaurant Menus.
 * - estimateFromRecipe math (oil assumption, ranges, portion scaling)
 * - admin gate (non-admin blocked, ADMIN_EMAILS allowlist)
 * - honesty invariants (kcal present <=> status != 'unavailable')
 * - correction flow (open -> accept with updates / reject, no double-resolve)
 * - extract -> confirm never invents (unmatched -> 'unavailable', kcal null)
 * - diary logging of menu items via the existing POST /api/diary
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
import {
  GET as itemCorrectionsGET,
  POST as itemCorrectionsPOST,
} from '@/app/api/menu-items/[id]/corrections/route';
import { GET as correctionsQueueGET } from '@/app/api/corrections/route';
import { PATCH as correctionResolvePATCH } from '@/app/api/corrections/[id]/route';
import { POST as extractPOST } from '@/app/api/menus/extract/route';
import { POST as confirmPOST } from '@/app/api/menus/confirm/route';
import { POST as diaryPOST, GET as diaryGET } from '@/app/api/diary/route';
import { estimateFromRecipe } from '@/lib/menu-estimate';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

/* ------------------------------------------------------------------ */
/* pure helper                                                         */
/* ------------------------------------------------------------------ */

describe('estimateFromRecipe', () => {
  it('sums ingredients and adds explicit frying oil with an assumption', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: 'chicken breast', grams: 200, kcalPer100g: 165, proteinPer100g: 31 },
      ],
      portionGrams: 200,
      cookingMethod: 'fried',
      oilGrams: 10,
    });
    // 200g * 165/100 = 330 + 10g oil * 884/100 = 88.4
    expect(est.kcalBest).toBeCloseTo(418.4, 1);
    expect(est.proteinG).toBeCloseTo(62, 1);
    expect(est.assumptions.some((a) => a.includes('10 g absorbed cooking oil'))).toBe(true);
    // baseline spread ±15%
    expect(est.kcalLow).toBeCloseTo(418.4 * 0.85, 1);
    expect(est.kcalHigh).toBeCloseTo(418.4 * 1.15, 1);
  });

  it('widens the range and records an assumption when frying with unquantified oil', () => {
    const est = estimateFromRecipe({
      ingredients: [{ name: 'potato', grams: 150, kcalPer100g: 77 }],
      portionGrams: 150,
      cookingMethod: 'deep fried',
    });
    expect(est.kcalBest).toBeCloseTo(115.5, 1);
    expect(est.assumptions.some((a) => a.includes('no quantified oil'))).toBe(true);
    expect(est.kcalLow).toBeCloseTo(115.5 * 0.8, 1);
    expect(est.kcalHigh).toBeCloseTo(115.5 * 1.2, 1);
  });

  it('scales totals to the stated portion weight and notes it', () => {
    const est = estimateFromRecipe({
      ingredients: [{ name: 'rice', grams: 100, kcalPer100g: 130 }],
      portionGrams: 250,
      cookingMethod: 'steamed',
    });
    expect(est.kcalBest).toBeCloseTo(325, 1);
    expect(est.assumptions.some((a) => a.includes('Scaled by 2.50'))).toBe(true);
  });

  it('ignores empty ingredient rows and always lists sauce/seasoning caveat', () => {
    const est = estimateFromRecipe({
      ingredients: [
        { name: '', grams: 0, kcalPer100g: 0 },
        { name: 'lentils', grams: 80, kcalPer100g: 116 },
      ],
      portionGrams: 80,
    });
    expect(est.kcalBest).toBeCloseTo(92.8, 1);
    expect(est.assumptions.some((a) => a.includes('1 listed ingredient'))).toBe(true);
    expect(
      est.assumptions.some((a) => a.includes('Sauces, garnishes, and seasoning not itemized')),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* API fixtures                                                        */
/* ------------------------------------------------------------------ */

let userToken = '';
let adminToken = '';
let restaurantId = '';
const createdFoodIds: string[] = [];
let createdMenuItemIds: string[] = [];

beforeAll(async () => {
  const userEmail = uniqueEmail('ff-menu-user');
  const adminEmail = uniqueEmail('ff-menu-admin');
  process.env.ADMIN_EMAILS = adminEmail;

  const user = await registerAndLogin(registerPOST, loginPOST, userEmail);
  const admin = await registerAndLogin(registerPOST, loginPOST, adminEmail);
  userToken = user.token;
  adminToken = admin.token;

  const restaurant = await prisma.restaurant.create({
    data: { provider: 'manual', name: 'Test Biryani House', city: 'Lahore' },
  });
  restaurantId = restaurant.id;

  const food = await prisma.food.create({
    data: {
      name: `Test Chicken Karahi ${Date.now()}`,
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
  createdFoodIds.push(food.id);
});

afterAll(async () => {
  for (const id of createdMenuItemIds) {
    await prisma.restaurantMenuItem.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdFoodIds) {
    await prisma.food.delete({ where: { id } }).catch(() => {});
  }
  if (restaurantId) {
    await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => {});
  }
  delete process.env.ADMIN_EMAILS;
  await cleanupUsers();
});

function menuParams() {
  return { params: { id: restaurantId } };
}

/* ------------------------------------------------------------------ */
/* menu read + admin gate + honesty                                    */
/* ------------------------------------------------------------------ */

describe('GET /api/restaurants/[id]/menu', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await menuGET(new NextRequest('http://localhost/api/x'), menuParams());
    expect(res.status).toBe(401);
  });

  it('returns the restaurant with its items', async () => {
    const res = await menuGET(
      authed(new NextRequest('http://localhost/api/x'), userToken),
      menuParams(),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.restaurant.name).toBe('Test Biryani House');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('404s for an unknown restaurant', async () => {
    const res = await menuGET(
      authed(new NextRequest('http://localhost/api/x'), userToken),
      { params: { id: 'nope-not-real' } },
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/restaurants/[id]/menu (admin)', () => {
  it('blocks non-admin users with 403', async () => {
    const res = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name: 'Sneaky Item',
          kcal: 100,
          nutritionStatus: 'user_submitted',
        }),
        userToken,
      ),
      menuParams(),
    );
    expect(res.status).toBe(403);
  });

  it('rejects kcal paired with status "unavailable"', async () => {
    const res = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name: 'Dish',
          kcal: 500,
          nutritionStatus: 'unavailable',
        }),
        adminToken,
      ),
      menuParams(),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.message).toMatch(/unavailable/);
  });

  it('rejects a non-unavailable status without kcal', async () => {
    const res = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name: 'Dish',
          nutritionStatus: 'calculated_estimate',
        }),
        adminToken,
      ),
      menuParams(),
    );
    expect(res.status).toBe(400);
  });

  it('creates a restaurant_published item as admin', async () => {
    const res = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name: 'Chicken Biryani',
          description: 'Classic Karachi-style',
          portion: '1 plate',
          kcal: 720,
          proteinG: 32,
          carbsG: 80,
          fatG: 28,
          fiberG: 4,
          nutritionStatus: 'restaurant_published',
          assumptions: [],
          source: 'restaurant website',
        }),
        adminToken,
      ),
      menuParams(),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.item.name).toBe('Chicken Biryani');
    expect(body.item.kcal).toBe(720);
    expect(body.item.nutritionStatus).toBe('restaurant_published');
    createdMenuItemIds.push(body.item.id);
  });

  it('creates an "unavailable" item with no kcal', async () => {
    const res = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name: 'Mystery Dessert',
          nutritionStatus: 'unavailable',
        }),
        adminToken,
      ),
      menuParams(),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.item.kcal).toBeNull();
    createdMenuItemIds.push(body.item.id);
  });
});

describe('PATCH /api/menu-items/[id] (admin)', () => {
  let itemId = '';

  it('creates a target item first', async () => {
    const res = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name: 'Daal Fry',
          kcal: 380,
          nutritionStatus: 'user_submitted',
        }),
        adminToken,
      ),
      menuParams(),
    );
    expect(res.status).toBe(201);
    itemId = (await readJson(res)).item.id;
    createdMenuItemIds.push(itemId);
  });

  it('blocks non-admin updates with 403', async () => {
    const res = await itemPATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { kcal: 1 }), userToken),
      { params: { id: itemId } },
    );
    expect(res.status).toBe(403);
  });

  it('rejects a patch that would break the honesty invariant', async () => {
    const res = await itemPATCH(
      authed(
        jsonRequest('http://localhost/api/x', 'PATCH', { nutritionStatus: 'unavailable' }),
        adminToken,
      ),
      { params: { id: itemId } },
    );
    expect(res.status).toBe(400);
  });

  it('updates fields and stamps lastVerifiedAt when verify:true', async () => {
    const res = await itemPATCH(
      authed(
        jsonRequest('http://localhost/api/x', 'PATCH', {
          kcal: 400,
          nutritionStatus: 'calculated_estimate',
          verify: true,
        }),
        adminToken,
      ),
      { params: { id: itemId } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.item.kcal).toBe(400);
    expect(body.item.nutritionStatus).toBe('calculated_estimate');
    expect(body.item.lastVerifiedAt).toBeTruthy();
  });

  it('404s for an unknown item', async () => {
    const res = await itemPATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { verify: true }), adminToken),
      { params: { id: 'nope' } },
    );
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/* corrections                                                         */
/* ------------------------------------------------------------------ */

describe('menu corrections', () => {
  let itemId = '';
  let correctionId = '';

  it('creates a target menu item', async () => {
    const res = await menuPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          name: 'Seekh Kebab',
          kcal: 300,
          nutritionStatus: 'user_submitted',
        }),
        adminToken,
      ),
      menuParams(),
    );
    itemId = (await readJson(res)).item.id;
    createdMenuItemIds.push(itemId);
  });

  it('any user can flag an item (status open)', async () => {
    const res = await itemCorrectionsPOST(
      authed(
        jsonRequest('http://localhost/api/x', 'POST', {
          note: 'This looks way too low for 4 kebabs with naan.',
        }),
        userToken,
      ),
      { params: { id: itemId } },
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.correction.status).toBe('open');
    correctionId = body.correction.id;
  });

  it('admin queue lists the open correction', async () => {
    const res = await correctionsQueueGET(
      authed(new NextRequest('http://localhost/api/corrections?status=open'), adminToken),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const found = body.corrections.find((c: { id: string }) => c.id === correctionId);
    expect(found).toBeTruthy();
    expect(found.menuItem.restaurant.name).toBe('Test Biryani House');
  });

  it('non-admins cannot read the queue', async () => {
    const res = await correctionsQueueGET(
      authed(new NextRequest('http://localhost/api/corrections?status=open'), userToken),
    );
    expect(res.status).toBe(403);
  });

  it('non-admins cannot read per-item corrections', async () => {
    const res = await itemCorrectionsGET(
      authed(new NextRequest('http://localhost/api/x'), userToken),
      { params: { id: itemId } },
    );
    expect(res.status).toBe(403);
  });

  it('accepting with updates corrects the item and stamps verification', async () => {
    const res = await correctionResolvePATCH(
      authed(
        jsonRequest('http://localhost/api/x', 'PATCH', {
          status: 'accepted',
          updates: { kcal: 520, nutritionStatus: 'calculated_estimate' },
        }),
        adminToken,
      ),
      { params: { id: correctionId } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.correction.status).toBe('accepted');
    expect(body.item.kcal).toBe(520);
    expect(body.item.nutritionStatus).toBe('calculated_estimate');
    expect(body.item.lastVerifiedAt).toBeTruthy();
  });

  it('resolving twice is rejected with 409', async () => {
    const res = await correctionResolvePATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { status: 'rejected' }), adminToken),
      { params: { id: correctionId } },
    );
    expect(res.status).toBe(409);
  });

  it('a second correction can be rejected without touching the item', async () => {
    const created = await itemCorrectionsPOST(
      authed(jsonRequest('http://localhost/api/x', 'POST', { note: 'Actually this seems fine.' }), userToken),
      { params: { id: itemId } },
    );
    const secondId = (await readJson(created)).correction.id;
    const res = await correctionResolvePATCH(
      authed(jsonRequest('http://localhost/api/x', 'PATCH', { status: 'rejected' }), adminToken),
      { params: { id: secondId } },
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).correction.status).toBe('rejected');
  });
});

/* ------------------------------------------------------------------ */
/* extract -> confirm: never invents                                   */
/* ------------------------------------------------------------------ */

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('menu extract -> confirm', () => {
  it('extract without AI keys degrades honestly (no fabricated items)', async () => {
    const form = new FormData();
    form.append('image', new File([TINY_PNG], 'menu.png', { type: 'image/png' }));
    const res = await extractPOST(
      authed(new NextRequest('http://localhost/api/menus/extract', { method: 'POST', body: form }), userToken),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.aiConfigured).toBe(false);
    expect(body.extracted).toEqual([]);
  });

  it('rejects non-image uploads with 415', async () => {
    const form = new FormData();
    form.append('image', new File(['x'], 'menu.txt', { type: 'text/plain' }));
    const res = await extractPOST(
      authed(new NextRequest('http://localhost/api/menus/extract', { method: 'POST', body: form }), userToken),
    );
    expect(res.status).toBe(415);
  });

  it('unmatched items are saved as unavailable with NO guessed kcal', async () => {
    const res = await confirmPOST(
      authed(
        jsonRequest('http://localhost/api/menus/confirm', 'POST', {
          restaurantId,
          items: [{ name: 'Chef Special Platter', portion: '1 plate' }],
        }),
        userToken,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.nutritionStatus).toBe('unavailable');
    expect(item.kcal).toBeNull();
    expect(item.source).toBe('menu_photo');
    createdMenuItemIds.push(item.id);
  });

  it('matched items inherit the food record numbers as a photo estimate', async () => {
    const res = await confirmPOST(
      authed(
        jsonRequest('http://localhost/api/menus/confirm', 'POST', {
          restaurantId,
          items: [{ name: 'Chicken Karahi', matchedFoodId: createdFoodIds[0] }],
        }),
        userToken,
      ),
    );
    expect(res.status).toBe(201);
    const item = (await readJson(res)).items[0];
    expect(item.nutritionStatus).toBe('menu_photo_estimate');
    expect(item.kcal).toBe(420);
    expect(item.proteinG).toBe(28);
    const assumptions: string[] = Array.isArray(item.assumptions) ? item.assumptions : [];
    expect(assumptions.some((a) => a.includes('Matched by the user'))).toBe(true);
    createdMenuItemIds.push(item.id);
  });

  it('rejects unknown restaurant and unknown matched food', async () => {
    const badRestaurant = await confirmPOST(
      authed(
        jsonRequest('http://localhost/api/menus/confirm', 'POST', {
          restaurantId: 'nope',
          items: [{ name: 'X' }],
        }),
        userToken,
      ),
    );
    expect(badRestaurant.status).toBe(404);

    const badFood = await confirmPOST(
      authed(
        jsonRequest('http://localhost/api/menus/confirm', 'POST', {
          restaurantId,
          items: [{ name: 'X', matchedFoodId: 'nope' }],
        }),
        userToken,
      ),
    );
    expect(badFood.status).toBe(404);
  });

  it('rejects an empty item list', async () => {
    const res = await confirmPOST(
      authed(
        jsonRequest('http://localhost/api/menus/confirm', 'POST', { restaurantId, items: [] }),
        userToken,
      ),
    );
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* diary logging of menu items                                         */
/* ------------------------------------------------------------------ */

describe('diary logging of menu items', () => {
  it('logs a menu item with known kcal via the existing diary API', async () => {
    const date = '2026-10-12';
    const res = await diaryPOST(
      authed(
        jsonRequest('http://localhost/api/diary', 'POST', {
          date,
          mealType: 'dinner',
          customName: 'Chicken Biryani — Test Biryani House',
          kcal: 720,
          proteinG: 32,
          carbsG: 80,
          fatG: 28,
          fiberG: 4,
          servings: 1,
        }),
        userToken,
      ),
    );
    expect(res.status).toBe(201);
    const entry = (await readJson(res)).entry;
    expect(entry.kcal).toBe(720);
    expect(entry.customName).toContain('Test Biryani House');

    const got = await diaryGET(
      authed(new NextRequest(`http://localhost/api/diary?date=${date}`), userToken),
    );
    expect(got.status).toBe(200);
    const totals = (await readJson(got)).totals;
    expect(totals.kcal).toBeGreaterThanOrEqual(720);
  });
});
