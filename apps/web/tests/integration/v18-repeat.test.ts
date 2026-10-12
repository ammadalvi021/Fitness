/**
 * V18 Phase E: repeat-yesterday / recent-foods helpers — pure unit tests (no DB).
 */
import { describe, expect, it } from 'vitest';
import {
  buildRepeatPayload,
  distinctRecentFoods,
  repeatIdempotencyKey,
  type RepeatSourceEntry,
} from '@/lib/repeat';

const entry: RepeatSourceEntry = {
  id: 'entry-1',
  mealType: 'lunch',
  foodId: 'food-roti',
  customName: 'Whole wheat roti',
  servings: 2,
  kcal: 240,
  proteinG: 8,
  carbsG: 44,
  fatG: 2,
  fiberG: 4,
};

describe('buildRepeatPayload', () => {
  it('targets the new date with fresh keys (not yesterday\'s)', () => {
    const p = buildRepeatPayload(entry, '2026-10-12');
    expect(p.body.date).toBe('2026-10-12');
    expect(p.body.mealType).toBe('lunch');
    expect(p.body.foodId).toBe('food-roti');
    expect(p.body.servings).toBe(2);
    // Server re-snapshots nutrients from foodId — no client totals trusted.
    expect(p.body).not.toHaveProperty('kcal');
    expect(p.idempotencyKey).toBe('repeat-2026-10-12-entry-1');
  });

  it('re-tapping "log all" for the same date yields the SAME key (no dupes)', () => {
    const a = buildRepeatPayload(entry, '2026-10-12');
    const b = buildRepeatPayload(entry, '2026-10-12');
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(repeatIdempotencyKey(entry.id, '2026-10-12')).toBe(a.idempotencyKey);
  });

  it('a different target date yields a different key', () => {
    expect(buildRepeatPayload(entry, '2026-10-13').idempotencyKey).not.toBe(
      buildRepeatPayload(entry, '2026-10-12').idempotencyKey,
    );
  });

  it('manual (customName) entries carry their snapshot for re-logging', () => {
    const manual: RepeatSourceEntry = {
      id: 'entry-2', mealType: 'dinner', customName: 'Aloo paratha', servings: 1, kcal: 300,
    };
    const p = buildRepeatPayload(manual, '2026-10-12');
    expect(p.body.customName).toBe('Aloo paratha');
    expect(p.body.kcal).toBe(300);
    expect(p.body).not.toHaveProperty('foodId');
  });
});

describe('distinctRecentFoods', () => {
  it('dedupes by foodId, newest first, capped at 20', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      foodId: `food-${i % 5}`,
      customName: `Food ${i % 5}`,
    }));
    const out = distinctRecentFoods(entries, (e) => e.customName ?? '', 20);
    expect(out).toHaveLength(5);
    expect(out[0].foodId).toBe('food-0');
  });

  it('dedupes manual entries by lowercased name', () => {
    const entries = [
      { foodId: null, customName: 'Aloo Paratha' },
      { foodId: null, customName: 'aloo paratha' },
      { foodId: null, customName: 'Daal' },
    ];
    const out = distinctRecentFoods(entries, (e) => e.customName ?? '');
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('Aloo Paratha');
  });

  it('respects a smaller limit', () => {
    const entries = [
      { foodId: 'a', customName: 'A' },
      { foodId: 'b', customName: 'B' },
      { foodId: 'c', customName: 'C' },
    ];
    expect(distinctRecentFoods(entries, (e) => e.customName ?? '', 2)).toHaveLength(2);
  });
});
