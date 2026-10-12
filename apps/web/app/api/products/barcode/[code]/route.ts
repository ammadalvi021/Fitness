import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk } from '@/lib/server-api';
import { isValidBarcode, lookupBarcode } from '@/lib/openfoodfacts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/products/barcode/[code]
 * Look up a packaged product by barcode via Open Food Facts (7-day cache).
 * Response: { found, product?: { ... } } | { found: false, message }.
 * The product carries `verification: 'estimate'` — OFF is crowdsourced
 * third-party data, never manufacturer-verified.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const code = params.code ?? '';
  if (!isValidBarcode(code)) {
    return apiError('validation_error', 'Barcode must be 8–14 digits', 400);
  }

  const result = await lookupBarcode(code);
  if (!result.found) {
    // Honest not-found: never claim a lookup succeeded when it did not.
    return apiOk({ found: false as const, message: result.message });
  }

  const p = result.product;
  return apiOk({
    found: true as const,
    product: {
      ...p,
      verification: 'estimate' as const,
      verificationBasis: 'Open Food Facts — crowdsourced third-party data, not manufacturer-verified',
      attribution: '© Open Food Facts contributors',
    },
  });
}
