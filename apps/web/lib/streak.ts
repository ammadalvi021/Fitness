/**
 * Logging-streak computation (pure module — no I/O, no DB).
 *
 * A "logged day" is any user-local calendar day (YYYY-MM-DD) with at least
 * one diary entry. Diary entries are bucketed client-side into the user's
 * local day before being stored (see `todayLocal()` in components/food-log.tsx),
 * so the date strings that reach this module are already user-local days.
 *
 * Rules:
 *  - Streaks count consecutive calendar days.
 *  - A gap of 1+ day breaks the streak.
 *  - An unlogged *today* does not break it: the streak is alive until the
 *    end of today, so `currentStreak` counts the run ending at yesterday when
 *    today has no entries yet.
 *  - Empty history -> all zeros, `lastLoggedDate` null.
 */

export interface StreakResult {
  /** Consecutive logged days up to today (or yesterday when today is unlogged but alive). */
  currentStreak: number;
  /** Best consecutive run anywhere in the history. */
  longestStreak: number;
  /** Most recent logged day (YYYY-MM-DD), or null when there is none. */
  lastLoggedDate: string | null;
  /** Whether today has at least one diary entry. */
  todayLogged: boolean;
  /** Highest milestone reached by the current streak: 100 | 30 | 7, else null. */
  milestone: number | null;
}

/** Milestone thresholds shown in the dashboard widget (highest first). */
export const STREAK_MILESTONES = [100, 30, 7] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert a YYYY-MM-DD string to a day number (days since the Unix epoch,
 * measured at UTC midnight) without falling into DST traps. Returns null
 * for malformed values.
 */
export function dateStringToDayNum(value: string): number | null {
  if (!DATE_ONLY.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / DAY_MS);
}

export function dayNumToDateString(dayNum: number): string {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Bucket an instant into a YYYY-MM-DD calendar day in the given IANA
 * timezone (e.g. "Asia/Karachi"). This mirrors what the diary client does
 * with the browser's local timezone when it stamps an entry date, so the
 * boundary behaviour can be unit-tested here.
 */
export function toLocalDateOnly(instant: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(instant); // en-CA yields YYYY-MM-DD
}

export function computeStreak(
  loggedDates: readonly string[],
  today: string,
): StreakResult {
  const todayNum = dateStringToDayNum(today);
  const dayNums = new Set<number>();
  for (const d of loggedDates) {
    const n = dateStringToDayNum(d);
    if (n !== null) dayNums.add(n);
  }

  const empty: StreakResult = {
    currentStreak: 0,
    longestStreak: 0,
    lastLoggedDate: null,
    todayLogged: false,
    milestone: null,
  };
  if (todayNum === null || dayNums.size === 0) return empty;

  const sorted = [...dayNums].sort((a, b) => a - b);
  const lastLoggedNum = sorted[sorted.length - 1];

  // Longest run anywhere in history.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak: the run ending at today, or the run ending at yesterday
  // when today is not yet logged (alive until end of today). Entries dated
  // in the future never count toward the current streak.
  const todayLogged = dayNums.has(todayNum);
  const anchor = todayLogged ? todayNum : todayNum - 1;
  let current = 0;
  if (dayNums.has(anchor)) {
    let n = anchor;
    while (dayNums.has(n)) {
      current += 1;
      n -= 1;
    }
  }

  let milestone: number | null = null;
  for (const m of STREAK_MILESTONES) {
    if (current >= m) {
      milestone = m;
      break;
    }
  }

  return {
    currentStreak: current,
    longestStreak: longest,
    lastLoggedDate: dayNumToDateString(lastLoggedNum),
    todayLogged,
    milestone,
  };
}
