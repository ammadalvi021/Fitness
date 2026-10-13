/**
 * V20 Feature 5 — intermittent fasting timer math + persistence-reconcile tests.
 *
 * All timestamps are fixed; no wall-clock dependence except explicit defaults.
 */
import { describe, expect, it } from 'vitest';
import {
  FASTING_PRESETS,
  FastingRecordSchema,
  completionPct,
  elapsedMs,
  fastingStatus,
  fastEndMs,
  formatDuration,
  formatRemaining,
  isValidFastingRecord,
  remainingMs,
  shouldConfirmReplace,
  type FastingRecord,
} from './fasting.js';

// Fixed anchor: 2026-10-12T12:00:00Z.
const T0 = Date.parse('2026-10-12T12:00:00Z');
const H = 3_600_000;

function active(startedAt: string, targetMinutes: number): FastingRecord {
  return { startedAt, targetMinutes };
}

describe('presets', () => {
  it('16:8 means a 16h (960 min) fast', () => {
    const p = FASTING_PRESETS.find((x) => x.label === '16:8')!;
    expect(p.fastingHours * 60).toBe(960);
  });
  it('all presets are whole-hour targets within bounds', () => {
    for (const p of FASTING_PRESETS) {
      expect(Number.isInteger(p.fastingHours)).toBe(true);
      expect(p.fastingHours).toBeGreaterThanOrEqual(1);
      expect(p.fastingHours).toBeLessThanOrEqual(72);
    }
  });
  it('schema accepts presets and a custom 15.5h fast, rejects absurd values', () => {
    expect(
      FastingRecordSchema.safeParse(active(new Date(T0).toISOString(), 14 * 60)).success,
    ).toBe(true);
    // 15.5h = 930 min custom
    expect(FastingRecordSchema.safeParse(active(new Date(T0).toISOString(), 930)).success).toBe(
      true,
    );
    expect(
      FastingRecordSchema.safeParse(active(new Date(T0).toISOString(), 30)).success,
    ).toBe(false);
    expect(
      FastingRecordSchema.safeParse(active(new Date(T0).toISOString(), 73 * 60)).success,
    ).toBe(false);
    expect(
      FastingRecordSchema.safeParse({ startedAt: 'not-a-date', targetMinutes: 960 }).success,
    ).toBe(false);
  });
});

describe('timer math at fixed timestamps', () => {
  const r = active(new Date(T0).toISOString(), 16 * 60);

  it('elapsed grows linearly', () => {
    expect(elapsedMs(r, T0)).toBe(0);
    expect(elapsedMs(r, T0 + 4 * H)).toBe(4 * H);
    expect(elapsedMs(r, T0 + 15 * H + 30 * 60_000)).toBe(15 * H + 30 * 60_000);
  });

  it('remaining counts down to zero and never goes negative', () => {
    expect(remainingMs(r, T0)).toBe(16 * H);
    expect(remainingMs(r, T0 + 4 * H)).toBe(12 * H);
    expect(remainingMs(r, T0 + 16 * H)).toBe(0);
    expect(remainingMs(r, T0 + 30 * H)).toBe(0);
  });

  it('completion percentage is exact at quarters', () => {
    expect(completionPct(r, T0)).toBe(0);
    expect(completionPct(r, T0 + 4 * H)).toBe(25);
    expect(completionPct(r, T0 + 8 * H)).toBe(50);
    expect(completionPct(r, T0 + 16 * H)).toBe(100);
    expect(completionPct(r, T0 + 99 * H)).toBe(100); // clamped
  });

  it('end time = start + target', () => {
    expect(fastEndMs(r)).toBe(T0 + 16 * H);
  });

  it('a future-dated start clamps elapsed to 0 (never negative)', () => {
    const future = active(new Date(T0 + 2 * H).toISOString(), 16 * 60);
    expect(elapsedMs(future, T0)).toBe(0);
    expect(fastingStatus(future, T0)).toBe('fasting');
  });

  it('an ended fast uses endedAt for duration, not the target', () => {
    const ended: FastingRecord = {
      ...r,
      endedAt: new Date(T0 + 10 * H).toISOString(),
    };
    expect(elapsedMs(ended, T0 + 99 * H)).toBe(10 * H);
    expect(completionPct(ended, T0 + 99 * H)).toBe(62.5);
    expect(remainingMs(ended, T0 + 99 * H)).toBe(0);
  });
});

describe('persistence reconcile', () => {
  const r = active(new Date(T0).toISOString(), 16 * 60);

  it('mid-fast reload stays fasting', () => {
    expect(fastingStatus(r, T0 + 6 * H)).toBe('fasting');
  });

  it('reload after the end marks complete', () => {
    expect(fastingStatus(r, T0 + 16 * H)).toBe('complete');
    expect(fastingStatus(r, T0 + 20 * H)).toBe('complete');
  });

  it('no record → idle', () => {
    expect(fastingStatus(null, T0)).toBe('idle');
    expect(fastingStatus(undefined, T0)).toBe('idle');
  });

  it('corrupt stored records are idle, never crash', () => {
    expect(isValidFastingRecord(null)).toBe(false);
    expect(isValidFastingRecord({})).toBe(false);
    expect(isValidFastingRecord('garbage')).toBe(false);
    expect(isValidFastingRecord({ startedAt: new Date(T0).toISOString() })).toBe(false);
    expect(fastingStatus({ startedAt: 'x', targetMinutes: 1 } as never, T0)).toBe('idle');
  });

  it('an already-ended record is complete even if reloaded early', () => {
    const ended: FastingRecord = { ...r, endedAt: new Date(T0 + 3 * H).toISOString() };
    expect(fastingStatus(ended, T0 + 4 * H)).toBe('complete');
  });
});

describe('replace-confirm logic', () => {
  it('starting while a fast is active requires confirmation', () => {
    const r = active(new Date(T0).toISOString(), 16 * 60);
    expect(shouldConfirmReplace(r, T0 + H)).toBe(true);
  });
  it('no active fast → no confirmation', () => {
    expect(shouldConfirmReplace(null, T0)).toBe(false);
  });
  it('a completed fast → no confirmation', () => {
    const r = active(new Date(T0).toISOString(), 16 * 60);
    expect(shouldConfirmReplace(r, T0 + 20 * H)).toBe(false);
    expect(shouldConfirmReplace({ ...r, endedAt: new Date(T0 + H).toISOString() }, T0 + 2 * H)).toBe(
      false,
    );
  });
});

describe('formatters', () => {
  it('formatRemaining countdown strings', () => {
    expect(formatRemaining(7 * H + 24 * 60_000)).toBe('7h 24m');
    expect(formatRemaining(42 * 60_000 + 10_000)).toBe('42m 10s');
    expect(formatRemaining(5_000)).toBe('0m 05s');
    expect(formatRemaining(-100)).toBe('0m 00s');
  });
  it('formatDuration', () => {
    expect(formatDuration(16 * H)).toBe('16h 00m');
    expect(formatDuration(10 * H + 30 * 60_000)).toBe('10h 30m');
  });
});
