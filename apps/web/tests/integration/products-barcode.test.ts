/**
 * Phase B — Packaged products (Open Food Facts).
 * OFF is NEVER hit in tests: global fetch is stubbed per test.
 */
import { NextRequest, NextResponse } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as barcodeGET } from '@/app/api/products/barcode/[code]/route';
import { GET as searchGET } from '@/app/api/products/search/route';
import { POST as savePOST } from '@/app/api/products/save/route';
import {
  OFF_CACHE_TTL_MS,
  cacheIsFresh,
  isValidBarcode,
  normalizeBarcode,
  normalizeOffProduct,
  scaleNutrients,
} from '@/lib/openfoodfacts';
import {
  availableQuantityKinds,
  foodServingGrams,
  nutrientsForOneServing,
  resolveQuantity,
} from '@/lib/barcode-quantity';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

/* ---------- mock OFF fixtures (NOT real OFF data) ---------- */

const MOCK_BARCODE = '3017620422003';

/** Fixture with native per-serving nutriments (quality: complete). */
function offProductComplete() {
  return {
    code: MOCK_BARCODE,
    product_name: 'Test Hazelnut Spread',
    brands: 'TestBrand',
    quantity: '400 g',
    serving_size: '15 g',
    nutriments: {
      'energy-kcal_100g': 539,
      proteins_100g: 6.3,
      carbohydrates_100g: 57.5,
      fat_100g: 30.9,
      fiber_100g: 0,
      sugars_100g: 56.3,
      salt_100g: 0.107,
      'energy-kcal_serving': 80.85,
      proteins_serving: 0.945,
      carbohydrates_serving: 8.625,
      fat_serving: 4.635,
      fiber_serving: 0,
      sugars_serving: 8.445,
      salt_serving: 0.016,
    },
    ingredients_text: 'Sugar, palm oil, hazelnuts',
    allergens_tags: ['en:milk', 'en:nuts', 'en:soybeans'],
    nutriscore_grade: 'e',
    image_front_small_url: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.1.400.jpg',
  };
}

/** Fixture with per-100g only + serving size (quality: partial, derived). */
function offProductPer100gOnly() {
  return {
    code: '5000112546415',
    product_name: 'Test Cola',
    brands: 'TestCola',
    quantity: '1.5 l',
    serving_size: '250 ml',
    nutriments: {
      'energy-kcal_100g': 42,
      proteins_100g: 0,
      carbohydrates_100g: 10.6,
      fat_100g: 0,
      sugars_100g: 10.6,
      salt_100g: 0,
    },
  };
}

/** Fixture with no nutrition at all (quality: minimal). */
function offProductNoNutrition() {
  return {
    code: '4000000000012',
    product_name: 'Test Mystery Product',
    brands: 'TestMystery',
    quantity: '100 g',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stub global fetch; `handler` receives the request URL. */
function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
      return handler(url);
    }),
  );
}

const offOk = (product: unknown) => jsonResponse({ status: 1, product });

/* ---------- pure function tests ---------- */

describe('barcode validation', () => {
  it('accepts 8–14 digit codes, rejects everything else', () => {
    expect(isValidBarcode('3017620422003')).toBe(true); // EAN-13
    expect(isValidBarcode('049000028904')).toBe(true); // UPC-12
    expect(isValidBarcode('12345678')).toBe(true); // EAN-8
    expect(isValidBarcode(' 3017-6204-22003 ')).toBe(true); // formatting stripped
    expect(isValidBarcode('1234567')).toBe(false); // too short
    expect(isValidBarcode('123456789012345')).toBe(false); // too long
    expect(isValidBarcode('abc')).toBe(false);
    expect(isValidBarcode('30176204220a3')).toBe(false); // letter inside
    expect(isValidBarcode('')).toBe(false);
  });

  it('normalizes formatting before validating', () => {
    expect(normalizeBarcode(' 3017-6204-22003 ')).toBe('3017620422003');
  });
});

describe('OFF normalizer', () => {
  it('maps native per-serving + per-100g values (quality complete)', () => {
    const p = normalizeOffProduct(MOCK_BARCODE, offProductComplete() as never);
    expect(p.name).toBe('Test Hazelnut Spread');
    expect(p.brand).toBe('TestBrand');
    expect(p.packSize).toBe('400 g');
    expect(p.packGrams).toBe(400);
    expect(p.servingSize).toBe(15);
    expect(p.servingUnit).toBe('g');
    expect(p.perServing?.kcal).toBe(80.85);
    expect(p.per100g?.kcal).toBe(539);
    expect(p.allergens).toEqual(['Milk', 'Nuts', 'Soybeans']);
    expect(p.ingredients).toContain('hazelnuts');
    expect(p.nutriscore).toBe('e');
    expect(p.quality).toBe('complete');
    expect(p.derivedPerServing).toBe(false);
    expect(p.dataSource).toBe('openfoodfacts');
    expect(p.imageUrl).toContain('openfoodfacts.org');
  });

  it('derives per-serving from per-100g when serving size is known (quality partial)', () => {
    const p = normalizeOffProduct('5000112546415', offProductPer100gOnly() as never);
    // 42 kcal/100g × 250ml ≈ 250g → 105 kcal
    expect(p.perServing?.kcal).toBe(105);
    expect(p.perServing?.carbsG).toBe(26.5);
    expect(p.quality).toBe('partial');
    expect(p.derivedPerServing).toBe(true);
  });

  it('reports minimal quality and null nutrients when OFF has no numbers', () => {
    const p = normalizeOffProduct('4000000000012', offProductNoNutrition() as never);
    expect(p.quality).toBe('minimal');
    expect(p.perServing).toBeNull();
    expect(p.per100g).toBeNull();
    expect(p.allergens).toEqual([]);
  });

  it('scaleNutrients multiplies every field and preserves nulls', () => {
    const scaled = scaleNutrients(
      { kcal: 100, proteinG: 10, carbsG: 20, fatG: 5, fiberG: 2, sugarG: 3, saltG: null },
      2.5,
    );
    expect(scaled.kcal).toBe(250);
    expect(scaled.proteinG).toBe(25);
    expect(scaled.saltG).toBeNull();
  });
});

describe('cache TTL logic', () => {
  it('is fresh just inside the TTL, stale at/past the boundary', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const freshAt = new Date(now.getTime() - OFF_CACHE_TTL_MS + 60_000);
    const staleAt = new Date(now.getTime() - OFF_CACHE_TTL_MS - 60_000);
    expect(cacheIsFresh(freshAt, now)).toBe(true);
    expect(cacheIsFresh(staleAt, now)).toBe(false);
    expect(cacheIsFresh(new Date(now.getTime() - OFF_CACHE_TTL_MS), now)).toBe(false);
  });
});

describe('quantity selector math', () => {
  const product = () => normalizeOffProduct(MOCK_BARCODE, offProductComplete() as never);

  it('1 serving = serving size in grams', () => {
    const r = resolveQuantity(product(), { kind: 'serving' });
    expect(r.servings).toBe(1);
    expect(r.grams).toBe(15);
    expect(r.nutrients?.kcal).toBe(80.85);
  });

  it('whole pack: packGrams / servingGrams', () => {
    const r = resolveQuantity(product(), { kind: 'whole_pack' });
    expect(r.servings).toBe(26.67); // rounded to 2 decimals by design
    expect(r.nutrients?.kcal).toBe(2156); // 80.85 × 400/15, scaled then rounded
  });

  it('half pack is half of whole pack', () => {
    const r = resolveQuantity(product(), { kind: 'half_pack' });
    expect(r.servings).toBe(13.33); // rounded to 2 decimals by design
  });

  it('custom grams scale against the serving size', () => {
    const r = resolveQuantity(product(), { kind: 'custom_grams', value: 30 });
    expect(r.servings).toBe(2);
    expect(r.nutrients?.kcal).toBe(161.7);
  });

  it('hides pack options when pack grams are unknown', () => {
    const noPack = normalizeOffProduct('x', {
      product_name: 'Test',
      quantity: 'unknown size',
      serving_size: '15 g',
      nutriments: { 'energy-kcal_serving': 80, 'energy-kcal_100g': 533 },
    } as never);
    expect(noPack.packGrams).toBeNull();
    const kinds = availableQuantityKinds(noPack);
    expect(kinds).toContain('custom_grams');
    expect(kinds).not.toContain('whole_pack');
  });

  it('falls back to custom servings when serving size is unknown', () => {
    const noServing = normalizeOffProduct('x', {
      product_name: 'Test',
      nutriments: { 'energy-kcal_serving': 80 },
    } as never);
    expect(noServing.servingSize).toBeNull();
    expect(availableQuantityKinds(noServing)).toContain('custom_servings');
    const r = resolveQuantity(noServing, { kind: 'custom_servings', value: 2 });
    expect(r.servings).toBe(2);
    expect(r.nutrients?.kcal).toBe(160);
  });

  it('foodServingGrams prefers serving size, falls back to 100 g', () => {
    expect(foodServingGrams(product())).toEqual({ size: 15, unit: 'g' });
    const noServing = normalizeOffProduct('x', { product_name: 'T' } as never);
    expect(foodServingGrams(noServing)).toEqual({ size: 100, unit: 'g' });
  });

  it('nutrientsForOneServing never invents values', () => {
    expect(nutrientsForOneServing(product(), 15)?.kcal).toBe(80.85);
    const none = normalizeOffProduct('x', { product_name: 'T' } as never);
    expect(nutrientsForOneServing(none, 100)).toBeNull();
  });
});

/* ---------- route tests (mocked fetch, real DB) ---------- */

describe('barcode lookup route', () => {
  let token = '';

  beforeAll(async () => {
    const { token: t } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-off'));
    token = t;
  });
  afterAll(async () => {
    await cleanupUsers();
    await prisma.cachedProduct.deleteMany({ where: { id: { in: [MOCK_BARCODE, '5000112546415', '9999999999999'] } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects invalid barcodes with 400', async () => {
    for (const bad of ['abc', '123', '12345678901234567', '3017a20422003']) {
      const res = await barcodeGET(
        authed(new NextRequest(`http://localhost/api/products/barcode/${bad}`), token),
        { params: { code: bad } },
      );
      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body.error.code).toBe('validation_error');
    }
  });

  it('returns 401 for unauthenticated lookups', async () => {
    const res = await barcodeGET(new NextRequest(`http://localhost/api/products/barcode/${MOCK_BARCODE}`), {
      params: { code: MOCK_BARCODE },
    });
    expect(res.status).toBe(401);
  });

  it('returns found:false honestly when OFF 404s', async () => {
    mockFetch(() => jsonResponse({ status: 0, code: '9999999999999' }, 404));
    const res = await barcodeGET(
      authed(new NextRequest('http://localhost/api/products/barcode/9999999999999'), token),
      { params: { code: '9999999999999' } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.found).toBe(false);
    expect(body.message).toMatch(/No product found/);
  });

  it('returns found:false honestly when OFF reports status 0', async () => {
    mockFetch(() => jsonResponse({ status: 0 }));
    const res = await barcodeGET(
      authed(new NextRequest(`http://localhost/api/products/barcode/${MOCK_BARCODE}`), token),
      { params: { code: MOCK_BARCODE } },
    );
    const body = await readJson(res);
    expect(body.found).toBe(false);
  });

  it('normalizes a found product and labels it estimate', async () => {
    const fetchSpy = vi.fn(async () => offOk(offProductComplete()));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await barcodeGET(
      authed(new NextRequest(`http://localhost/api/products/barcode/${MOCK_BARCODE}`), token),
      { params: { code: MOCK_BARCODE } },
    );
    const body = await readJson(res);
    expect(body.found).toBe(true);
    expect(body.product.name).toBe('Test Hazelnut Spread');
    expect(body.product.verification).toBe('estimate');
    expect(body.product.verificationBasis).toMatch(/crowdsourced/i);
    expect(body.product.attribution).toMatch(/Open Food Facts contributors/);
    expect(body.product.perServing.kcal).toBe(80.85);
    expect(body.product.per100g.kcal).toBe(539);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain(MOCK_BARCODE);
  });

  it('uses the 7-day cache and does not re-fetch', async () => {
    const fetchSpy = vi.fn(async () => offOk(offProductComplete()));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await barcodeGET(
      authed(new NextRequest(`http://localhost/api/products/barcode/${MOCK_BARCODE}`), token),
      { params: { code: MOCK_BARCODE } },
    );
    const body = await readJson(res);
    expect(body.found).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled(); // previous test cached it
  });

  it('re-fetches when the cache is stale', async () => {
    await prisma.cachedProduct.upsert({
      where: { id: MOCK_BARCODE },
      create: { id: MOCK_BARCODE, provider: 'openfoodfacts', payload: offProductComplete() },
      update: { fetchedAt: new Date(Date.now() - OFF_CACHE_TTL_MS - 1000) },
    });
    const fetchSpy = vi.fn(async () => offOk(offProductComplete()));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await barcodeGET(
      authed(new NextRequest(`http://localhost/api/products/barcode/${MOCK_BARCODE}`), token),
      { params: { code: MOCK_BARCODE } },
    );
    expect((await readJson(res)).found).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns found:false when OFF is unreachable', async () => {
    await prisma.cachedProduct.deleteMany({ where: { id: MOCK_BARCODE } });
    mockFetch(() => Promise.reject(new Error('network down')));
    const res = await barcodeGET(
      authed(new NextRequest(`http://localhost/api/products/barcode/${MOCK_BARCODE}`), token),
      { params: { code: MOCK_BARCODE } },
    );
    const body = await readJson(res);
    expect(body.found).toBe(false);
    expect(body.message).toMatch(/connection/i);
  });
});

describe('product search route', () => {
  let token = '';

  beforeAll(async () => {
    const { token: t } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-off-search'));
    token = t;
  });
  afterAll(cleanupUsers);
  afterEach(() => vi.unstubAllGlobals());

  it('requires q', async () => {
    const res = await searchGET(authed(new NextRequest('http://localhost/api/products/search'), token));
    expect(res.status).toBe(400);
  });

  it('normalizes search results with pagination', async () => {
    mockFetch((url) =>
      url.includes('search.pl')
        ? jsonResponse({
            products: [offProductComplete(), offProductPer100gOnly()],
            page: 1,
            page_size: 20,
            count: 2,
          })
        : jsonResponse({}, 404),
    );
    const res = await searchGET(
      authed(new NextRequest('http://localhost/api/products/search?q=spread&page=1'), token),
    );
    const body = await readJson(res);
    expect(res.status).toBe(200);
    expect(body.products).toHaveLength(2);
    expect(body.products[0].verification).toBe('estimate');
    expect(body.page).toBe(1);
    expect(body.totalPages).toBe(1);
    expect(body.total).toBe(2);
  });

  it('returns 502 when OFF is unreachable', async () => {
    mockFetch(() => Promise.reject(new Error('down')));
    const res = await searchGET(
      authed(new NextRequest('http://localhost/api/products/search?q=spread'), token),
    );
    expect(res.status).toBe(502);
  });
});

describe('product save route', () => {
  let token = '';

  beforeAll(async () => {
    const { token: t } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-off-save'));
    token = t;
  });
  afterAll(async () => {
    await prisma.food.deleteMany({ where: { barcode: { in: [MOCK_BARCODE, '4000000000012', '7111111111111'] } } });
    await prisma.food.deleteMany({ where: { name: { contains: 'Manual Label Test' } } });
    await prisma.cachedProduct.deleteMany({ where: { id: { in: [MOCK_BARCODE, '4000000000012'] } } });
    await cleanupUsers();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves an OFF product as Food (estimate, barcode set)', async () => {
    mockFetch(() => offOk(offProductComplete()));
    const res = await savePOST(
      authed(jsonRequest('http://localhost/api/products/save', 'POST', { mode: 'off', barcode: MOCK_BARCODE }), token),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.saved).toBe('created');
    expect(body.food.source).toBe('openfoodfacts');
    expect(body.food.verification).toBe('estimate');
    expect(body.food.verificationBasis).toMatch(/crowdsourced/);
    expect(body.food.barcode).toBe(MOCK_BARCODE);
    expect(body.food.servingSize).toBe(15);
    expect(body.food.perServing.kcal).toBe(80.85);

    // Idempotent: second save returns the same row as 'updated'.
    const again = await savePOST(
      authed(jsonRequest('http://localhost/api/products/save', 'POST', { mode: 'off', barcode: MOCK_BARCODE }), token),
    );
    const againBody = await readJson(again);
    expect(again.status).toBe(200);
    expect(againBody.saved).toBe('updated');
    expect(againBody.food.id).toBe(body.food.id);
  });

  it('refuses to save a product with no nutrition data', async () => {
    mockFetch(() => offOk(offProductNoNutrition()));
    const res = await savePOST(
      authed(jsonRequest('http://localhost/api/products/save', 'POST', { mode: 'off', barcode: '4000000000012' }), token),
    );
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error.code).toBe('no_nutrition_data');
    const row = await prisma.food.findUnique({ where: { barcode: '4000000000012' } });
    expect(row).toBeNull();
  });

  it('404s for an unresolvable barcode instead of fabricating nutrition', async () => {
    mockFetch(() => jsonResponse({ status: 0 }, 404));
    const res = await savePOST(
      authed(jsonRequest('http://localhost/api/products/save', 'POST', { mode: 'off', barcode: '7111111111111' }), token),
    );
    expect(res.status).toBe(404);
    expect((await readJson(res)).error.code).toBe('product_not_found');
  });

  it('saves manual label entries as user_label estimates', async () => {
    const res = await savePOST(
      authed(
        jsonRequest('http://localhost/api/products/save', 'POST', {
          mode: 'manual_label',
          name: 'Manual Label Test Soup',
          brand: 'HomeBrand',
          servingSize: 250,
          servingUnit: 'g',
          kcal: 120,
          proteinG: 5,
          carbsG: 15,
          fatG: 4,
          fiberG: 2,
          barcode: '7111111111111',
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.food.source).toBe('user_label');
    expect(body.food.verification).toBe('estimate');
    expect(body.food.perServing.kcal).toBe(120);
  });

  it('validates manual label payloads', async () => {
    const res = await savePOST(
      authed(jsonRequest('http://localhost/api/products/save', 'POST', { mode: 'manual_label', name: '' }), token),
    );
    expect(res.status).toBe(400);
  });
});
