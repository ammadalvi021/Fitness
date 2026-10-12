/**
 * Tiny in-memory per-key rate limiter for server API routes.
 *
 * Keeps third-party provider spend (Google Places) and DB load bounded.
 * Single-instance semantics are fine here (Render runs one web instance);
 * this is a cost/abuse guard, not a security boundary — auth still applies.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Sliding fixed-window limiter.
 * @param key     bucket key (e.g. `nearby:<userId>`)
 * @param limit   max hits per window
 * @param windowMs window length in ms
 * @param now     injectable clock for tests
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (b.count < limit) {
    b.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
  return { allowed: false, retryAfterMs: b.windowStart + windowMs - now };
}

/** Test hook: drop all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
