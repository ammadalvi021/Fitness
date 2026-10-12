import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk } from '@/lib/server-api';
import { getPlacesProvider } from '@/lib/places';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Refresh provider details when the cache is older than this. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function toResponse(r: {
  id: string;
  provider: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  priceLevel: number | null;
  website: string | null;
  menuUrl: string | null;
}) {
  return { ...r };
}

/**
 * GET /api/restaurants/[id] — restaurant details.
 * Served from the DB cache; Google-sourced rows are refreshed from the
 * provider when the cache is older than 24h (cache failure never 500s —
 * the stale row is served instead). Also reports the menu item count so
 * the page can render the Phase D menu section honestly.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const rl = checkRateLimit(`restaurants:details:${s.user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return apiError('rate_limited', 'Too many requests — please wait a moment.', 429);
  }

  let r = await prisma.restaurant.findUnique({ where: { id: params.id } });
  if (!r) return apiError('not_found', 'Restaurant not found', 404);

  const provider = getPlacesProvider();
  const stale =
    !r.lastCheckedAt || Date.now() - r.lastCheckedAt.getTime() > STALE_AFTER_MS;

  // Opening hours / phone are provider-fresh only. One details call serves
  // both the 24h refresh and the hours/phone display (details is a paid SKU).
  let openingHours: string[] | null = null;
  let phone: string | null = null;
  if (provider && r.provider === 'google_places' && r.providerPlaceId) {
    try {
      const d = await provider.details(r.providerPlaceId);
      openingHours = d.openingHours ?? null;
      phone = d.phone ?? null;
      if (stale) {
        r = await prisma.restaurant.update({
          where: { id: r.id },
          data: {
            name: d.name,
            address: d.address,
            city: d.city,
            country: d.country,
            latitude: d.latitude,
            longitude: d.longitude,
            rating: d.rating,
            priceLevel: d.priceLevel,
            website: d.website,
            lastCheckedAt: new Date(),
          },
        });
      }
    } catch {
      // Provider call failed: serve the cached row rather than failing.
    }
  }

  const menuCount = await prisma.restaurantMenuItem.count({
    where: { restaurantId: r.id },
  });

  return apiOk({
    restaurant: toResponse(r),
    details: { openingHours, phone },
    menu: { count: menuCount },
  });
}
