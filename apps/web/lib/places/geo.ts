/**
 * Phase C — Restaurant Discovery: pure geolocation-fallback logic.
 *
 * The browser geolocation API is only ever called after an explicit user tap
 * ("Use my location"). This module decides what the search should do with the
 * outcome — coordinates, a denial, or an unavailable device — so the
 * decision is unit-testable without a DOM. Precise coordinates are used
 * in-memory for the search only and are never persisted to the profile.
 */

export type GeoOutcome =
  | { status: 'granted'; lat: number; lng: number }
  | { status: 'denied' }
  | { status: 'unavailable' };

export type LocationSource =
  | { mode: 'coords'; lat: number; lng: number }
  | { mode: 'city'; city: string; notice: string }
  | { mode: 'none'; notice: string };

/**
 * Resolve which location source a restaurant search should use.
 *
 * - granted  -> use the coordinates (in-memory only, never persisted).
 * - denied/unavailable -> fall back to the typed city, with an honest notice;
 *   if no city is typed, report that no source is available yet.
 */
export function resolveLocationSource(
  outcome: GeoOutcome | null,
  cityInput: string,
): LocationSource {
  const city = cityInput.trim();
  if (outcome?.status === 'granted') {
    return { mode: 'coords', lat: outcome.lat, lng: outcome.lng };
  }
  if (outcome?.status === 'denied' || outcome?.status === 'unavailable') {
    const reason =
      outcome.status === 'denied'
        ? 'Location access was denied'
        : 'Location is unavailable on this device';
    if (city) {
      return {
        mode: 'city',
        city,
        notice: `${reason} — showing restaurants for “${city}” instead.`,
      };
    }
    return {
      mode: 'none',
      notice: `${reason}. Type a city below to search manually.`,
    };
  }
  // No geolocation attempt yet.
  if (city) return { mode: 'city', city, notice: '' };
  return { mode: 'none', notice: 'Tap “Use my location” or type a city to search.' };
}
