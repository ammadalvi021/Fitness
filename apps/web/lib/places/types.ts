/**
 * Phase C — Restaurant Discovery: shared provider-agnostic types.
 *
 * The places provider (Google Places API (New), or none) is a server-side
 * concern. These types cross the server boundary only as plain JSON —
 * the API key never leaves the server (see lib/places/google.ts).
 */

export interface PlaceResult {
  /** Provider's stable place id (e.g. Google "ChIJ..."), or null for manual. */
  id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  /** 0–5 Google rating, null when unknown. */
  rating: number | null;
  /** 0 (free) – 4 (very expensive), null when unknown. */
  priceLevel: number | null;
  website: string | null;
  menuUrl: string | null;
}

export interface NearbyParams {
  lat?: number;
  lng?: number;
  /** Search radius in metres. */
  radiusM: number;
  /** Free-text name/cuisine filter, e.g. "desi", "pizza". */
  query?: string;
  /** City name used as a location fallback when no coordinates are given. */
  cuisine?: string;
  city?: string;
}

export interface PlaceDetails extends PlaceResult {
  openingHours?: string[] | null;
  phone?: string | null;
}

/** Radius choices offered by the UI, in kilometres. */
export const RADIUS_OPTIONS_KM = [1, 3, 5, 10] as const;
