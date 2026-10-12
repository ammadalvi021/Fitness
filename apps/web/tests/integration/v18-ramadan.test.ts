/**
 * V18 Phase E: Ramadan window storage + notification helpers — unit tests (no DB).
 * localStorage is stubbed in-memory because vitest runs in node env.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFastingWindow,
  hhmmToMinutes,
  isValidWindowTime,
  loadFastingWindow,
  loadNotifyPref,
  loadSwapsEnabled,
  minutesUntil,
  RAMADAN_WINDOW_KEY,
  saveFastingWindow,
  saveNotifyPref,
  saveSwapsEnabled,
} from '@/lib/ramadan';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = { localStorage: new MemoryStorage() };
});

describe('fasting window storage', () => {
  it('round-trips a valid window', () => {
    expect(saveFastingWindow({ start: '04:30', end: '18:45' })).toBe(true);
    expect(loadFastingWindow()).toEqual({ start: '04:30', end: '18:45' });
  });

  it('rejects invalid times and never persists them', () => {
    expect(saveFastingWindow({ start: '25:00', end: '18:45' })).toBe(false);
    expect(saveFastingWindow({ start: '4:30', end: '18:45' })).toBe(false);
    expect(loadFastingWindow()).toBeNull();
  });

  it('clear removes the window', () => {
    saveFastingWindow({ start: '04:30', end: '18:45' });
    clearFastingWindow();
    expect(loadFastingWindow()).toBeNull();
  });

  it('ignores corrupted storage', () => {
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: () => '{not json',
        setItem: () => {}, removeItem: () => {},
      },
    };
    expect(loadFastingWindow()).toBeNull();
  });

  it('exposes the storage key constant for UI copy', () => {
    expect(RAMADAN_WINDOW_KEY).toBe('ff-ramadan-window');
  });
});

describe('isValidWindowTime', () => {
  it('accepts HH:MM 24h', () => {
    expect(isValidWindowTime('00:00')).toBe(true);
    expect(isValidWindowTime('23:59')).toBe(true);
  });
  it('rejects malformed times', () => {
    for (const bad of ['', '4:30', '24:00', '12:60', 'noon', '12-30']) {
      expect(isValidWindowTime(bad)).toBe(false);
    }
  });
});

describe('minutesUntil', () => {
  it('computes minutes to a later time today', () => {
    const now = new Date(2026, 9, 12, 10, 0, 0);
    expect(minutesUntil('12:00', now)).toBe(120);
  });
  it('wraps to tomorrow when the time already passed', () => {
    const now = new Date(2026, 9, 12, 20, 0, 0);
    expect(minutesUntil('04:30', now)).toBe(8 * 60 + 30);
  });
});

describe('hhmmToMinutes', () => {
  it('converts correctly', () => {
    expect(hhmmToMinutes('04:30')).toBe(270);
    expect(hhmmToMinutes('18:45')).toBe(1125);
  });
});

describe('preference toggles', () => {
  it('notification opt-in round-trips, default off', () => {
    expect(loadNotifyPref()).toBe(false);
    saveNotifyPref(true);
    expect(loadNotifyPref()).toBe(true);
    saveNotifyPref(false);
    expect(loadNotifyPref()).toBe(false);
  });

  it('swaps toggle defaults ON and round-trips', () => {
    expect(loadSwapsEnabled()).toBe(true);
    saveSwapsEnabled(false);
    expect(loadSwapsEnabled()).toBe(false);
    saveSwapsEnabled(true);
    expect(loadSwapsEnabled()).toBe(true);
  });
});
