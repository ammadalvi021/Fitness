/**
 * V19 — Web food search (USDA + Open Food Facts).
 *
 * - USDA nutrient parsing: energy prefers KCAL, fat matches Total lipid
 *   (no fatty-acid double counting), missing nutrients → null (never 0).
 * - /api/foods/web-search: merges USDA + OFF, dedupes by name+brand,
 *   caps results, no-key graceful behavior, both-fail → 502.
 * - DB-free: auth mocked, upstream HTTP stubbed at the fetch level.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 'test-user-1' } })),
}));

import { normalizeUsdaFood, pickNutrient } from '@/lib/usda';
import { GET } from '@/app/api/foods/web-search/route';
import { resetRateLimits } from '@/lib/rate-limit';

/* ------------------------------ fetch stub ------------------------------ */

const realFetch = globalThis.fetch;
let usdaHandler: ((url: string) => { status: number; body: unknown }) | null = null;
let offHandler: ((url: string) => { status: number; body: unknown }) | null = null;

function stubFetch() {
  (globalThis as { fetch: typeof fetch }).fetch = (async (
    url: string | URL | Request,
  ): Promise<Response> => {
    const u = String(url);
    const h = u.includes('api.nal.usda.gov') ? usdaHandler : u.includes('openfoodfacts') ? offHandler : null;
    if (!h) throw new Error(`unexpected fetch: ${u}`);
    const { status, body } = h(u);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  vi.stubEnv('USDA_API_KEY', 'test-key');
  usdaHandler = null;
  offHandler = null;
  stubFetch();
  resetRateLimits();
});

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = realFetch;
  vi.unstubAllEnvs();
});

function req(q: string | null): NextRequest {
  const url = q === null ? 'http://x/api/foods/web-search' : `http://x/api/foods/web-search?q=${encodeURIComponent(q)}`;
  return new NextRequest(url);
}

async function bodyOf(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

/* --------------------------- USDA parsing --------------------------- */

describe('normalizeUsdaFood', () => {
  const base = {
    fdcId: 123,
    description: 'Soup, vegetable',
    servingSize: 240,
    servingSizeUnit: 'g',
    foodNutrients: [
      { nutrientName: 'Energy', unitName: 'KCAL', value: 85 },
      { nutrientName: 'Energy', unitName: 'kJ', value: 356 },
      { nutrientName: 'Protein', unitName: 'G', value: 3.2 },
      { nutrientName: 'Carbohydrate, by difference', unitName: 'G', value: 12 },
      { nutrientName: 'Total lipid (fat)', unitName: 'G', value: 2.5 },
      { nutrientName: 'Fatty acids, total saturated', unitName: 'G', value: 0.8 },
      { nutrientName: 'Fiber, total dietary', unitName: 'G', value: 2.1 },
    ],
  };

  it('parses kcal/macros and prefers KCAL over kJ', () => {
    const f = normalizeUsdaFood(base)!;
    expect(f.id).toBe('usda-123');
    expect(f.name).toBe('Soup, vegetable');
    expect(f.kcal).toBe(85);
    expect(f.proteinG).toBe(3.2);
    expect(f.carbsG).toBe(12);
    expect(f.fatG).toBe(2.5); // Total lipid, not saturated-only
    expect(f.fiberG).toBe(2.1);
    expect(f.servingSize).toBe(240);
    expect(f.verification).toBe('estimate');
  });

  it('returns null (never 0) for missing nutrients', () => {
    const f = normalizeUsdaFood({ fdcId: 9, description: 'Mystery', foodNutrients: [] })!;
    expect(f.kcal).toBeNull();
    expect(f.proteinG).toBeNull();
    expect(f.servingSize).toBe(100); // 100 g fallback
    expect(f.servingUnit).toBe('g');
  });

  it('does not guess kcal from kJ-only rows', () => {
    const f = normalizeUsdaFood({
      fdcId: 10,
      description: 'KJ only',
      foodNutrients: [{ nutrientName: 'Energy', unitName: 'kJ', value: 356 }],
    })!;
    expect(f.kcal).toBeNull();
  });

  it('rejects records without fdcId or name', () => {
    expect(normalizeUsdaFood({ description: 'x' })).toBeNull();
    expect(normalizeUsdaFood({ fdcId: 1 })).toBeNull();
  });

  it('pickNutrient ignores non-finite values', () => {
    expect(pickNutrient([{ nutrientName: 'Protein', value: NaN }], (n) => /protein/i.test(n))).toBeNull();
  });
});

/* --------------------------- web-search route --------------------------- */

const USDA_OK = {
  foods: [
    {
      fdcId: 111,
      description: 'Soup, vegetable, canned',
      brandOwner: 'Acme',
      servingSize: 240,
      servingSizeUnit: 'g',
      foodNutrients: [
        { nutrientName: 'Energy', unitName: 'KCAL', value: 90 },
        { nutrientName: 'Protein', unitName: 'G', value: 3 },
      ],
    },
    {
      fdcId: 222,
      description: 'Vegetable Soup',
      // same normalized name+brand as the OFF product below → deduped
      brandOwner: 'Acme',
      servingSize: 240,
      servingSizeUnit: 'g',
      foodNutrients: [{ nutrientName: 'Energy', unitName: 'KCAL', value: 95 }],
    },
  ],
};

const OFF_OK = {
  products: [
    {
      code: '1234567890123',
      product_name: 'Vegetable soup',
      brands: 'Acme',
      quantity: '400 g',
      serving_size: '240 g',
      image_url: null,
      nutriments: {
        'energy-kcal_100g': 38,
        'energy-kcal_serving': 91,
        proteins_100g: 1.2,
        proteins_serving: 2.9,
        carbohydrates_100g: 6,
        fat_100g: 1,
        fiber_100g: 1.5,
      },
      ingredients_text: 'water, vegetables',
      allergens: '',
      ecoscore_grade: null,
      nutriscore_grade: null,
    },
  ],
  page: 1,
  page_size: 20,
  count: 1,
};

describe('GET /api/foods/web-search', () => {
  it('400 when q is missing', async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(400);
  });

  it('merges USDA + OFF and dedupes by name+brand', async () => {
    usdaHandler = () => ({ status: 200, body: USDA_OK });
    offHandler = () => ({ status: 200, body: OFF_OK });
    const res = await GET(req('vegetable soup'));
    expect(res.status).toBe(200);
    const data = await bodyOf(res);
    const results = data.results as Array<Record<string, unknown>>;
    // 2 USDA + 1 OFF, one duplicate removed → 2
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('USDA'); // USDA first
    expect(results.every((r) => r.verification === 'estimate')).toBe(true);
    expect((data.sources as Record<string, boolean>).usda).toBe(true);
    expect((data.sources as Record<string, boolean>).openFoodFacts).toBe(true);
  });

  it('works with OFF only when no USDA key is configured', async () => {
    vi.stubEnv('USDA_API_KEY', '');
    offHandler = () => ({ status: 200, body: OFF_OK });
    let usdaCalled = false;
    usdaHandler = () => {
      usdaCalled = true;
      return { status: 200, body: { foods: [] } };
    };
    const res = await GET(req('soup'));
    expect(res.status).toBe(200);
    const data = await bodyOf(res);
    expect(usdaCalled).toBe(false);
    expect((data.results as unknown[]).length).toBeGreaterThan(0);
    expect((data.sources as Record<string, boolean>).usda).toBe(false);
    expect((data.sources as Record<string, boolean>).openFoodFacts).toBe(true);
  });

  it('502 with a friendly message when both sources fail', async () => {
    vi.stubEnv('USDA_API_KEY', '');
    offHandler = () => {
      throw new Error('down');
    };
    const res = await GET(req('soup'));
    expect(res.status).toBe(502);
    const data = await bodyOf(res);
    const msg = (data.error as { message: string }).message;
    expect(msg).toMatch(/unavailable/i);
    expect(msg).not.toMatch(/stack|Error:/);
  });

  it('rate-limits repeated searches', async () => {
    offHandler = () => ({ status: 200, body: OFF_OK });
    usdaHandler = () => ({ status: 200, body: { foods: [] } });
    let last: Response = await GET(req('a'));
    for (let i = 0; i < 35; i++) last = await GET(req('a'));
    expect(last.status).toBe(429);
  });
});
