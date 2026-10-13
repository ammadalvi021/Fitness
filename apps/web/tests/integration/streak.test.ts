/**
 * V20 Feature 2 — logging-streak unit tests (pure module, no DB).
 *
 * Diary entries are bucketed client-side into user-local YYYY-MM-DD days,
 * so the streak math here works on those local date strings.
 */
import { describe, expect, it } from 'vitest';
import {
  computeStreak,
  dateStringToDayNum,
  toLocalDateOnly,
} from '../../lib/streak';

function days(...ds: string[]) {
  return ds;
}

describe('computeStreak', () => {
  it('empty history -> zeros and null lastLoggedDate', () => {
    expect(computeStreak([], '2026-10-12')).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      lastLoggedDate: null,
      todayLogged: false,
      milestone: null,
    });
  });

  it('single logged day (today) -> streak of 1, today logged', () => {
    const r = computeStreak(days('2026-10-12'), '2026-10-12');
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(1);
    expect(r.lastLoggedDate).toBe('2026-10-12');
    expect(r.todayLogged).toBe(true);
    expect(r.milestone).toBeNull();
  });

  it('consecutive days including today -> current = full run', () => {
    const r = computeStreak(
      days('2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'),
      '2026-10-12',
    );
    expect(r.currentStreak).toBe(5);
    expect(r.longestStreak).toBe(5);
    expect(r.todayLogged).toBe(true);
  });

  it('a gap of 1+ day breaks the current streak; longest remembers the past', () => {
    // Best run ever: 10 days. Current run: 3 days after a gap on 2026-10-09.
    const r = computeStreak(
      days(
        '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
        '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29',
        '2026-10-10', '2026-10-11', '2026-10-12',
      ),
      '2026-10-12',
    );
    expect(r.currentStreak).toBe(3);
    expect(r.longestStreak).toBe(10);
    expect(r.todayLogged).toBe(true);
    expect(r.milestone).toBeNull();
  });

  it('today not yet logged does NOT break the streak (alive until end of today)', () => {
    const r = computeStreak(
      days('2026-10-10', '2026-10-11'),
      '2026-10-12',
    );
    expect(r.currentStreak).toBe(2);
    expect(r.todayLogged).toBe(false);
    expect(r.lastLoggedDate).toBe('2026-10-11');
  });

  it('yesterday also unlogged -> current streak is 0, history intact', () => {
    const r = computeStreak(days('2026-10-08', '2026-10-09', '2026-10-10'), '2026-10-12');
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(3);
    expect(r.todayLogged).toBe(false);
    expect(r.lastLoggedDate).toBe('2026-10-10');
  });

  it('dedupes repeated entries on the same day', () => {
    const r = computeStreak(
      days('2026-10-11', '2026-10-11', '2026-10-12', '2026-10-12', '2026-10-12'),
      '2026-10-12',
    );
    expect(r.currentStreak).toBe(2);
    expect(r.longestStreak).toBe(2);
  });

  it('ignores malformed date strings instead of crashing', () => {
    const r = computeStreak(days('not-a-date', '', '2026-10-12'), '2026-10-12');
    expect(r.currentStreak).toBe(1);
    expect(r.lastLoggedDate).toBe('2026-10-12');
  });

  it('future-dated entries do not inflate the current streak', () => {
    const r = computeStreak(days('2026-10-12', '2026-10-13'), '2026-10-12');
    expect(r.currentStreak).toBe(1);
    expect(r.todayLogged).toBe(true);
    // The future day is still real history data and feeds the longest run.
    expect(r.longestStreak).toBe(2);
  });

  it('milestone badges fire at 7 / 30 / 100 days (highest reached)', () => {
    const run = (n: number) => {
      const ds: string[] = [];
      let num = dateStringToDayNum('2026-10-12')!;
      for (let i = 0; i < n; i++) {
        ds.push(new Date(num * 86400000).toISOString().slice(0, 10));
        num -= 1;
      }
      return ds.reverse();
    };
    expect(computeStreak(run(7), '2026-10-12').milestone).toBe(7);
    expect(computeStreak(run(29), '2026-10-12').milestone).toBe(7);
    expect(computeStreak(run(30), '2026-10-12').milestone).toBe(30);
    expect(computeStreak(run(100), '2026-10-12').milestone).toBe(100);
    expect(computeStreak(run(6), '2026-10-12').milestone).toBeNull();
  });

  it('works across a month boundary', () => {
    const r = computeStreak(days('2026-09-30', '2026-10-01', '2026-10-02'), '2026-10-02');
    expect(r.currentStreak).toBe(3);
  });
});

describe('timezone boundary bucketing', () => {
  it('23:59 and 00:01 user-local on the same day -> one logged day', () => {
    // Karachi is UTC+5. 00:01 PKT on Oct 12 = 19:01 UTC Oct 11;
    // 23:59 PKT on Oct 12 = 18:59 UTC Oct 12. Both bucket to Oct 12.
    const early = toLocalDateOnly(new Date('2026-10-11T19:01:00.000Z'), 'Asia/Karachi');
    const late = toLocalDateOnly(new Date('2026-10-12T18:59:00.000Z'), 'Asia/Karachi');
    expect(early).toBe('2026-10-12');
    expect(late).toBe('2026-10-12');
    const r = computeStreak([early, late], '2026-10-12');
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(1);
  });

  it('entries straddling local midnight become consecutive logged days', () => {
    const before = toLocalDateOnly(new Date('2026-10-11T18:59:00.000Z'), 'Asia/Karachi'); // 23:59 PKT Oct 11
    const after = toLocalDateOnly(new Date('2026-10-11T19:01:00.000Z'), 'Asia/Karachi'); // 00:01 PKT Oct 12
    expect(before).toBe('2026-10-11');
    expect(after).toBe('2026-10-12');
    const r = computeStreak([before, after], '2026-10-12');
    expect(r.currentStreak).toBe(2);
  });

  it('toLocalDateOnly matches the diary client local-day convention', () => {
    // The diary client stamps entries with the browser-local date.
    // For a UTC+5 browser, 2026-10-12 00:30 UTC is still Oct 12 locally.
    expect(toLocalDateOnly(new Date('2026-10-11T19:30:00.000Z'), 'Asia/Karachi')).toBe(
      '2026-10-12',
    );
  });
});
