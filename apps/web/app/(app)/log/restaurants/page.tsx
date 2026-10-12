'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  LocateFixed,
  MapPin,
  Plus,
  Search,
  Star,
  UtensilsCrossed,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { EmptyStateLux, GlassPanel, LuxButton } from '@/components/luxury';
import { Input, PageHeader, Select } from '@/components/ui';
import { resolveLocationSource, type GeoOutcome } from '@/lib/places/geo';
import { RADIUS_OPTIONS_KM } from '@/lib/places/types';

/* ------------------------------- types ---------------------------------- */

interface RestaurantRow {
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
}

interface NearbyResponse {
  configured: boolean;
  restaurants: RestaurantRow[];
}

/* -------------------------------- helpers --------------------------------- */

const PRICE_LABEL = ['Free', '$', '$$', '$$$', '$$$$'] as const;

function priceLabel(p: number | null): string | null {
  if (p === null || p < 0 || p >= PRICE_LABEL.length) return null;
  return PRICE_LABEL[p];
}

function osmLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

/* ------------------------------- component -------------------------------- */

export default function RestaurantsPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [radiusKm, setRadiusKm] = useState<number>(3);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [geo, setGeo] = useState<GeoOutcome | null>(null);
  const [locating, setLocating] = useState(false);

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualCity, setManualCity] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNearby = useCallback(
    async (params: Record<string, string>) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams(params).toString();
        const res = await api<NearbyResponse>(`/api/restaurants/nearby?${qs}`);
        setConfigured(res.configured);
        setRestaurants(res.restaurants);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'location_required') {
          setError(null);
          setRestaurants([]);
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load restaurants');
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /** Run a search with the current location source (coords or city fallback). */
  const runSearch = useCallback(() => {
    const src = resolveLocationSource(geo, city);
    // Surface the fallback notice only after a geolocation attempt —
    // the empty state already guides first-time visitors.
    if (geo !== null) setNotice('notice' in src ? src.notice || null : null);
    if (src.mode === 'coords') {
      void fetchNearby({
        lat: String(src.lat),
        lng: String(src.lng),
        radius: String(radiusKm),
        q: query.trim(),
      });
    } else if (src.mode === 'city') {
      void fetchNearby({ city: src.city, q: query.trim(), radius: String(radiusKm) });
    }
    // mode 'none': keep current results — the initial load already fetched
    // manual entries, and there is nothing new to search.
  }, [geo, city, radiusKm, query, fetchNearby]);

  // Initial load: manual entries / configured flag.
  useEffect(() => {
    void fetchNearby({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced re-search when the query or radius changes.
  useEffect(() => {
    if (configured === null) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(runSearch, 500);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, radiusKm, configured, runSearch]);

  /** Explicit user tap only — geolocation is never requested on page load. */
  const useMyLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeo({ status: 'unavailable' });
      const src = resolveLocationSource({ status: 'unavailable' }, city);
      setNotice('notice' in src ? src.notice : null);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setNotice(null);
        // Coordinates stay in memory for the search only — never persisted.
        // The debounced search effect picks up the new geo state (single call).
        setGeo({
          status: 'granted',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        setLocating(false);
        const outcome: GeoOutcome =
          err.code === err.PERMISSION_DENIED
            ? { status: 'denied' }
            : { status: 'unavailable' };
        // The debounced search effect falls back to the city (single call).
        setGeo(outcome);
      },
      { timeout: 10000 },
    );
  }, []);

  const addManual = useCallback(async () => {
    setManualError(null);
    if (!manualName.trim() || !manualCity.trim()) {
      setManualError('Name and city are required.');
      return;
    }
    setManualSaving(true);
    try {
      const res = await api<{ restaurant: RestaurantRow }>('/api/restaurants', {
        method: 'POST',
        body: {
          name: manualName.trim(),
          city: manualCity.trim(),
          address: manualAddress.trim(),
        },
      });
      setManualName('');
      setManualCity('');
      setManualAddress('');
      setShowManualForm(false);
      setRestaurants((prev) => [res.restaurant, ...prev]);
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Could not add the restaurant');
    } finally {
      setManualSaving(false);
    }
  }, [manualName, manualCity, manualAddress]);

  const usingCoords = geo?.status === 'granted';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6">
      <PageHeader
        title="Restaurants"
        subtitle="Find places to eat nearby, or add your own."
        actions={
          <LuxButton variant="secondary" onClick={() => setShowManualForm((v) => !v)}>
            <Plus className="h-4 w-4" /> Add manually
          </LuxButton>
        }
      />

      {notice && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--warning)',
            color: 'var(--text)',
            backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
          }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--warning)' }} />
          <span>{notice}</span>
        </div>
      )}

      {/* Search controls */}
      <GlassPanel className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or cuisine (e.g. desi, pizza)"
              className="pl-9"
              aria-label="Search restaurants by name or cuisine"
            />
          </div>
          <div className="flex gap-2">
            <LuxButton variant="secondary" onClick={useMyLocation} disabled={locating}>
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LocateFixed className="h-4 w-4" />
              )}
              {usingCoords ? 'Location set' : 'Use my location'}
            </LuxButton>
            <Select
              value={String(radiusKm)}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              aria-label="Search radius"
              className="w-24"
            >
              {RADIUS_OPTIONS_KM.map((km) => (
                <option key={km} value={km}>
                  {km} km
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 opacity-60" />
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Or type a city (e.g. Lahore)"
            aria-label="City for manual location search"
          />
          <LuxButton variant="secondary" onClick={runSearch} className="shrink-0">
            Search
          </LuxButton>
        </div>
        <p className="mt-2 text-xs opacity-60">
          Location is only requested when you tap “Use my location”, and is never
          saved to your profile.
        </p>
      </GlassPanel>

      {/* Manual add form */}
      {showManualForm && (
        <GlassPanel className="mb-4 p-4">
          <h2 className="t-card-heading mb-3">Add a restaurant manually</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Restaurant name *"
              aria-label="Restaurant name"
            />
            <Input
              value={manualCity}
              onChange={(e) => setManualCity(e.target.value)}
              placeholder="City *"
              aria-label="City"
            />
          </div>
          <Input
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            placeholder="Address (optional)"
            aria-label="Address"
            className="mt-3"
          />
          {manualError && (
            <p className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
              {manualError}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <LuxButton onClick={addManual} disabled={manualSaving}>
              {manualSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save restaurant
            </LuxButton>
            <LuxButton variant="ghost" onClick={() => setShowManualForm(false)}>
              Cancel
            </LuxButton>
          </div>
        </GlassPanel>
      )}

      {/* Unconfigured setup screen */}
      {configured === false && (
        <GlassPanel className="mb-4 border-dashed p-5">
          <div className="flex items-start gap-3">
            <Globe className="mt-1 h-5 w-5 shrink-0" style={{ color: 'var(--accent)' }} />
            <div className="text-sm">
              <h2 className="t-card-heading mb-1">Live place search isn’t set up yet</h2>
              <p className="opacity-80">
                Restaurant search uses the Google Places API (New). To enable it,
                the app owner needs to:
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 opacity-80">
                <li>Enable the <strong>Places API (New)</strong> in Google Cloud Console.</li>
                <li>Attach a billing account (pay-as-you-go; field masks keep costs low).</li>
                <li>Create an API key restricted to the Places API (New).</li>
                <li>Set <code>GOOGLE_PLACES_API_KEY</code> on the server (see setup guide).</li>
              </ol>
              <p className="mt-2 opacity-80">
                Until then, you can still add restaurants manually below — menus
                attach to them normally.
              </p>
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Results */}
      {loading && restaurants.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin opacity-60" />
        </div>
      ) : error ? (
        <EmptyStateLux
          icon={<AlertCircle className="h-6 w-6" />}
          title="Couldn’t load restaurants"
          message={error}
          action={<LuxButton onClick={runSearch}>Try again</LuxButton>}
        />
      ) : restaurants.length === 0 ? (
        <EmptyStateLux
          icon={<UtensilsCrossed className="h-6 w-6" />}
          title="No restaurants found"
          message={
            configured === false
              ? 'No manually-added restaurants yet. Add your first one above.'
              : usingCoords || city
                ? 'Nothing matched nearby. Try a larger radius or a different search.'
                : 'Tap “Use my location” or type a city to start searching.'
          }
          action={
            <LuxButton variant="secondary" onClick={() => setShowManualForm(true)}>
              <Plus className="h-4 w-4" /> Add manually
            </LuxButton>
          }
        />
      ) : (
        <ul className="space-y-3">
          {restaurants.map((r) => (
            <li key={r.id}>
              <GlassPanel className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/log/restaurants/${r.id}`}
                      className="t-card-heading hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.address && (
                      <p className="mt-1 text-sm opacity-70">{r.address}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {r.rating !== null && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                        >
                          <Star
                            className="h-3 w-3"
                            style={{ color: 'var(--warning)' }}
                            fill="currentColor"
                          />
                          {r.rating.toFixed(1)}
                        </span>
                      )}
                      {priceLabel(r.priceLevel) && (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                        >
                          {priceLabel(r.priceLevel)}
                        </span>
                      )}
                      {r.provider === 'manual' && (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                        >
                          Added by you
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <Link href={`/log/restaurants/${r.id}`}>
                    <LuxButton variant="secondary" className="min-h-[40px] px-4 py-1.5 text-sm">
                      View menu
                    </LuxButton>
                  </Link>
                  {r.latitude !== null && r.longitude !== null && (
                    <a
                      href={osmLink(r.latitude, r.longitude)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center gap-1 rounded-xl px-4 py-1.5 text-sm opacity-80 hover:opacity-100"
                      style={{ border: '1px solid var(--border)' }}
                    >
                      <MapPin className="h-4 w-4" /> View on map
                    </a>
                  )}
                  {r.website && (
                    <a
                      href={r.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center gap-1 rounded-xl px-4 py-1.5 text-sm opacity-80 hover:opacity-100"
                      style={{ border: '1px solid var(--border)' }}
                    >
                      <Globe className="h-4 w-4" /> Website
                    </a>
                  )}
                  {r.menuUrl && (
                    <a
                      href={r.menuUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center gap-1 rounded-xl px-4 py-1.5 text-sm opacity-80 hover:opacity-100"
                      style={{ border: '1px solid var(--border)' }}
                    >
                      <ExternalLink className="h-4 w-4" /> Menu link
                    </a>
                  )}
                </div>
              </GlassPanel>
            </li>
          ))}
        </ul>
      )}

      {!loading && configured && restaurants.length > 0 && (
        <p className="mt-4 flex items-center gap-1 text-center text-xs opacity-60">
          <Clock className="h-3 w-3" /> Results are cached briefly to keep search
          costs down.
        </p>
      )}
    </div>
  );
}
