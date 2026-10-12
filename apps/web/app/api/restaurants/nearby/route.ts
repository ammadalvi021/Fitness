import { NextRequest, NextResponse } from 'next/server';
import { prisma, type Restaurant } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk } from '@/lib/server-api';
import { getPlacesProvider } from '@/lib/places';
import { MAX_CITY_LEN, MAX_Q_LEN, parseLatLng, parseRadiusKm } from '@/lib/places/params';
import { RADIUS_OPTIONS_KM, type PlaceResult } from '@/lib/places/types';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function toResponse(r: Restaurant) {
  return {
    id: r.id,
    provider: r.provider,
    name: r.name,
    address: r.address,
    city: r.city,
    country: r.country,
    latitude: r.latitude,
    longitude: r.longitude,
    rating: r.rating,
    priceLevel: r.priceLevel,
    website: r.website,
    menuUrl: r.menuUrl,
  };
}

async function cachePlaces(places: PlaceResult[]): Promise<Restaurant[]> {
  const rows: Restaurant[] = [];
  for (const p of places) {
    if (!p.id) continue; // Cannot key the cache without a provider place id.
    const data = {
      provider: 'google_places',
      name: p.name,
      address: p.address,
      city: p.city,
      country: p.country,
      latitude: p.latitude,
      longitude: p.longitude,
      rating: p.rating,
      priceLevel: p.priceLevel,
      website: p.website,
      menuUrl: p.menuUrl,
      lastCheckedAt: new Date(),
    };
    rows.push(
      await prisma.restaurant.upsert({
        where: { providerPlaceId: p.id },
        update: data,
        create: { ...data, providerPlaceId: p.id },
      }),
    );
  }
  return rows;
}

async function manualMatches(q: string, city: string): Promise<Restaurant[]> {
  const clauses = [];
  if (q) {
    clauses.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { address: { contains: q, mode: 'insensitive' as const } },
      ],
    });
  }
  if (city) clauses.push({ city: { contains: city, mode: 'insensitive' as const } });
  if (clauses.length === 0) {
    return prisma.restaurant.findMany({
      where: { provider: 'manual' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
  return prisma.restaurant.findMany({
    where: { provider: 'manual', AND: clauses },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

/**
 * GET /api/restaurants/nearby?lat=&lng=&radius=(1|3|5|10)&q=&city=
 *
 * - Provider configured + coordinates -> Google Nearby Search, cached in DB.
 * - Provider configured + city/query only -> Google Text Search.
 * - Provider NOT configured -> { configured:false } plus any manually-added
 *   restaurants, so the feature stays useful without a key.
 * Precise coordinates are used for the search only and never persisted to
 * the user's profile.
 */
export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const rl = checkRateLimit(`restaurants:nearby:${s.user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return apiError('rate_limited', 'Too many requests — please wait a moment.', 429);
  }

  const sp = req.nextUrl.searchParams;
  const radiusKm = parseRadiusKm(sp.get('radius'));
  if (radiusKm === null) {
    return apiError(
      'invalid_radius',
      `radius must be one of: ${RADIUS_OPTIONS_KM.join(', ')} (km)`,
      400,
    );
  }
  const lat = parseLatLng(sp.get('lat'), -90, 90);
  const lng = parseLatLng(sp.get('lng'), -180, 180);
  if (lat === 'invalid' || lng === 'invalid') {
    return apiError('invalid_location', 'lat must be -90..90 and lng -180..180', 400);
  }
  const q = (sp.get('q') ?? '').trim().slice(0, MAX_Q_LEN);
  const city = (sp.get('city') ?? '').trim().slice(0, MAX_CITY_LEN);

  const provider = getPlacesProvider();
  if (!provider) {
    // Unconfigured: honest setup signal + manual entries only.
    const manual = await manualMatches(q, city);
    return apiOk({ configured: false, restaurants: manual.map(toResponse) });
  }

  const hasCoords = lat !== null && lng !== null;
  if (!hasCoords && !q && !city) {
    return apiError(
      'location_required',
      'Provide lat+lng, a city, or a search term to find restaurants.',
      400,
    );
  }

  let places: PlaceResult[];
  try {
    places = await provider.nearby({
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      radiusM: radiusKm * 1000,
      query: q || undefined,
      city: city || undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Places provider error';
    return apiError('provider_error', msg, 502);
  }

  // searchNearby has no text-query support: fold the name/cuisine hint in
  // post-hoc so "desi" doesn't silently return everything.
  if (hasCoords && q) {
    const needle = q.toLowerCase();
    places = places.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.address ?? '').toLowerCase().includes(needle),
    );
  }

  const cached = await cachePlaces(places);
  const manual = await manualMatches(q, city);
  const seen = new Set(cached.map((r) => r.id));
  const merged = [...cached, ...manual.filter((r) => !seen.has(r.id))];
  return apiOk({ configured: true, restaurants: merged.map(toResponse) });
}
