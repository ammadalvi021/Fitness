import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, clampInt } from '@/lib/server-api';
import { searchProducts } from '@/lib/openfoodfacts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/products/search?q=&page=
 * Text search across Open Food Facts products (for users with no barcode).
 * Response: { products: [...], page, totalPages, total }.
 */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) {
    return apiError('validation_error', 'Query parameter "q" is required', 400);
  }
  const page = clampInt(req.nextUrl.searchParams.get('page'), 1, 1, 50);

  try {
    const result = await searchProducts(q, page);
    return apiOk({
      products: result.products.map((p) => ({
        ...p,
        verification: 'estimate' as const,
        verificationBasis: 'Open Food Facts — crowdsourced third-party data, not manufacturer-verified',
        attribution: '© Open Food Facts contributors',
      })),
      page: result.page,
      totalPages: result.totalPages,
      total: result.total,
    });
  } catch (e) {
    return apiError(
      'upstream_error',
      e instanceof Error ? e.message : 'Product search failed',
      502,
    );
  }
}
