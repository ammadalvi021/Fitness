/**
 * Phase C — Restaurant Discovery: provider interface.
 *
 * A `PlacesProvider` is a server-side adapter over a third-party places API.
 * Implementations must NEVER invent places: they return only what the
 * upstream API returned. When no provider is configured the app falls back
 * to a manual-entry flow (see the /log/restaurants page).
 */
import type { NearbyParams, PlaceDetails, PlaceResult } from './types';

export interface PlacesProvider {
  /** Stable provider name, e.g. 'google_places'. Matches Restaurant.provider. */
  readonly name: string;
  /** True when the provider has the credentials it needs to serve requests. */
  isConfigured(): boolean;
  /**
   * Find nearby places. With lat/lng this is a circle search; with only
   * `query`/`city` set the implementation may fall back to a text search.
   * Returns [] (never invented data) when nothing matches.
   */
  nearby(params: NearbyParams): Promise<PlaceResult[]>;
  /** Full details for one place id. */
  details(id: string): Promise<PlaceDetails>;
}
