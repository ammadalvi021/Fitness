/**
 * Phase C — Restaurant Discovery: provider registry.
 *
 * `getPlacesProvider()` returns the Google adapter when (and only when) the
 * server holds a `GOOGLE_PLACES_API_KEY`; otherwise null, and the UI falls
 * back to the manual-entry flow. Never returns fake data.
 */
import { GooglePlacesProvider } from './google';
import type { PlacesProvider } from './interface';

let cached: PlacesProvider | null | undefined;

export function getPlacesProvider(): PlacesProvider | null {
  if (cached !== undefined) return cached;
  const google = new GooglePlacesProvider();
  cached = google.isConfigured() ? google : null;
  return cached;
}

/** Test hook: clear the memoized provider (e.g. after changing env in tests). */
export function resetPlacesProviderCache(): void {
  cached = undefined;
}
