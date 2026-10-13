/**
 * V20 — Micronutrients (Cronometer-style %DV).
 *
 * - %DV math against the FDA reference table.
 * - Missing micro data → absent / "not tracked", NEVER 0.
 * - Unit handling: mg vs mcg vs IU (IU rows are dropped, never converted).
 * - USDA micro parsing: exact-name rows, no double counting.
 * - DiaryEntrySchema accepts a valid micros payload and rejects bad shapes.
 * - Web-search results thread micros through for USDA (OFF → null).
 * - DB-free: auth mocked, upstream HTTP stubbed at the fetch level.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 'test-user-1' } })),
}));

import {
  DAILY_VALUES,
  MICRO_KEYS,
  formatMicroAmount,
  pctDailyValue,
  scaleMicros,
  sumEntryMicros,
  trackedMicroKeys,
} from '@/lib/daily-values';
import { extractUsdaMicros, normalizeMicroUnit, normalizeUsdaFood } from '@/lib/usda';
import {
  DiaryEntrySchema,
  MICRO_STANDARD_UNITS,
  MicrosSchema,
  sumMicros,
  type MicroNutrients,
} from '@fitfusion/core';
import { GET } from '@/app/api/foods/web-search/route';
import { resetRateLimits } from '@/lib/rate-limit';

/* ------------------------------ %DV math ------------------------------ */

describe('pctDailyValue', () => {
  it('computes the %DV ratio in standard units', () => {
    // Vitamin C: 45 mg of 90 mg DV → 50%
    expect(pctDailyValue('vitaminC', 45)).toBeCloseTo(50, 8);
    // Vitamin D: 10 mcg of 20 mcg DV → 50%
    expect(pctDailyValue('vitaminD', 10)).toBeCloseTo(50, 8);
    // Sodium: 2300 mg of 2300 mg DV → 100%
    expect(pctDailyValue('sodium', 2300)).toBeCloseTo(100, 8);
    // Over 100% is reported as-is (bar clamps, number does not)
    expect(pctDailyValue('sodium', 4600)).toBeCloseTo(200, 8);
  });

  it('returns null (not tracked) for missing data — never 0', () => {
    expect(pctDailyValue('vitaminC', null)).toBeNull();
    expect(pctDailyValue('vitaminC', undefined)).toBeNull();
    expect(pctDailyValue('vitaminC', NaN)).toBeNull();
  });

  it('a tracked 0 amount is 0% — distinct from not-tracked', () => {
    expect(pctDailyValue('iron', 0)).toBe(0);
  });

  it('the DV table covers all 12 keys with standard units', () => {
    expect(MICRO_KEYS).toHaveLength(12);
    for (const k of MICRO_KEYS) {
      expect(DAILY_VALUES[k].value).toBeGreaterThan(0);
      expect(DAILY_VALUES[k].unit).toBe(MICRO_STANDARD_UNITS[k]);
      expect(DAILY_VALUES[k].label).toBeTruthy();
    }
    // Spot-check the FDA 21 CFR 101.36 reference values
    expect(DAILY_VALUES.vitaminA.value).toBe(900);
    expect(DAILY_VALUES.vitaminC.value).toBe(90);
    expect(DAILY_VALUES.vitaminD.value).toBe(20);
    expect(DAILY_VALUES.calcium.value).toBe(1300);
    expect(DAILY_VALUES.potassium.value).toBe(4700);
  });
});

/* ------------------------- missing data handling ------------------------- */

describe('sumMicros / sumEntryMicros', () => {
  it('sums tracked keys; untracked keys stay absent (never 0)', () => {
    const totals = sumMicros([
      { vitaminC: { amount: 30, unit: 'mg' }, iron: { amount: 2, unit: 'mg' } },
      null,
      { vitaminC: { amount: 15, unit: 'mg' } }, // second entry: no iron
    ]);
    expect(totals.vitaminC?.amount).toBeCloseTo(45, 8);
    expect(totals.iron?.amount).toBeCloseTo(2, 8);
    // Nothing tracked calcium anywhere → absent, not 0
    expect('calcium' in totals).toBe(false);
    expect(totals.calcium).toBeUndefined();
  });

  it('a tracked 0 amount is kept (data exists), missing stays absent', () => {
    const totals = sumMicros([{ vitaminD: { amount: 0, unit: 'mcg' } }]);
    expect(totals.vitaminD?.amount).toBe(0);
    expect('vitaminA' in totals).toBe(false);
  });

  it('empty day → empty totals, not a bag of zeros', () => {
    const totals = sumEntryMicros([]);
    expect(Object.keys(totals)).toHaveLength(0);
  });

  it('trackedMicroKeys reports which keys have data', () => {
    const m: MicroNutrients = { zinc: { amount: 5, unit: 'mg' } };
    expect(trackedMicroKeys(m)).toEqual(['zinc']);
    expect(trackedMicroKeys(null)).toEqual([]);
  });
});

describe('scaleMicros', () => {
  it('scales amounts by servings', () => {
    const out = scaleMicros({ vitaminC: { amount: 30, unit: 'mg' } }, 2.5)!;
    expect(out.vitaminC?.amount).toBeCloseTo(75, 8);
    expect(out.vitaminC?.unit).toBe('mg');
  });

  it('null in → null out (not tracked stays not tracked)', () => {
    expect(scaleMicros(null, 2)).toBeNull();
    expect(scaleMicros(undefined, 2)).toBeNull();
  });

  it('drops non-finite amounts instead of propagating garbage', () => {
    const out = scaleMicros(
      { vitaminC: { amount: 30, unit: 'mg' }, iron: { amount: NaN, unit: 'mg' } } as MicroNutrients,
      1,
    )!;
    expect(out.vitaminC?.amount).toBe(30);
    expect('iron' in out).toBe(false);
  });
});

/* ------------------------------ unit handling ------------------------------ */

describe('normalizeMicroUnit', () => {
  it('accepts MG and UG/microgram spellings', () => {
    expect(normalizeMicroUnit('MG')).toBe('mg');
    expect(normalizeMicroUnit('mg')).toBe('mg');
    expect(normalizeMicroUnit('UG')).toBe('mcg');
    expect(normalizeMicroUnit('ug')).toBe('mcg');
    expect(normalizeMicroUnit('MCG')).toBe('mcg');
    expect(normalizeMicroUnit('μg')).toBe('mcg'); // greek mu
  });

  it('rejects units that must never be silently converted', () => {
    expect(normalizeMicroUnit('IU')).toBeNull(); // vitamer-dependent — no guessing
    expect(normalizeMicroUnit('G')).toBeNull();
    expect(normalizeMicroUnit('KCAL')).toBeNull();
    expect(normalizeMicroUnit(undefined)).toBeNull();
    expect(normalizeMicroUnit('')).toBeNull();
  });
});

describe('extractUsdaMicros', () => {
  const nutrients = [
    { nutrientName: 'Vitamin C, total ascorbic acid', unitName: 'MG', value: 45 },
    { nutrientName: 'Vitamin A, RAE', unitName: 'UG', value: 120 },
    { nutrientName: 'Vitamin A, IU', unitName: 'IU', value: 400 },
    { nutrientName: 'Vitamin D (D2 + D3)', unitName: 'UG', value: 2.5 },
    { nutrientName: 'Vitamin D2 (ergocalciferol)', unitName: 'UG', value: 1 },
    { nutrientName: 'Vitamin D3 (cholecalciferol)', unitName: 'UG', value: 1.5 },
    { nutrientName: 'Calcium, Ca', unitName: 'MG', value: 300 },
    { nutrientName: 'Iron, Fe', unitName: 'MG', value: 0 },
    { nutrientName: 'Sodium, Na', unitName: 'MG', value: 460 },
    { nutrientName: 'Fatty acids, total saturated', unitName: 'G', value: 1 },
  ];

  it('parses micros in standard units', () => {
    const m = extractUsdaMicros(nutrients)!;
    expect(m.vitaminC).toEqual({ amount: 45, unit: 'mg' });
    expect(m.vitaminA).toEqual({ amount: 120, unit: 'mcg' }); // RAE, not IU
    expect(m.vitaminD).toEqual({ amount: 2.5, unit: 'mcg' }); // total, not D2/D3 parts
    expect(m.calcium).toEqual({ amount: 300, unit: 'mg' });
    expect(m.sodium).toEqual({ amount: 460, unit: 'mg' });
  });

  it('never double-counts sibling rows', () => {
    const m = extractUsdaMicros(nutrients)!;
    // D2 (1) + D3 (1.5) must not be summed on top of the (D2 + D3) total (2.5)
    expect(m.vitaminD?.amount).toBe(2.5);
  });

  it('drops IU-only vitamins instead of converting', () => {
    const m = extractUsdaMicros([{ nutrientName: 'Vitamin A, IU', unitName: 'IU', value: 400 }]);
    expect(m).toBeNull(); // no RAE row → not tracked
  });

  it('keeps an explicit 0 value (tracked) but reports missing as absent', () => {
    const m = extractUsdaMicros(nutrients)!;
    expect(m.iron?.amount).toBe(0); // explicitly reported 0 = data
    expect('zinc' in m).toBe(false); // never reported = not tracked
    expect('vitaminE' in m).toBe(false);
  });

  it('returns null when no micro rows are usable', () => {
    expect(extractUsdaMicros([])).toBeNull();
    expect(extractUsdaMicros(undefined)).toBeNull();
    expect(extractUsdaMicros([{ nutrientName: 'Protein', unitName: 'G', value: 3 }])).toBeNull();
  });

  it('normalizeUsdaFood threads micros through', () => {
    const f = normalizeUsdaFood({
      fdcId: 7,
      description: 'Test food',
      foodNutrients: nutrients,
    })!;
    expect(f.micros?.vitaminC).toEqual({ amount: 45, unit: 'mg' });
    const empty = normalizeUsdaFood({ fdcId: 8, description: 'No micros', foodNutrients: [] })!;
    expect(empty.micros).toBeNull();
  });
});

/* --------------------------- diary payload schema --------------------------- */

describe('MicrosSchema / DiaryEntrySchema', () => {
  const base = {
    date: '2026-10-12',
    mealType: 'lunch',
    customName: 'Web item',
    servings: 2,
    kcal: 200,
  };

  it('accepts a valid micros snapshot on a diary entry', () => {
    const parsed = DiaryEntrySchema.safeParse({
      ...base,
      micros: { vitaminC: { amount: 90, unit: 'mg' }, zinc: { amount: 2, unit: 'mg' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('micros is optional — legacy entries without micros still validate', () => {
    expect(DiaryEntrySchema.safeParse(base).success).toBe(true);
    expect(DiaryEntrySchema.safeParse({ ...base, micros: null }).success).toBe(false); // null ≠ absent
  });

  it('rejects unknown micro keys (closed shape, strict)', () => {
    const parsed = MicrosSchema.safeParse({ vitaminZ: { amount: 1, unit: 'mg' } });
    expect(parsed.success).toBe(false);
  });

  it('rejects a wrong-unit value instead of silently mis-scaling ×1000', () => {
    const parsed = MicrosSchema.safeParse({ vitaminA: { amount: 1, unit: 'mg' } }); // must be mcg
    expect(parsed.success).toBe(false);
  });

  it('rejects negative, NaN, and infinite amounts', () => {
    expect(MicrosSchema.safeParse({ iron: { amount: -1, unit: 'mg' } }).success).toBe(false);
    expect(MicrosSchema.safeParse({ iron: { amount: NaN, unit: 'mg' } }).success).toBe(false);
    expect(MicrosSchema.safeParse({ iron: { amount: Infinity, unit: 'mg' } }).success).toBe(false);
  });

  it('formatMicroAmount renders amounts readably', () => {
    expect(formatMicroAmount({ amount: 45, unit: 'mg' })).toBe('45 mg');
    expect(formatMicroAmount({ amount: 45.67, unit: 'mg' })).toBe('45.7 mg');
    expect(formatMicroAmount({ amount: 120.456, unit: 'mcg' })).toBe('120 mcg'); // ≥100 → whole
    expect(formatMicroAmount({ amount: 1300, unit: 'mg' })).toBe('1,300 mg');
  });
});

/* ------------------- web-search threads micros through ------------------- */

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

function req(q: string): NextRequest {
  return new NextRequest(`http://x/api/foods/web-search?q=${encodeURIComponent(q)}`);
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

describe('GET /api/foods/web-search micros threading', () => {
  it('USDA results carry micros; OFF results are null (never guessed)', async () => {
    usdaHandler = () => ({
      status: 200,
      body: {
        foods: [
          {
            fdcId: 555,
            description: 'Orange, raw',
            servingSize: 100,
            servingSizeUnit: 'g',
            foodNutrients: [
              { nutrientName: 'Energy', unitName: 'KCAL', value: 47 },
              { nutrientName: 'Vitamin C, total ascorbic acid', unitName: 'MG', value: 53.2 },
              { nutrientName: 'Potassium, K', unitName: 'MG', value: 181 },
            ],
          },
        ],
      },
    });
    offHandler = () => ({ status: 200, body: { products: [], page: 1 } });

    const res = await GET(req('orange'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { results: Array<Record<string, unknown>> };
    const usda = data.results.find((r) => r.source === 'USDA')!;
    const micros = usda.micros as Record<string, { amount: number; unit: string }>;
    expect(micros.vitaminC).toEqual({ amount: 53.2, unit: 'mg' });
    expect(micros.potassium).toEqual({ amount: 181, unit: 'mg' });
    expect('calcium' in micros).toBe(false); // not reported → absent
  });

  it('OFF results always report micros: null', async () => {
    usdaHandler = () => ({ status: 200, body: { foods: [] } });
    offHandler = () => ({
      status: 200,
      body: {
        products: [
          {
            code: '999',
            product_name: 'Test bar',
            nutriments: { 'energy-kcal_serving': 200 },
          },
        ],
        page: 1,
      },
    });
    const res = await GET(req('bar'));
    const data = (await res.json()) as { results: Array<Record<string, unknown>> };
    const off = data.results.find((r) => r.source === 'Open Food Facts');
    expect(off).toBeDefined();
    expect(off!.micros).toBeNull();
  });
});
