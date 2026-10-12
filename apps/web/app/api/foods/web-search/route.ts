/**
 * GET /api/foods/web-search?q=...
 *
 * Unified internet food search: USDA FoodData Central (when USDA_API_KEY is
 * configured) + Open Food Facts text search (no key needed), queried in
 * parallel, merged, deduped, capped. Every result is honestly labeled
 * verification='estimate' with its basis — nothing is ever fabricated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk } from '@/lib/server-api';
import { checkRateLimit } from '@/lib/rate-limit';
import { isUsdaConfigured, searchUsdaFoods, type UsdaFood } from '@/lib/usda';
import { searchProducts, type NormalizedProduct } from '@/lib/openfoodfacts';

export const dynamic = 'force-dynamic';

export interface WebFoodResult {
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
  source: 'USDA' | 'Open Food Facts';
  sourceNote: string;
  verification: 'estimate';
  verificationBasis: string;
}

function fromUsda(f: UsdaFood): WebFoodResult {
  return {
    id: f.id,
    name: f.name,
    brand: f.brand,
    servingSize: f.servingSize,
    servingUnit: f.servingUnit,
    kcal: f.kcal,
    proteinG: f.proteinG,
    carbsG: f.carbsG,
    fatG: f.fatG,
    fiberG: f.fiberG,
    source: 'USDA',
    sourceNote: f.sourceNote,
    verification: 'estimate',
    verificationBasis: f.verificationBasis,
  };
}

function fromOff(p: NormalizedProduct): WebFoodResult | null {
  // Prefer per-serving nutrients; fall back to per-100g. Skip products with
  // no usable kcal at all — never invent numbers.
  const n = p.perServing ?? p.per100g;
  if (!n || n.kcal == null) return null;
  const perServing = Boolean(p.perServing);
  return {
    id: `off-${p.barcode || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    name: p.name,
    brand: p.brand,
    servingSize: p.servingSize,
    servingUnit: p.servingUnit,
    kcal: n.kcal,
    proteinG: n.proteinG,
    carbsG: n.carbsG,
    fatG: n.fatG,
    fiberG: n.fiberG,
    source: 'Open Food Facts',
    sourceNote: `Open Food Facts (crowdsourced${perServing ? '' : '; per-100g values'})`,
    verification: 'estimate',
    verificationBasis: 'Open Food Facts — crowdsourced product data',
  };
}

/** Dedupe key: normalized name + brand. */
function dedupeKey(r: WebFoodResult): string {
  const norm = (s: string | null) =>
    (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(r.name)}|${norm(r.brand)}`;
}

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 120) ?? '';
  if (!q) {
    return apiError('validation_error', 'Query parameter "q" is required.', 400);
  }

  const rl = checkRateLimit(`foods:web-search:${s.user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return apiError('rate_limited', 'Too many web searches — try again shortly.', 429);
  }

  // Query both sources in parallel. A failing source contributes nothing —
  // never an invented fallback. allSettled lets us distinguish "source
  // failed" (→ 502 when nothing works) from "source returned nothing".
  const [usdaSettled, offSettled] = await Promise.allSettled([
    isUsdaConfigured() ? searchUsdaFoods(q, 10) : Promise.resolve([]),
    searchProducts(q).then((r) => r.products),
  ]);

  const usdaOk = usdaSettled.status === 'fulfilled';
  const offOk = offSettled.status === 'fulfilled';
  const usdaFoods = usdaOk ? usdaSettled.value : [];
  const offProducts = offOk ? offSettled.value : [];

  // No working source at all: say so plainly instead of an empty list.
  if (!offOk && !(isUsdaConfigured() && usdaOk)) {
    return apiError(
      'upstream_unavailable',
      'Web search is unavailable right now — try again later or use the Manual tab.',
      502,
    );
  }

  const merged: WebFoodResult[] = [];
  const seen = new Set<string>();
  // USDA first (authoritative reference), then Open Food Facts.
  for (const f of usdaFoods.map(fromUsda)) {
    const k = dedupeKey(f);
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(f);
    }
  }
  for (const p of offProducts) {
    const f = fromOff(p);
    if (!f) continue;
    const k = dedupeKey(f);
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(f);
    }
  }

  return apiOk({
    query: q,
    results: merged.slice(0, 15),
    sources: { usda: isUsdaConfigured() && usdaOk, openFoodFacts: offOk },
  });
}
