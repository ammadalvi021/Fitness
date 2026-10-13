/**
 * Intermittent fasting — client-side persistence (V20 Feature 5).
 *
 * Two layers, mirroring the Ramadan-window pattern in `./ramadan`:
 *
 * 1. **localStorage (primary):** the active fast, the last completed fast
 *    (shown on reload), and a small journal of past fasts. Instant, offline,
 *    survives reloads on this device.
 * 2. **Server (cross-device):** `Profile.fastingSession` JSON column, synced
 *    through the existing `/api/profile` GET/PUT route. Survives devices.
 *
 * All parsing is defensive: corrupt entries are dropped, never thrown.
 * Pure timer math lives in `@fitfusion/core` (fasting.ts).
 */

import {
  isValidFastingRecord,
  type FastingRecord,
} from '@fitfusion/core';

export const FASTING_ACTIVE_KEY = 'ff-fasting-active';
export const FASTING_LAST_KEY = 'ff-fasting-last-completed';
export const FASTING_JOURNAL_KEY = 'ff-fasting-journal';
export const FASTING_JOURNAL_CAP = 30;

export interface FastingJournalEntry {
  startedAt: string;
  endedAt: string;
  targetMinutes: number;
  durationMinutes: number;
  completionPct: number;
  note: string | null;
  loggedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readRecord(key: string): FastingRecord | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return isValidFastingRecord(v) ? v : null;
  } catch {
    return null;
  }
}

function writeRecord(key: string, r: FastingRecord): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

function clearKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Active fast                                                         */
/* ------------------------------------------------------------------ */

export function loadLocalActive(): FastingRecord | null {
  return readRecord(FASTING_ACTIVE_KEY);
}

export function saveLocalActive(r: FastingRecord): boolean {
  return writeRecord(FASTING_ACTIVE_KEY, r);
}

export function clearLocalActive(): void {
  clearKey(FASTING_ACTIVE_KEY);
}

/* ------------------------------------------------------------------ */
/* Last completed (survives reload so the summary isn't lost)          */
/* ------------------------------------------------------------------ */

export function loadLastCompleted(): FastingRecord | null {
  return readRecord(FASTING_LAST_KEY);
}

export function saveLastCompleted(r: FastingRecord): boolean {
  return writeRecord(FASTING_LAST_KEY, r);
}

export function clearLastCompleted(): void {
  clearKey(FASTING_LAST_KEY);
}

/* ------------------------------------------------------------------ */
/* Journal (simple local record)                                       */
/* ------------------------------------------------------------------ */

export function loadJournal(): FastingJournalEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(FASTING_JOURNAL_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is FastingJournalEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { startedAt?: unknown }).startedAt === 'string' &&
        typeof (e as { endedAt?: unknown }).endedAt === 'string',
    );
  } catch {
    return [];
  }
}

export function appendJournal(entry: FastingJournalEntry): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const next = [entry, ...loadJournal()].slice(0, FASTING_JOURNAL_CAP);
    s.setItem(FASTING_JOURNAL_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Cross-device reconcile                                              */
/* ------------------------------------------------------------------ */

/**
 * Pick the authoritative active fast between the device-local record and the
 * server record. Rules:
 * - Only valid, still-active records are candidates.
 * - The record with the later `startedAt` wins (a fast started on another
 *   device after this device's copy must not be silently dropped).
 * - Ties go to the local copy (localStorage is primary on this device).
 */
export function reconcileCandidates(
  local: FastingRecord | null,
  server: FastingRecord | null,
): FastingRecord | null {
  const ok = (r: FastingRecord | null) =>
    r && isValidFastingRecord(r) && !r.endedAt ? r : null;
  const l = ok(local);
  const s = ok(server);
  if (l && s) {
    return Date.parse(s.startedAt) > Date.parse(l.startedAt) ? s : l;
  }
  return l ?? s;
}
