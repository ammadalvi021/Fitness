/**
 * Idempotency-key normalization. Pure function.
 */

/**
 * Normalize an idempotency key: trim surrounding whitespace; empty (or missing)
 * keys normalize to null so callers can treat them as "no key provided".
 */
export function normalizeIdempotencyKey(
  key: string | null | undefined,
): string | null {
  if (key == null) return null;
  const trimmed = key.trim();
  return trimmed === '' ? null : trimmed;
}
