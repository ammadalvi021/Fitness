/**
 * Ramadan framework — client-side helpers (pure + localStorage).
 *
 * Fasting window: TWO time inputs the USER sets themselves, stored in
 * localStorage. These are NOT prayer times — FitFusion has no prayer-time
 * source and must never present these as such. Labels in the UI must say
 * "your fasting window".
 */

export const RAMADAN_WINDOW_KEY = 'ff-ramadan-window';
export const RAMADAN_NOTIFY_KEY = 'ff-ramadan-notify';
export const SWAPS_ENABLED_KEY = 'ff-swaps';

export interface FastingWindow {
  /** "HH:MM" 24h — when the user starts fasting. */
  start: string;
  /** "HH:MM" 24h — when the user ends fasting. */
  end: string;
}

export function isValidWindowTime(s: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadFastingWindow(): FastingWindow | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(RAMADAN_WINDOW_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Partial<FastingWindow>;
    if (typeof w.start === 'string' && typeof w.end === 'string' && isValidWindowTime(w.start) && isValidWindowTime(w.end)) {
      return { start: w.start, end: w.end };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveFastingWindow(w: FastingWindow): boolean {
  const s = storage();
  if (!s || !isValidWindowTime(w.start) || !isValidWindowTime(w.end)) return false;
  try {
    s.setItem(RAMADAN_WINDOW_KEY, JSON.stringify({ start: w.start, end: w.end }));
    return true;
  } catch {
    return false;
  }
}

export function clearFastingWindow(): void {
  try {
    storage()?.removeItem(RAMADAN_WINDOW_KEY);
  } catch {
    /* ignore */
  }
}

/** Minutes since local midnight for "HH:MM". */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Minutes until the next occurrence of `hhmm` from `now` (default: current
 * time). Used to schedule sehri/iftar notifications.
 */
export function minutesUntil(hhmm: string, now: Date = new Date()): number {
  const target = hhmmToMinutes(hhmm);
  const current = now.getHours() * 60 + now.getMinutes();
  let delta = target - current;
  if (delta <= 0) delta += 24 * 60;
  return delta;
}

/** Whether the user opted into in-browser Ramadan reminders. */
export function loadNotifyPref(): boolean {
  try {
    return storage()?.getItem(RAMADAN_NOTIFY_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveNotifyPref(on: boolean): void {
  try {
    if (on) storage()?.setItem(RAMADAN_NOTIFY_KEY, '1');
    else storage()?.removeItem(RAMADAN_NOTIFY_KEY);
  } catch {
    /* ignore */
  }
}

/** Swaps UI toggle (default ON). */
export function loadSwapsEnabled(): boolean {
  try {
    const v = storage()?.getItem(SWAPS_ENABLED_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export function saveSwapsEnabled(on: boolean): void {
  try {
    storage()?.setItem(SWAPS_ENABLED_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}
