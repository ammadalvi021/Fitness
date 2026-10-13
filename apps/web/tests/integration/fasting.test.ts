/**
 * V20 Feature 5 — web persistence layer for the fasting timer (DB-free).
 *
 * Covers localStorage round-trips, corrupt-data handling, the journal cap,
 * and the cross-device reconcile rule. `localStorage` is stubbed because the
 * vitest environment is node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendJournal,
  clearLastCompleted,
  clearLocalActive,
  loadJournal,
  loadLastCompleted,
  loadLocalActive,
  reconcileCandidates,
  saveLastCompleted,
  saveLocalActive,
  type FastingJournalEntry,
} from '@/lib/fasting';
import type { FastingRecord } from '@fitfusion/core';

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
    __store: store,
  };
}

const T0 = Date.parse('2026-10-12T12:00:00Z');
const rec = (startedAtMs: number, targetMinutes = 960): FastingRecord => ({
  startedAt: new Date(startedAtMs).toISOString(),
  targetMinutes,
});

beforeEach(() => {
  // The lib gates storage behind `typeof window !== 'undefined'`, so stub
  // the window object itself (fresh store per test).
  vi.stubGlobal('window', { localStorage: makeStorage() });
});

function ls(): Storage {
  return (window as unknown as { localStorage: Storage }).localStorage;
}

describe('active fast localStorage round-trip', () => {
  it('saves and loads the active fast', () => {
    const r = rec(T0);
    expect(saveLocalActive(r)).toBe(true);
    expect(loadLocalActive()).toEqual(r);
  });

  it('missing key → null', () => {
    expect(loadLocalActive()).toBeNull();
  });

  it('corrupt JSON → null (dropped, never throws)', () => {
    ls().setItem('ff-fasting-active', '{not json');
    expect(loadLocalActive()).toBeNull();
  });

  it('invalid record shape → null', () => {
    ls().setItem('ff-fasting-active', JSON.stringify({ startedAt: 'nope' }));
    expect(loadLocalActive()).toBeNull();
  });

  it('clear removes the active fast', () => {
    saveLocalActive(rec(T0));
    clearLocalActive();
    expect(loadLocalActive()).toBeNull();
  });

  it('last-completed round-trips independently of the active fast', () => {
    const done: FastingRecord = { ...rec(T0), endedAt: new Date(T0 + 8 * 3_600_000).toISOString() };
    saveLocalActive(rec(T0 + 10 * 3_600_000));
    expect(saveLastCompleted(done)).toBe(true);
    expect(loadLastCompleted()).toEqual(done);
    expect(loadLocalActive()?.startedAt).toBe(new Date(T0 + 10 * 3_600_000).toISOString());
    clearLastCompleted();
    expect(loadLastCompleted()).toBeNull();
  });
});

describe('journal', () => {
  const entry = (i: number): FastingJournalEntry => ({
    startedAt: new Date(T0 + i * 1000).toISOString(),
    endedAt: new Date(T0 + i * 1000 + 8 * 3_600_000).toISOString(),
    targetMinutes: 960,
    durationMinutes: 480,
    completionPct: 50,
    note: i % 2 === 0 ? `note ${i}` : null,
    loggedAt: new Date(T0 + i * 1000 + 8 * 3_600_000).toISOString(),
  });

  it('starts empty and appends newest-first', () => {
    expect(loadJournal()).toEqual([]);
    appendJournal(entry(1));
    appendJournal(entry(2));
    const j = loadJournal();
    expect(j).toHaveLength(2);
    expect(j[0].note).toBe('note 2');
    expect(j[1].note).toBeNull();
  });

  it('is capped at 30 entries', () => {
    for (let i = 0; i < 40; i++) appendJournal(entry(i));
    expect(loadJournal()).toHaveLength(30);
  });

  it('corrupt journal → empty array', () => {
    ls().setItem('ff-fasting-journal', 'junk');
    expect(loadJournal()).toEqual([]);
  });
});

describe('cross-device reconcile', () => {
  it('local wins ties; later start wins otherwise', () => {
    const local = rec(T0);
    const newer = rec(T0 + 3_600_000);
    expect(reconcileCandidates(local, null)).toEqual(local);
    expect(reconcileCandidates(null, newer)).toEqual(newer);
    // tie → local (primary on this device)
    expect(reconcileCandidates(local, rec(T0))).toEqual(local);
    // newer server copy (started on another device) wins
    expect(reconcileCandidates(local, newer)).toEqual(newer);
  });

  it('ended or invalid candidates are ignored', () => {
    const ended: FastingRecord = { ...rec(T0), endedAt: new Date(T0 + 1000).toISOString() };
    expect(reconcileCandidates(ended, null)).toBeNull();
    expect(reconcileCandidates(null, ended)).toBeNull();
    expect(reconcileCandidates(null, null)).toBeNull();
  });
});
