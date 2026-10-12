/**
 * V18 foods API: alias search (en/ur/roman-ur), ranking, filters, pagination.
 * DB-backed — skipped gracefully when no PostgreSQL is reachable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as foodsGET } from '@/app/api/foods/route';
import { GET as categoriesGET } from '@/app/api/foods/categories/route';
import {
  authed,
  cleanupUsers,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

const RUN = `v18t${Date.now().toString(36)}`;

async function makeFood(data: {
  name: string;
  verification?: string;
  countryCodes?: string[];
  aliases?: { alias: string; language: string }[];
  categoryId?: string;
}) {
  const food = await prisma.food.create({
    data: {
      name: data.name,
      servingSize: 100,
      servingUnit: '100 g',
      kcal: 100,
      proteinG: 5,
      carbsG: 15,
      fatG: 3,
      fiberG: 2,
      source: 'seeded',
      verified: data.verification === 'verified',
      verification: data.verification ?? 'estimate',
      countryCodes: data.countryCodes ?? [],
      categoryId: data.categoryId ?? null,
    },
  });
  if (data.aliases?.length) {
    await prisma.foodAlias.createMany({
      data: data.aliases.map((a) => ({ foodId: food.id, ...a })),
    });
  }
  await prisma.householdPortion.create({
    data: { foodId: food.id, label: '100 g', grams: 100, sortOrder: 0 },
  });
  return food;
}

describe.skipIf(!HAS_DB)('V18 foods API', () => {
  let token = '';
  let catId = '';
  const foodIds: string[] = [];

  afterAll(async () => {
    for (const id of foodIds) {
      await prisma.food.delete({ where: { id } }).catch(() => {});
    }
    if (catId) await prisma.foodCategory.delete({ where: { id: catId } }).catch(() => {});
    await cleanupUsers();
  });

  it('sets up auth, a category, and test foods', async () => {
    const email = uniqueEmail('ff-v18foods');
    ({ token } = await registerAndLogin(registerPOST, loginPOST, email));
    const cat = await prisma.foodCategory.create({
      data: { name: `${RUN} Test Category`, nameUrdu: 'ٹیسٹ', sortOrder: 999 },
    });
    catId = cat.id;

    const f1 = await makeFood({ name: `${RUN} Roti`, categoryId: catId });
    const f2 = await makeFood({
      name: `${RUN} Something Else`,
      verification: 'verified',
      aliases: [{ alias: `${RUN} roti`, language: 'roman-ur' }],
    });
    const f3 = await makeFood({ name: `${RUN} Roti House` });
    const f4 = await makeFood({
      name: `${RUN} Zed`,
      verification: 'verified',
      countryCodes: ['PK'],
    });
    const f5 = await makeFood({ name: `${RUN} Aye`, countryCodes: ['PK'] });
    // Urdu-script alias on f1.
    await prisma.foodAlias.create({
      data: { foodId: f1.id, alias: 'روٹی', language: 'ur' },
    });
    foodIds.push(f1.id, f2.id, f3.id, f4.id, f5.id);
    (globalThis as any).__v18t = { f1: f1.id, f2: f2.id, f3: f3.id, f4: f4.id, f5: f5.id };
    expect(token).toBeTruthy();
  });

  function get(url: string) {
    return foodsGET(authed(new NextRequest(`http://localhost${url}`), token));
  }

  it('ranks exact name > alias match > name-contains', async () => {
    const { f1, f2, f3 } = (globalThis as any).__v18t;
    const res = await get(`/api/foods?q=${encodeURIComponent(`${RUN} roti`)}&limit=50`);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const ids = body.foods.map((f: any) => f.id);
    expect(ids.indexOf(f1)).toBeLessThan(ids.indexOf(f2));
    expect(ids.indexOf(f2)).toBeLessThan(ids.indexOf(f3));
  });

  it('finds foods by Urdu-script alias', async () => {
    const { f1 } = (globalThis as any).__v18t;
    const res = await get(`/api/foods?q=${encodeURIComponent('روٹی')}&limit=50`);
    const body = await readJson(res);
    expect(body.foods.map((f: any) => f.id)).toContain(f1);
  });

  it('orders verified first, then name, on name-contains ties', async () => {
    const { f4, f5 } = (globalThis as any).__v18t;
    const res = await get(`/api/foods?q=${encodeURIComponent(`${RUN} `)}&limit=50`);
    const body = await readJson(res);
    const ids = body.foods.map((f: any) => f.id);
    expect(ids.indexOf(f4)).toBeLessThan(ids.indexOf(f5));
  });

  it('filters by category, country, and verified flag', async () => {
    const { f1, f4 } = (globalThis as any).__v18t;
    const byCat = await readJson(await get(`/api/foods?category=${catId}&limit=50`));
    expect(byCat.foods.map((f: any) => f.id)).toEqual([f1]);

    const byCountry = await readJson(await get(`/api/foods?country=pk&limit=50`));
    const countryIds = byCountry.foods.map((f: any) => f.id);
    expect(countryIds).toContain(f4);

    const verified = await readJson(await get(`/api/foods?verified=true&q=${RUN}&limit=50`));
    expect(verified.foods.length).toBeGreaterThan(0);
    for (const f of verified.foods) expect(f.verification).toBe('verified');

    const estimates = await readJson(await get(`/api/foods?verified=false&q=${RUN}&limit=50`));
    for (const f of estimates.foods) expect(f.verification).toBe('estimate');
  });

  it('paginates with page/limit/totalPages/total', async () => {
    for (let i = 0; i < 5; i++) {
      const f = await makeFood({ name: `${RUN}PG Item ${i}` });
      foodIds.push(f.id);
    }
    const p1 = await readJson(await get(`/api/foods?q=${RUN}PG&page=1&limit=2`));
    expect(p1.total).toBe(5);
    expect(p1.totalPages).toBe(3);
    expect(p1.page).toBe(1);
    expect(p1.foods).toHaveLength(2);
    const p3 = await readJson(await get(`/api/foods?q=${RUN}PG&page=3&limit=2`));
    expect(p3.page).toBe(3);
    expect(p3.foods).toHaveLength(1);
  });

  it('returns the API shape (category, portions, verification, basis)', async () => {
    const res = await get(`/api/foods?q=${encodeURIComponent(`${RUN} Roti`)}&limit=1`);
    const body = await readJson(res);
    const f = body.foods[0];
    expect(f.category).toMatchObject({ id: catId });
    expect(f.portions[0]).toMatchObject({ label: '100 g', grams: 100 });
    expect(f.verification).toBe('estimate');
    expect(f.perServing).toMatchObject({ kcal: 100 });
    expect(typeof f.verified).toBe('boolean'); // legacy field kept
  });

  it('GET /api/foods/categories lists categories with Urdu names', async () => {
    const res = await categoriesGET(authed(new NextRequest('http://localhost/api/foods/categories'), token));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.categories[0]).toHaveProperty('nameUrdu');
  });

  it('rejects unauthenticated access with 401', async () => {
    const res: NextResponse = await foodsGET(new NextRequest('http://localhost/api/foods'));
    expect(res.status).toBe(401);
  });
});
