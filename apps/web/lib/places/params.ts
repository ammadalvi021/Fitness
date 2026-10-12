/**
 * Phase C — Restaurant Discovery: pure query-param validation for the
 * nearby API. Kept out of the route module (Next.js route files may only
 * export HTTP handlers) so the logic stays unit-testable.
 */
import { RADIUS_OPTIONS_KM } from './types';

export const MAX_Q_LEN = 100;
export const MAX_CITY_LEN = 120;

/**
 * Radius whitelist: the UI only ever sends 1|3|5|10 km.
 * Returns null for anything else (the route answers 400).
 */
export function parseRadiusKm(raw: string | null): number | null {
  if (raw === null || raw === '') return 3;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return (RADIUS_OPTIONS_KM as readonly number[]).includes(n) ? n : null;
}

/** Returns null when absent, 'invalid' when out of range / not a number. */
export function parseLatLng(
  raw: string | null,
  min: number,
  max: number,
): number | null | 'invalid' {
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return 'invalid';
  return n;
}
