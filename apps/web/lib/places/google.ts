/**
 * Phase C — Restaurant Discovery: Google Places API (New) adapter.
 *
 * SERVER-SIDE ONLY. The API key is read from `GOOGLE_PLACES_API_KEY` and is
 * never serialized, returned to clients, or logged. Field masks are kept
 * tight (billing is field-mask driven) and limited to what the UI uses.
 *
 * Endpoints:
 * - Nearby:  POST https://places.googleapis.com/v1/places:searchNearby
 * - Text:    POST https://places.googleapis.com/v1/places:searchText
 * - Details: GET  https://places.googleapis.com/v1/places/{placeId}
 */
import type { PlacesProvider } from './interface';
import type { NearbyParams, PlaceDetails, PlaceResult } from './types';

const PLACES_BASE = 'https://places.googleapis.com/v1';
const ENV_KEY = 'GOOGLE_PLACES_API_KEY';

/** Fields used for nearby/text search results (Pro + Enterprise SKUs kept minimal). */
const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.priceLevel',
  'places.websiteUri',
  'places.addressComponents',
].join(',');

/** Fields used for the place-details call. */
const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'priceLevel',
  'websiteUri',
  'nationalPhoneNumber',
  'regularOpeningHours',
  'addressComponents',
].join(',');

export function getPlacesApiKey(): string | null {
  const key = process.env[ENV_KEY];
  return key && key.trim().length > 0 ? key : null;
}

type FetchImpl = typeof fetch;

interface GooglePlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  priceLevel?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
}

const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Pick city/country out of address components (locality preferred). */
function extractCityCountry(p: GooglePlace): { city: string | null; country: string | null } {
  let city: string | null = null;
  let country: string | null = null;
  for (const c of p.addressComponents ?? []) {
    const types = c.types ?? [];
    if (!city && (types.includes('locality') || types.includes('administrative_area_level_2'))) {
      city = str(c.longText);
    }
    if (!country && types.includes('country')) {
      country = str(c.longText);
    }
  }
  if (!city) {
    for (const c of p.addressComponents ?? []) {
      if ((c.types ?? []).includes('administrative_area_level_1')) {
        city = str(c.longText);
        break;
      }
    }
  }
  return { city, country };
}

function toPlaceResult(p: GooglePlace): PlaceResult {
  const { city, country } = extractCityCountry(p);
  return {
    id: str(p.id),
    name: str(p.displayName?.text) ?? 'Unnamed place',
    address: str(p.formattedAddress),
    city,
    country,
    latitude: num(p.location?.latitude),
    longitude: num(p.location?.longitude),
    rating: num(p.rating),
    priceLevel:
      p.priceLevel && p.priceLevel in PRICE_LEVEL_MAP
        ? PRICE_LEVEL_MAP[p.priceLevel]
        : null,
    website: str(p.websiteUri),
    menuUrl: null, // Google does not expose a dedicated menu URL field.
  };
}

function toPlaceDetails(p: GooglePlace): PlaceDetails {
  return {
    ...toPlaceResult(p),
    openingHours: p.regularOpeningHours?.weekdayDescriptions ?? null,
    phone: str(p.nationalPhoneNumber),
  };
}

export class GooglePlacesError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GooglePlacesError';
    this.status = status;
  }
}

export class GooglePlacesProvider implements PlacesProvider {
  readonly name = 'google_places';
  private readonly fetchImpl: FetchImpl;

  /** `fetchImpl` is injectable so tests can mock the Google HTTP calls. */
  constructor(fetchImpl: FetchImpl = fetch) {
    this.fetchImpl = fetchImpl;
  }

  isConfigured(): boolean {
    return getPlacesApiKey() !== null;
  }

  private headers(fieldMask: string): Record<string, string> {
    const key = getPlacesApiKey();
    if (!key) throw new GooglePlacesError(503, 'Places provider is not configured');
    return {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': fieldMask,
    };
  }

  private async call(url: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchImpl(url, init);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body; handled below via status.
    }
    if (!res.ok) {
      const msg =
        (body as { error?: { message?: string } } | null)?.error?.message ??
        `Places API request failed (HTTP ${res.status})`;
      throw new GooglePlacesError(res.status, msg);
    }
    return body;
  }

  async nearby(params: NearbyParams): Promise<PlaceResult[]> {
    if (params.lat !== undefined && params.lng !== undefined) {
      return this.searchNearby(params);
    }
    const textQuery = [params.query, params.cuisine, params.city]
      .filter((s) => s && s.trim().length > 0)
      .join(' ')
      .trim();
    if (textQuery) {
      return this.searchText(`restaurants ${textQuery}`);
    }
    return [];
  }

  private async searchNearby(params: NearbyParams): Promise<PlaceResult[]> {
    const body: Record<string, unknown> = {
      includedTypes: ['restaurant'],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: params.lat, longitude: params.lng },
          radius: Math.min(Math.max(params.radiusM, 50), 50000),
        },
      },
    };
    if (params.query?.trim()) {
      // Cuisine/name hint folded into the request is not supported by
      // searchNearby; the caller filters post-hoc. Keep the raw search broad.
    }
    const data = (await this.call(`${PLACES_BASE}/places:searchNearby`, {
      method: 'POST',
      headers: this.headers(SEARCH_FIELD_MASK),
      body: JSON.stringify(body),
    })) as { places?: GooglePlace[] };
    return (data.places ?? []).map(toPlaceResult);
  }

  private async searchText(textQuery: string): Promise<PlaceResult[]> {
    const data = (await this.call(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: this.headers(SEARCH_FIELD_MASK),
      body: JSON.stringify({
        textQuery,
        includedType: 'restaurant',
        maxResultCount: 20,
      }),
    })) as { places?: GooglePlace[] };
    return (data.places ?? []).map(toPlaceResult);
  }

  async details(id: string): Promise<PlaceDetails> {
    const data = (await this.call(
      `${PLACES_BASE}/places/${encodeURIComponent(id)}`,
      { method: 'GET', headers: this.headers(DETAILS_FIELD_MASK) },
    )) as GooglePlace;
    return toPlaceDetails(data);
  }
}
