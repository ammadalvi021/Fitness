/**
 * Open Food Facts (OFF) adapter — server-side only.
 *
 * Compliance summary (full detail in docs/openfoodfacts.md):
 * - Data is crowdsourced third-party data, NOT manufacturer-verified.
 *   Everything we surface is labeled `verification: 'estimate'` with a
 *   third-party-data basis, and the UI must show attribution.
 * - Database is under the Open Database License (ODbL): attribution
 *   required, share-alike applies when redistributing combined data.
 * - Product images are under CC BY-SA 3.0: we hotlink OFF's own image URLs
 *   and attribute each image to "© Open Food Facts contributors".
 * - API etiquette: identifying User-Agent on every request, timeouts,
 *   short-lived operational cache (7-day TTL) to avoid repeated polling.
 *
 * NEVER fabricate nutrition: when OFF has no values we return nulls and
 * quality 'minimal' — the UI shows "no nutrition data", never guesses.
 */

import { prisma } from '@fitfusion/db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Identifying User-Agent required by OFF's API usage conditions. */
export const OFF_USER_AGENT =
  'FitFusionAI/1.0 (contact: support@fitfusion.ai; +https://fitfusion.ai)';

export const OFF_BASE = 'https://world.openfoodfacts.org';

/** Short-lived operational cache TTL: 7 days. */
export const OFF_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 12_000;

/** Attribution string required on every surface showing OFF data or images. */
export const OFF_ATTRIBUTION = '© Open Food Facts contributors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OffNutrients {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  saltG: number | null;
}

export type OffQuality = 'complete' | 'partial' | 'minimal';

export interface NormalizedProduct {
  barcode: string;
  name: string;
  brand: string | null;
  /** Hotlinked OFF image URL (CC BY-SA, attributed in UI). Null when absent. */
  imageUrl: string | null;
  /** Raw pack quantity string from OFF, e.g. "250 g". */
  packSize: string | null;
  /** Pack quantity parsed to grams where possible (null otherwise). */
  packGrams: number | null;
  /** Serving size parsed to grams where possible (null otherwise). */
  servingSize: number | null;
  /** Serving unit: 'g' when grams were parsed, otherwise the raw unit. */
  servingUnit: string | null;
  /** Nutrients per serving. Nulls when OFF has no per-serving data. */
  perServing: OffNutrients | null;
  /** Nutrients per 100 g. Nulls when OFF has no per-100g data. */
  per100g: OffNutrients | null;
  ingredients: string | null;
  allergens: string[];
  /** Eco-Score grade (a–e) when present. Display only — no health claims. */
  ecoscore: string | null;
  /** Nutri-Score grade (a–e) when present. Display only — no health claims. */
  nutriscore: string | null;
  dataSource: 'openfoodfacts';
  lastChecked: string;
  /**
   * Data completeness:
   * - complete: OFF supplied native per-serving nutrition.
   * - partial: per-serving derived from per-100g × serving size, or only per-100g.
   * - minimal: no usable nutrition numbers at all.
   */
  quality: OffQuality;
  /** True when perServing was derived from per100g (an extra estimation layer). */
  derivedPerServing: boolean;
}

export type BarcodeLookupResult =
  | { found: true; product: NormalizedProduct }
  | { found: false; message: string };

export interface OffSearchResult {
  products: NormalizedProduct[];
  page: number;
  totalPages: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Barcode validation
// ---------------------------------------------------------------------------

/** Strip spaces/dashes so users can paste formatted barcodes. */
export function normalizeBarcode(code: string): string {
  return code.replace(/[\s-]/g, '');
}

/** GTIN/EAN barcodes are 8–14 digits (UPC-A 12, EAN-13 13, etc.). */
export function isValidBarcode(code: string): boolean {
  return /^[0-9]{8,14}$/.test(normalizeBarcode(code));
}

// ---------------------------------------------------------------------------
// Quantity parsing helpers (pure, unit-tested)
// ---------------------------------------------------------------------------

const UNIT_TO_G: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  lb: 453.592,
  // ml/l of foods are not exactly grams; treat as approximate only when the
  // caller asked for grams. OFF commonly reports drink sizes in ml.
  ml: 1,
  l: 1000,
};

/**
 * Parse a quantity string like "30 g", "2 biscuits (25 g)", "250g",
 * "1.5 l" to grams. Returns null when no parseable weight/volume exists.
 */
export function parseQuantityToGrams(text: string | null | undefined): number | null {
  if (!text) return null;
  // Prefer the LAST number+unit pair (e.g. "2 biscuits (25 g)" → 25 g).
  const matches = [...text.matchAll(/([\d]+(?:[.,]\d+)?)\s*([a-zA-Z]+)/g)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const amount = parseFloat(matches[i][1].replace(',', '.'));
    const unit = matches[i][2].toLowerCase();
    const factor = UNIT_TO_G[unit];
    if (Number.isFinite(amount) && amount > 0 && factor) {
      return amount * factor;
    }
  }
  return null;
}

/** Round nutrient values to 2 decimals for display/storage. */
export function round2(n: number | null): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Scale every nutrient field by a factor (pure math, unit-tested). */
export function scaleNutrients(n: OffNutrients, factor: number): OffNutrients {
  const s = (v: number | null) =>
    v === null ? null : round2(v * factor);
  return {
    kcal: s(n.kcal),
    proteinG: s(n.proteinG),
    carbsG: s(n.carbsG),
    fatG: s(n.fatG),
    fiberG: s(n.fiberG),
    sugarG: s(n.sugarG),
    saltG: s(n.saltG),
  };
}

// ---------------------------------------------------------------------------
// Normalizer (pure, unit-tested)
// ---------------------------------------------------------------------------

interface OffRawProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  serving_size?: string;
  nutriments?: Record<string, unknown>;
  ingredients_text?: string;
  ingredients_text_en?: string;
  allergens?: string;
  allergens_tags?: string[];
  ecoscore_grade?: string;
  nutriscore_grade?: string;
  image_front_small_url?: string;
  image_front_url?: string;
  image_url?: string;
}

const NUTRIMENT_KEYS: Record<keyof OffNutrients, string> = {
  kcal: 'energy-kcal',
  proteinG: 'proteins',
  carbsG: 'carbohydrates',
  fatG: 'fat',
  fiberG: 'fiber',
  sugarG: 'sugars',
  saltG: 'salt',
};

function readNutriment(
  nutriments: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (!nutriments) return null;
  const raw = nutriments[key];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function buildNutrients(
  nutriments: Record<string, unknown> | undefined,
  suffix: '_serving' | '_100g',
): OffNutrients | null {
  if (!nutriments) return null;
  const out = {} as OffNutrients;
  let anyPresent = false;
  (Object.keys(NUTRIMENT_KEYS) as (keyof OffNutrients)[]).forEach((field) => {
    const v = readNutriment(nutriments, `${NUTRIMENT_KEYS[field]}${suffix}`);
    out[field] = v;
    if (v !== null) anyPresent = true;
  });
  return anyPresent ? out : null;
}

function humanizeTag(tag: string): string {
  return tag
    .replace(/^[a-z]{2}:/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeImageUrl(p: OffRawProduct): string | null {
  const url = p.image_front_small_url || p.image_front_url || p.image_url;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}

/**
 * Normalize raw OFF product JSON to our shape. Pure function — no I/O.
 * When `fetchedAt` is provided it is used for `lastChecked`.
 */
export function normalizeOffProduct(
  barcode: string,
  raw: OffRawProduct,
  fetchedAt?: Date,
): NormalizedProduct {
  const name =
    (raw.product_name || '').trim() ||
    (raw.product_name_en || '').trim() ||
    (raw.generic_name || '').trim() ||
    'Unknown product';
  const brand = (raw.brands || '').split(',').map((b) => b.trim()).filter(Boolean)[0] ?? null;

  const packSize = (raw.quantity || '').trim() || null;
  const packGrams = parseQuantityToGrams(packSize);
  const servingSize = parseQuantityToGrams(raw.serving_size);
  const servingUnit = servingSize !== null ? 'g' : ((raw.serving_size || '').trim() || null);

  const perServingNative = buildNutrients(raw.nutriments, '_serving');
  const per100g = buildNutrients(raw.nutriments, '_100g');

  // Derive per-serving from per-100g when OFF has serving size but no
  // per-serving nutriments — still an estimate, flagged as derived.
  let perServing = perServingNative;
  let derivedPerServing = false;
  if (!perServing && per100g && servingSize !== null && servingSize > 0) {
    perServing = scaleNutrients(per100g, servingSize / 100);
    derivedPerServing = true;
  }

  const hasServingKcal = perServingNative?.kcal !== null && perServingNative?.kcal !== undefined;
  const hasAnyKcal =
    (perServing?.kcal ?? null) !== null || (per100g?.kcal ?? null) !== null;
  const quality: OffQuality = hasServingKcal && !derivedPerServing
    ? 'complete'
    : hasAnyKcal
      ? 'partial'
      : 'minimal';

  const allergens: string[] = Array.isArray(raw.allergens_tags)
    ? [...new Set(raw.allergens_tags.map(humanizeTag))].filter(Boolean)
    : [];

  return {
    barcode,
    name,
    brand,
    imageUrl: safeImageUrl(raw),
    packSize,
    packGrams: packGrams !== null ? round2(packGrams) : null,
    servingSize: servingSize !== null ? round2(servingSize) : null,
    servingUnit,
    perServing,
    per100g,
    ingredients:
      (raw.ingredients_text_en || raw.ingredients_text || '').trim() || null,
    allergens,
    ecoscore: (raw.ecoscore_grade || '').trim().toLowerCase() || null,
    nutriscore: (raw.nutriscore_grade || '').trim().toLowerCase() || null,
    dataSource: 'openfoodfacts',
    lastChecked: (fetchedAt ?? new Date()).toISOString(),
    quality,
    derivedPerServing,
  };
}

// ---------------------------------------------------------------------------
// OFF HTTP layer
// ---------------------------------------------------------------------------

async function offFetch(path: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${OFF_BASE}${path}`, {
      method: 'GET',
      headers: {
        'User-Agent': OFF_USER_AGENT,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/** True when a cached payload is still within the TTL window. */
export function cacheIsFresh(fetchedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() < OFF_CACHE_TTL_MS;
}

async function getCachedProduct(barcode: string): Promise<NormalizedProduct | null> {
  const row = await prisma.cachedProduct.findUnique({ where: { id: barcode } });
  if (!row) return null;
  if (!cacheIsFresh(row.fetchedAt)) return null;
  return normalizeOffProduct(barcode, row.payload as unknown as OffRawProduct, row.fetchedAt);
}

async function putCachedProduct(barcode: string, rawProduct: OffRawProduct): Promise<void> {
  await prisma.cachedProduct.upsert({
    where: { id: barcode },
    create: { id: barcode, provider: 'openfoodfacts', payload: rawProduct as object },
    update: { provider: 'openfoodfacts', payload: rawProduct as object, fetchedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a product by barcode. Checks the 7-day cache first, then OFF.
 * Never fabricates data: `found: false` when OFF says 404/status 0, when the
 * barcode is invalid, or when the network call fails.
 */
export async function lookupBarcode(code: string): Promise<BarcodeLookupResult> {
  const barcode = normalizeBarcode(code);
  if (!isValidBarcode(code)) {
    return { found: false, message: 'Invalid barcode — it must be 8–14 digits.' };
  }

  const cached = await getCachedProduct(barcode);
  if (cached) return { found: true, product: cached };

  let res: Response;
  try {
    res = await offFetch(`/api/v2/product/${barcode}.json`);
  } catch {
    return { found: false, message: 'Could not reach Open Food Facts — check your connection and try again.' };
  }

  if (res.status === 404) {
    return { found: false, message: 'No product found for this barcode.' };
  }
  if (!res.ok) {
    return { found: false, message: 'Open Food Facts is temporarily unavailable — try again later.' };
  }

  const body = (await res.json()) as { status?: number; product?: OffRawProduct };
  if (body?.status !== 1 || !body.product) {
    return { found: false, message: 'No product found for this barcode.' };
  }

  await putCachedProduct(barcode, body.product);
  return { found: true, product: normalizeOffProduct(barcode, body.product) };
}

/**
 * Text search across OFF products (for users who have no barcode).
 * Page is 1-based; results are normalized but not deep-cached.
 */
export async function searchProducts(q: string, page = 1): Promise<OffSearchResult> {
  const query = q.trim().slice(0, 120);
  if (!query) throw new Error('Search query must not be empty.');
  const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), 50);

  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '20',
    page: String(safePage),
  });
  let res: Response;
  try {
    res = await offFetch(`/cgi/search.pl?${params.toString()}`);
  } catch {
    throw new Error('Could not reach Open Food Facts — check your connection and try again.');
  }
  if (!res.ok) {
    throw new Error('Open Food Facts is temporarily unavailable — try again later.');
  }
  const body = (await res.json()) as {
    products?: OffRawProduct[];
    page?: number;
    page_size?: number;
    count?: number;
  };
  const products = (body.products ?? []).map((p) =>
    normalizeOffProduct(normalizeBarcode(String(p.code ?? '')), p),
  );
  const total = typeof body.count === 'number' ? body.count : products.length;
  const pageSize = typeof body.page_size === 'number' && body.page_size > 0 ? body.page_size : 20;
  return {
    products,
    page: safePage,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    total,
  };
}
