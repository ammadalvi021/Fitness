/**
 * Phase C — Restaurant Discovery tests.
 *
 * - Adapter interface: unconfigured -> null (never fake results).
 * - Google adapter: HTTP is mocked; field masks tight; mapping correct.
 * - Nearby param validation: radius whitelist, lat/lng ranges.
 * - Geolocation-denied fallback: pure function, no DOM.
 * - Manual restaurant creation: 201 + provider 'manual'; 400 on bad input.
 * - No-leak: API responses never contain the Places API key.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { GET as nearbyGET } from '@/app/api/restaurants/nearby/route';
import { parseLatLng, parseRadiusKm } from '@/lib/places/params';
import { POST as createPOST } from '@/app/api/restaurants/route';
import { GET as detailsGET } from '@/app/api/restaurants/[id]/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';
import { getPlacesProvider, resetPlacesProviderCache } from '@/lib/places';
import { GooglePlacesProvider } from '@/lib/places/google';
import { resolveLocationSource } from '@/lib/places/geo';
import { resetRateLimits } from '@/lib/rate-limit';

/* ------------------------------ env control ------------------------------ */

const envStack: Array<Record<string, string | undefined>> = [];
function pushEnv(vars: Record<string, string | undefined>) {
  envStack.push(Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]])));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  while (envStack.length) {
    const snap = envStack.pop()!;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  resetPlacesProviderCache();
  resetRateLimits();
});
afterAll(cleanupUsers);

const TEST_PREFIX = 'ff-test-rest-';

beforeEach(async () => {
  await prisma.restaurant.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
});
afterAll(async () => {
  await prisma.restaurant.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
});

/* ------------------------------ fetch mocking ----------------------------- */

interface SeenRequest {
  url: string;
  init: RequestInit;
}
function stubFetch(handler: (seen: SeenRequest) => { status: number; body: unknown }) {
  const seen: SeenRequest[] = [];
  const realFetch = globalThis.fetch;
  const stub = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const s = { url, init };
    seen.push(s);
    const { status, body } = handler(s);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  (globalThis as { fetch: typeof fetch }).fetch = stub as typeof fetch;
  return {
    seen,
    restore() {
      (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    },
  };
}

const GOOGLE_PLACE = {
  id: 'ChIJTestPlace123',
  displayName: { text: `${TEST_PREFIX}Biryani House`, languageCode: 'en' },
  formattedAddress: '12 Food Street, Lahore, Punjab, Pakistan',
  location: { latitude: 31.5204, longitude: 74.3587 },
  rating: 4.3,
  priceLevel: 'PRICE_LEVEL_MODERATE',
  websiteUri: 'https://example.com/biryani',
  addressComponents: [
    { longText: 'Lahore', shortText: 'LHR', types: ['locality', 'political'] },
    { longText: 'Pakistan', shortText: 'PK', types: ['country', 'political'] },
  ],
};

/* --------------------------------- tests ---------------------------------- */

describe('places provider registry', () => {
  it('returns null when no API key is configured (never fake results)', () => {
    pushEnv({ GOOGLE_PLACES_API_KEY: undefined });
    resetPlacesProviderCache();
    expect(getPlacesProvider()).toBeNull();
  });

  it('returns the Google provider when the key is present', () => {
    pushEnv({ GOOGLE_PLACES_API_KEY: 'test-key' });
    resetPlacesProviderCache();
    const p = getPlacesProvider();
    expect(p).not.toBeNull();
    expect(p!.name).toBe('google_places');
    expect(p!.isConfigured()).toBe(true);
  });
});

describe('GooglePlacesProvider (mocked HTTP)', () => {
  beforeEach(() => {
    pushEnv({ GOOGLE_PLACES_API_KEY: 'test-key-present' });
  });

  it('maps searchNearby results and sends a tight field mask', async () => {
    const { seen, restore } = stubFetch(() => ({ status: 200, body: { places: [GOOGLE_PLACE] } }));
    try {
      const provider = new GooglePlacesProvider();
      const places = await provider.nearby({ lat: 31.5, lng: 74.3, radiusM: 3000 });
      expect(places).toHaveLength(1);
      const p = places[0];
      expect(p.id).toBe('ChIJTestPlace123');
      expect(p.name).toBe(`${TEST_PREFIX}Biryani House`);
      expect(p.rating).toBe(4.3);
      expect(p.priceLevel).toBe(2); // PRICE_LEVEL_MODERATE
      expect(p.city).toBe('Lahore');
      expect(p.country).toBe('Pakistan');
      expect(p.website).toBe('https://example.com/biryani');
      expect(p.menuUrl).toBeNull();

      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe('https://places.googleapis.com/v1/places:searchNearby');
      const headers = seen[0].init.headers as Record<string, string>;
      expect(headers['X-Goog-Api-Key']).toBe('test-key-present');
      const mask = headers['X-Goog-FieldMask'] as string;
      for (const f of ['places.id', 'places.displayName', 'places.rating', 'places.priceLevel']) {
        expect(mask).toContain(f);
      }
      expect(mask).not.toContain('*'); // never a wildcard mask
      const body = JSON.parse(seen[0].init.body as string);
      expect(body.includedTypes).toEqual(['restaurant']);
      expect(body.locationRestriction.circle.radius).toBe(3000);
    } finally {
      restore();
    }
  });

  it('returns [] without any HTTP call when there is nothing to search', async () => {
    const { seen, restore } = stubFetch(() => ({ status: 200, body: { places: [GOOGLE_PLACE] } }));
    try {
      const provider = new GooglePlacesProvider();
      expect(await provider.nearby({ radiusM: 3000 })).toEqual([]);
      expect(seen).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('details() maps opening hours and phone', async () => {
    const { seen, restore } = stubFetch(() => ({
      status: 200,
      body: {
        ...GOOGLE_PLACE,
        nationalPhoneNumber: '+92 42 1234567',
        regularOpeningHours: { weekdayDescriptions: ['Monday: 12:00 – 23:00'] },
      },
    }));
    try {
      const provider = new GooglePlacesProvider();
      const d = await provider.details('ChIJTestPlace123');
      expect(d.openingHours).toEqual(['Monday: 12:00 – 23:00']);
      expect(d.phone).toBe('+92 42 1234567');
      expect(seen[0].url).toBe('https://places.googleapis.com/v1/places/ChIJTestPlace123');
    } finally {
      restore();
    }
  });

  it('surfaces provider errors instead of inventing data', async () => {
    const { restore } = stubFetch(() => ({
      status: 403,
      body: { error: { message: 'API key not valid' } },
    }));
    try {
      const provider = new GooglePlacesProvider();
      await expect(provider.nearby({ lat: 1, lng: 1, radiusM: 1000 })).rejects.toThrow(
        'API key not valid',
      );
    } finally {
      restore();
    }
  });
});

describe('nearby param validation', () => {
  it('radius whitelist: only 1|3|5|10 accepted, default 3', () => {
    expect(parseRadiusKm(null)).toBe(3);
    expect(parseRadiusKm('')).toBe(3);
    expect(parseRadiusKm('3')).toBe(3);
    expect(parseRadiusKm('10')).toBe(10);
    expect(parseRadiusKm('7')).toBeNull();
    expect(parseRadiusKm('2')).toBeNull();
    expect(parseRadiusKm('abc')).toBeNull();
    expect(parseRadiusKm('3.5')).toBeNull();
  });

  it('lat/lng ranges enforced', () => {
    expect(parseLatLng(null, -90, 90)).toBeNull();
    expect(parseLatLng('31.5', -90, 90)).toBe(31.5);
    expect(parseLatLng('-90', -90, 90)).toBe(-90);
    expect(parseLatLng('91', -90, 90)).toBe('invalid');
    expect(parseLatLng('-91', -90, 90)).toBe('invalid');
    expect(parseLatLng('181', -180, 180)).toBe('invalid');
    expect(parseLatLng('abc', -180, 180)).toBe('invalid');
  });
});

describe('geolocation fallback (pure function)', () => {
  it('uses granted coordinates', () => {
    expect(resolveLocationSource({ status: 'granted', lat: 31.5, lng: 74.3 }, '')).toEqual({
      mode: 'coords',
      lat: 31.5,
      lng: 74.3,
    });
  });

  it('denied -> falls back to the typed city with an honest notice', () => {
    const src = resolveLocationSource({ status: 'denied' }, 'Lahore');
    expect(src.mode).toBe('city');
    if (src.mode === 'city') {
      expect(src.city).toBe('Lahore');
      expect(src.notice).toMatch(/denied/i);
      expect(src.notice).toContain('Lahore');
    }
  });

  it('denied with no city -> no source + guidance', () => {
    const src = resolveLocationSource({ status: 'denied' }, '  ');
    expect(src.mode).toBe('none');
    if (src.mode === 'none') expect(src.notice).toMatch(/city/i);
  });

  it('unavailable -> city fallback', () => {
    const src = resolveLocationSource({ status: 'unavailable' }, 'Karachi');
    expect(src.mode).toBe('city');
    if (src.mode === 'city') expect(src.notice).toMatch(/unavailable/i);
  });

  it('no geolocation attempt yet -> prompts for location or city', () => {
    const src = resolveLocationSource(null, '');
    expect(src.mode).toBe('none');
    if (src.mode === 'none') expect(src.notice).toMatch(/Use my location/i);
  });
});

describe('GET /api/restaurants/nearby', () => {
  it('401 when unauthenticated', async () => {
    const res = await nearbyGET(jsonRequest('http://localhost/api/restaurants/nearby', 'GET'));
    expect(res.status).toBe(401);
  });

  it('rejects off-whitelist radius and out-of-range coords', async () => {
    const { token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail(), 'Testpass123!');
    const badRadius = await nearbyGET(
      authed(jsonRequest('http://localhost/api/restaurants/nearby?radius=7&city=Lahore', 'GET'), token),
    );
    expect(badRadius.status).toBe(400);
    expect((await readJson(badRadius)).error.code).toBe('invalid_radius');

    const badLat = await nearbyGET(
      authed(jsonRequest('http://localhost/api/restaurants/nearby?lat=91&lng=74', 'GET'), token),
    );
    expect(badLat.status).toBe(400);
    expect((await readJson(badLat)).error.code).toBe('invalid_location');
  });

  it('unconfigured -> {configured:false} plus manual restaurants, no provider call', async () => {
    pushEnv({ GOOGLE_PLACES_API_KEY: undefined });
    resetPlacesProviderCache();
    const { token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail(), 'Testpass123!');
    await prisma.restaurant.create({
      data: {
        provider: 'manual',
        name: `${TEST_PREFIX}Manual Diner`,
        city: 'Lahore',
        address: '1 Test Road',
      },
    });
    const res = await nearbyGET(
      authed(jsonRequest('http://localhost/api/restaurants/nearby?city=Lahore', 'GET'), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.configured).toBe(false);
    expect(body.restaurants.some((r: { name: string }) => r.name === `${TEST_PREFIX}Manual Diner`)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('GOOGLE_PLACES_API_KEY');
  });

  it('configured -> caches Google results keyed by providerPlaceId', async () => {
    pushEnv({ GOOGLE_PLACES_API_KEY: 'AIzaSENTINEL_DO_NOT_LEAK_12345' });
    const { seen, restore } = stubFetch(() => ({ status: 200, body: { places: [GOOGLE_PLACE] } }));
    try {
      resetPlacesProviderCache();
      const { token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail(), 'Testpass123!');
      const res = await nearbyGET(
        authed(
          jsonRequest('http://localhost/api/restaurants/nearby?lat=31.5&lng=74.3&radius=3', 'GET'),
          token,
        ),
      );
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.configured).toBe(true);
      expect(body.restaurants).toHaveLength(1);
      expect(body.restaurants[0].name).toBe(`${TEST_PREFIX}Biryani House`);
      // Cached in DB keyed by providerPlaceId.
      const cached = await prisma.restaurant.findUnique({
        where: { providerPlaceId: 'ChIJTestPlace123' },
      });
      expect(cached).not.toBeNull();
      expect(cached!.provider).toBe('google_places');
      // Second call reuses the same row (upsert, no duplicates).
      await nearbyGET(
        authed(
          jsonRequest('http://localhost/api/restaurants/nearby?lat=31.5&lng=74.3&radius=3', 'GET'),
          token,
        ),
      );
      const count = await prisma.restaurant.count({
        where: { providerPlaceId: 'ChIJTestPlace123' },
      });
      expect(count).toBe(1);
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it('responses never contain the API key', async () => {
    const SENTINEL = 'AIzaSENTINEL_DO_NOT_LEAK_12345';
    pushEnv({ GOOGLE_PLACES_API_KEY: SENTINEL });
    const { restore } = stubFetch(() => ({ status: 200, body: { places: [GOOGLE_PLACE] } }));
    try {
      resetPlacesProviderCache();
      const { token, userId } = await registerAndLogin(
        registerPOST,
        loginPOST,
        uniqueEmail(),
        'Testpass123!',
      );
      const nearbyRes = await nearbyGET(
        authed(
          jsonRequest('http://localhost/api/restaurants/nearby?lat=31.5&lng=74.3', 'GET'),
          token,
        ),
      );
      const nearbyBody = JSON.stringify(await readJson(nearbyRes));
      expect(nearbyBody).not.toContain(SENTINEL);

      const created = await prisma.restaurant.create({
        data: { provider: 'manual', name: `${TEST_PREFIX}Leak Check`, city: 'Lahore' },
      });
      const detailsRes = await detailsGET(
        authed(jsonRequest(`http://localhost/api/restaurants/${created.id}`, 'GET'), token),
        { params: { id: created.id } },
      );
      const detailsBody = JSON.stringify(await readJson(detailsRes));
      expect(detailsBody).not.toContain(SENTINEL);
      expect(userId).toBeTruthy();
    } finally {
      restore();
    }
  });
});

describe('POST /api/restaurants (manual add)', () => {
  it('401 when unauthenticated', async () => {
    const res = await createPOST(
      jsonRequest('http://localhost/api/restaurants', 'POST', { name: 'X', city: 'Y' }),
    );
    expect(res.status).toBe(401);
  });

  it('creates a manual restaurant with provider "manual"', async () => {
    const { token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail(), 'Testpass123!');
    const res = await createPOST(
      authed(
        jsonRequest('http://localhost/api/restaurants', 'POST', {
          name: `${TEST_PREFIX}Cafe`,
          city: 'Islamabad',
          address: '2 Test Ave',
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.restaurant.provider).toBe('manual');
    expect(body.restaurant.name).toBe(`${TEST_PREFIX}Cafe`);
    expect(body.restaurant.city).toBe('Islamabad');
  });

  it('400 when name or city is missing', async () => {
    const { token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail(), 'Testpass123!');
    const res = await createPOST(
      authed(
        jsonRequest('http://localhost/api/restaurants', 'POST', { name: '   ', city: '' }),
        token,
      ),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('validation_error');
  });
});

describe('GET /api/restaurants/[id]', () => {
  it('404 for unknown id', async () => {
    const { token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail(), 'Testpass123!');
    const res = await detailsGET(
      authed(jsonRequest('http://localhost/api/restaurants/nope', 'GET'), token),
      { params: { id: 'nope' } },
    );
    expect(res.status).toBe(404);
  });

  it('serves the cached row with menu count', async () => {
    pushEnv({ GOOGLE_PLACES_API_KEY: undefined });
    resetPlacesProviderCache();
    const { token } = await registerAndLogin(registerPOST, loginPOST, uniqueEmail(), 'Testpass123!');
    const created = await prisma.restaurant.create({
      data: { provider: 'manual', name: `${TEST_PREFIX}Detail Diner`, city: 'Lahore' },
    });
    const res = await detailsGET(
      authed(jsonRequest(`http://localhost/api/restaurants/${created.id}`, 'GET'), token),
      { params: { id: created.id } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.restaurant.name).toBe(`${TEST_PREFIX}Detail Diner`);
    expect(body.menu.count).toBe(0);
    expect(body.details.openingHours).toBeNull();
  });
});
