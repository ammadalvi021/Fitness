/**
 * Phase 4 regression: environment config + billing-status contract.
 *
 * Covers:
 * - check-env helper: missing DATABASE_URL handling (names only, no values)
 * - billingStatus() configured logic — a Stripe API key ALONE is NOT enough
 * - priceIdForPlan() unit behavior
 *
 * No network, no Stripe calls. Real end-to-end Stripe checkout/webhook
 * against test-mode keys is intentionally NOT covered here (BLOCKED:
 * needs real STRIPE_* test keys from the Stripe dashboard).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { checkEnv } from '../../../../scripts/check-env.mjs';
import {
  billingProvider,
  billingStatus,
  priceIdForPlan,
} from '@/lib/billing';

// --- per-test env save/restore ---------------------------------------------
const envStack: Array<Record<string, string | undefined>> = [];
function pushEnv(vars: Record<string, string | undefined>) {
  envStack.push(
    Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]])),
  );
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  while (envStack.length) {
    const snap = envStack.pop()!;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

describe('check-env helper', () => {
  it('reports ok when DATABASE_URL and SESSION_SECRET are present', () => {
    const r = checkEnv();
    expect(r.ok).toBe(true);
    expect(r.missingVars).toEqual([]);
    expect(r.envFileExists).toBe(true);
  });

  it('missing DATABASE_URL is reported by name (never by value)', () => {
    // Plant a dummy secret-shaped value, then remove the vars and point at
    // an empty dir: the report must name the missing vars without leaking
    // the planted value.
    pushEnv({
      DATABASE_URL: 'postgres://dummy-secret-xyz-123:5432/ff',
      SESSION_SECRET: 'dummy-secret-abc-456',
    });
    const dir = `/tmp/ff-envcheck-${Date.now()}`;
    const r = checkEnv(dir);
    // process.env still has them, so nothing is missing yet...
    expect(r.missingVars).toEqual([]);

    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    const r2 = checkEnv(dir);
    expect(r2.ok).toBe(false);
    expect(r2.envFileExists).toBe(false);
    expect(r2.missingVars).toContain('DATABASE_URL');
    expect(r2.missingVars).toContain('SESSION_SECRET');
    expect(r2.errors.join(' ')).toMatch(/DATABASE_URL/);
    // Names only — the dummy secret values must not appear anywhere.
    const dumped = JSON.stringify(r2);
    expect(dumped).not.toContain('dummy-secret-xyz-123');
    expect(dumped).not.toContain('dummy-secret-abc-456');
  });
});

describe('billingStatus() configured logic', () => {
  const STRIPE_VARS = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_DIET',
    'STRIPE_PRICE_DIET_EXERCISE',
  ];

  it('defaults to provider=none, configured=false, no missing vars', () => {
    pushEnv({ BILLING_PROVIDER: undefined });
    expect(billingProvider()).toBe('none');
    expect(billingStatus()).toEqual({ provider: 'none', configured: false, missing: [] });
  });

  it('unknown BILLING_PROVIDER values fall back to none', () => {
    pushEnv({ BILLING_PROVIDER: 'weird-value' });
    expect(billingProvider()).toBe('none');
  });

  it('sandbox mode counts as configured (test-only, no keys needed)', () => {
    pushEnv({ BILLING_PROVIDER: 'sandbox' });
    expect(billingStatus()).toEqual({ provider: 'sandbox', configured: true, missing: [] });
  });

  it('stripe mode: an API key ALONE is not enough (key-alone-insufficient)', () => {
    pushEnv({
      BILLING_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: undefined,
      STRIPE_PRICE_DIET: undefined,
      STRIPE_PRICE_DIET_EXERCISE: undefined,
    });
    const s = billingStatus();
    expect(s.provider).toBe('stripe');
    expect(s.configured).toBe(false);
    expect(s.missing).not.toContain('STRIPE_SECRET_KEY');
    expect(s.missing).toContain('STRIPE_WEBHOOK_SECRET');
    expect(s.missing).toContain('STRIPE_PRICE_DIET');
    expect(s.missing).toContain('STRIPE_PRICE_DIET_EXERCISE');
  });

  it('stripe mode: configured ONLY when every credential + price id is set', () => {
    pushEnv({
      BILLING_PROVIDER: 'STRIPE', // case-insensitive
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
      STRIPE_PRICE_DIET: 'price_dummy_diet',
      STRIPE_PRICE_DIET_EXERCISE: 'price_dummy_diet_exercise',
    });
    expect(billingProvider()).toBe('stripe');
    const s = billingStatus();
    expect(s.configured).toBe(true);
    expect(s.missing).toEqual([]);
  });
});

describe('priceIdForPlan()', () => {
  it('returns null for unknown plans and for free (no price)', () => {
    expect(priceIdForPlan('nope')).toBeNull();
    expect(priceIdForPlan('free')).toBeNull();
  });

  it('returns null when the env var is unset, the value when set', () => {
    pushEnv({ STRIPE_PRICE_DIET: undefined });
    expect(priceIdForPlan('diet')).toBeNull();
    pushEnv({ STRIPE_PRICE_DIET: 'price_test_123' });
    expect(priceIdForPlan('diet')).toBe('price_test_123');
  });
});
