/**
 * Regression test: clampInt must treat missing/blank query params as
 * "use the fallback". Number(null) and Number('') are both 0 (finite),
 * so a naive implementation clamps them to min instead of the fallback —
 * which made /api/recipes return 1 item instead of the default page.
 */
import { describe, expect, it } from 'vitest';
import { clampInt } from '@/lib/server-api';

describe('clampInt', () => {
  it('returns the fallback for missing params', () => {
    expect(clampInt(null, 20, 1, 100)).toBe(20);
    expect(clampInt(undefined, 20, 1, 100)).toBe(20);
  });

  it('returns the fallback for blank params', () => {
    expect(clampInt('', 20, 1, 100)).toBe(20);
  });

  it('parses valid values and clamps to range', () => {
    expect(clampInt('5', 20, 1, 100)).toBe(5);
    expect(clampInt('0', 20, 1, 100)).toBe(1); // explicit zero still clamps to min
    expect(clampInt('999', 20, 1, 100)).toBe(100);
  });

  it('returns the fallback for non-numeric values', () => {
    expect(clampInt('abc', 20, 1, 100)).toBe(20);
  });
});
