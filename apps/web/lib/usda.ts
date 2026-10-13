/**
 * USDA FoodData Central adapter — SERVER-SIDE ONLY.
 *
 * Free API key: https://api.nal.usda.gov (no key = adapter reports
 * unavailable; results are never fabricated).
 *
 * Docs: https://api.nal.usda.gov/fdc/v1 (OpenAPI)
 */
import {
  MICRO_KEYS,
  MICRO_STANDARD_UNITS,
  type MicroKey,
  type MicroNutrients,
  type MicroUnit,
} from '@fitfusion/core';

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';
const TIMEOUT_MS = 15_000;

export interface UsdaFood {
  /** Stable client key, e.g. 'usda-123456'. */
  id: string;
  name: string;
  brand: string | null;
  servingSize: number | null;
  servingUnit: string | null;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  /**
   * V20: micronutrients parsed from the record's foodNutrients, in each
   * key's standard unit. null = the record reported no usable micro data
   * (never 0, never guessed). Shares the same serving basis as kcal.
   */
  micros: MicroNutrients | null;
  source: 'USDA';
  sourceNote: string;
  verification: 'estimate';
  verificationBasis: string;
}

/** True when a USDA API key is configured. */
export function isUsdaConfigured(): boolean {
  return Boolean(process.env.USDA_API_KEY?.trim());
}

interface UsdaNutrient {
  nutrientName?: string;
  unitName?: string;
  value?: number | null;
}

interface UsdaFoodRaw {
  fdcId?: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: UsdaNutrient[];
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Pick a nutrient value from the foodNutrients list.
 * Matches by nutrientName substring; for energy prefers KCAL rows so we
 * never mix kJ into kcal. Fat matches 'Total lipid' to avoid summing the
 * dozens of individual fatty-acid rows.
 */
export function pickNutrient(
  nutrients: UsdaNutrient[] | undefined,
  matcher: (name: string) => boolean,
  preferKcal = false,
): number | null {
  if (!nutrients) return null;
  const rows = nutrients.filter(
    (n) => typeof n?.nutrientName === 'string' && matcher(n.nutrientName),
  );
  if (!rows.length) return null;
  if (preferKcal) {
    const kcalRow = rows.find((n) => n.unitName?.toUpperCase() === 'KCAL');
    if (kcalRow) return numOrNull(kcalRow.value);
    // No KCAL row — do not guess from kJ; report missing.
    return null;
  }
  const row = rows.find((n) => numOrNull(n.value) !== null);
  return row ? numOrNull(row.value) : null;
}

const isEnergy = (n: string) => /energy/i.test(n);
const isProtein = (n: string) => /protein/i.test(n);
const isCarb = (n: string) => /carbohydrate/i.test(n);
const isFat = (n: string) => /total lipid/i.test(n);
const isFiber = (n: string) => /fiber/i.test(n);

/**
 * V20 — USDA nutrient-name mapping for micronutrients.
 *
 * Exact (lowercased, trimmed) nutrient names per micro key, ordered most
 * specific first. Exact names — not substrings — so we never double-count
 * sibling rows (e.g. 'Vitamin D (D2 + D3)' total vs 'Vitamin D2' /
 * 'Vitamin D3' components, or 'Vitamin A, RAE' vs 'Vitamin A, IU').
 *
 * Unit policy: only rows whose unit normalizes to the key's STANDARD unit
 * are taken. IU rows (vitamin A/E) are skipped — IU→mcg conversion depends
 * on the vitamer source, so converting would be guessing. Missing rows →
 * absent key (never 0).
 */
const MICRO_NAME_MAP: Record<MicroKey, string[]> = {
  vitaminA: ['vitamin a, rae'],
  vitaminC: ['vitamin c, total ascorbic acid', 'vitamin c'],
  vitaminD: ['vitamin d (d2 + d3)', 'vitamin d'],
  vitaminE: ['vitamin e (alpha-tocopherol)', 'vitamin e'],
  vitaminK: ['vitamin k (phylloquinone)', 'vitamin k'],
  calcium: ['calcium, ca'],
  iron: ['iron, fe'],
  magnesium: ['magnesium, mg'],
  phosphorus: ['phosphorus, p'],
  potassium: ['potassium, k'],
  sodium: ['sodium, na'],
  zinc: ['zinc, zn'],
};

/** Normalize a USDA unitName to 'mg' | 'mcg' | null (null = unusable). */
export function normalizeMicroUnit(unitName: string | undefined): MicroUnit | null {
  if (!unitName) return null;
  // USDA uses UG and occasionally the Greek mu (μg / ΜG) for microgram.
  const u = unitName.trim().toUpperCase().replace(/Μ/g, 'U').replace(/μ/g, 'U');
  if (u === 'MG') return 'mg';
  if (u === 'UG' || u === 'MCG') return 'mcg';
  return null; // IU, G, KCAL etc. — never silently convert
}

/**
 * Extract the tracked micros from a USDA foodNutrients list.
 * Exported for tests.
 */
export function extractUsdaMicros(nutrients: UsdaNutrient[] | undefined): MicroNutrients | null {
  if (!nutrients || nutrients.length === 0) return null;
  const out: MicroNutrients = {};
  for (const key of MICRO_KEYS) {
    const names = MICRO_NAME_MAP[key];
    const wantUnit = MICRO_STANDARD_UNITS[key];
    const row = nutrients.find((n) => {
      const name = n?.nutrientName?.trim().toLowerCase();
      if (!name || !names.includes(name)) return false;
      return normalizeMicroUnit(n?.unitName) === wantUnit;
    });
    const amount = numOrNull(row?.value);
    if (row && amount !== null && amount >= 0) {
      out[key] = { amount, unit: wantUnit };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Normalize one raw USDA food record. Exported for tests. */
export function normalizeUsdaFood(raw: UsdaFoodRaw): UsdaFood | null {
  const fdcId = numOrNull(raw.fdcId);
  const name = raw.description?.trim();
  if (!fdcId || !name) return null;
  const nutrients = raw.foodNutrients ?? [];
  const servingSize = numOrNull(raw.servingSize);
  const servingUnit = raw.servingSizeUnit?.trim() || null;
  return {
    id: `usda-${fdcId}`,
    name,
    brand: raw.brandOwner?.trim() || raw.brandName?.trim() || null,
    // Fall back to a 100 g basis when the record has no serving size.
    servingSize: servingSize ?? 100,
    servingUnit: servingSize ? servingUnit ?? 'g' : 'g',
    kcal: pickNutrient(nutrients, isEnergy, true),
    proteinG: pickNutrient(nutrients, isProtein),
    carbsG: pickNutrient(nutrients, isCarb),
    fatG: pickNutrient(nutrients, isFat),
    fiberG: pickNutrient(nutrients, isFiber),
    micros: extractUsdaMicros(nutrients),
    source: 'USDA',
    sourceNote: 'USDA FoodData Central',
    verification: 'estimate',
    verificationBasis: 'USDA FoodData Central — authoritative reference values',
  };
}

/** Search USDA FoodData Central. Throws friendly errors; never returns fake data. */
export async function searchUsdaFoods(query: string, limit = 12): Promise<UsdaFood[]> {
  const apiKey = process.env.USDA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('USDA search is not configured — add a free USDA_API_KEY to enable it.');
  }
  const q = query.trim().slice(0, 120);
  if (!q) throw new Error('Search query must not be empty.');

  const params = new URLSearchParams({
    api_key: apiKey,
    query: q,
    dataType: 'SR Legacy,Survey,Foundation,Branded',
    pageSize: String(Math.min(Math.max(limit, 1), 25)),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${USDA_BASE}/foods/search?${params.toString()}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FitFusionAI/1.0 (nutrition lookup)' },
    });
  } catch (e) {
    throw new Error(
      e instanceof Error && e.name === 'AbortError'
        ? 'USDA search timed out — try again.'
        : 'Could not reach USDA FoodData Central — check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new Error('USDA rejected the API key — check USDA_API_KEY.');
    }
    if (res.status === 429) {
      throw new Error('USDA rate limit reached — try again in a minute.');
    }
    throw new Error('USDA FoodData Central is temporarily unavailable — try again later.');
  }

  const body = (await res.json()) as { foods?: UsdaFoodRaw[] };
  const foods = Array.isArray(body.foods) ? body.foods : [];
  const out: UsdaFood[] = [];
  for (const raw of foods) {
    const n = normalizeUsdaFood(raw);
    if (n) out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}
