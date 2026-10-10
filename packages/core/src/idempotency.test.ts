import { describe, expect, it } from 'vitest';
import { normalizeIdempotencyKey } from './idempotency.js';

describe('normalizeIdempotencyKey', () => {
  it("maps '' to null", () => {
    expect(normalizeIdempotencyKey('')).toBeNull();
  });

  it('maps whitespace-only to null', () => {
    expect(normalizeIdempotencyKey('   ')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeIdempotencyKey('  abc-123  ')).toBe('abc-123');
  });

  it('maps null/undefined to null', () => {
    expect(normalizeIdempotencyKey(null)).toBeNull();
    expect(normalizeIdempotencyKey(undefined)).toBeNull();
  });

  it('passes through a clean key unchanged', () => {
    expect(normalizeIdempotencyKey('key-1')).toBe('key-1');
  });
});
