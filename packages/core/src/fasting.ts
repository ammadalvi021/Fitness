/**
 * Intermittent fasting — pure timer logic (V20 Feature 5).
 *
 * No I/O, no storage: everything here is a pure function of the record and a
 * "now" timestamp, which is what makes it fully unit-testable. Persistence
 * (localStorage + server) lives in `apps/web/lib/fasting.ts`.
 *
 * Design notes:
 * - A FastingRecord is one fast: when it started and how long the target is.
 * - `endedAt` is only set once the fast is over (user ended it, or the
 *   target elapsed while the app reloaded). An active fast has no endedAt.
 * - Timer state is real user state — no values are ever fabricated here;
 *   every function is anchored to explicit timestamps.
 */

import { z } from 'zod';

export const FASTING_PRESETS = [
  { label: '14:10', fastingHours: 14 },
  { label: '16:8', fastingHours: 16 },
  { label: '18:6', fastingHours: 18 },
  { label: '20:4', fastingHours: 20 },
] as const;

/** Bounds for a custom fast: 1 hour … 72 hours. */
export const MIN_FAST_MINUTES = 60;
export const MAX_FAST_MINUTES = 72 * 60;

export const FastingRecordSchema = z.object({
  /** ISO 8601 instant the fast started. */
  startedAt: z.string().datetime({ message: 'startedAt must be an ISO datetime' }),
  /** Target fast length in whole minutes. */
  targetMinutes: z
    .number()
    .int()
    .min(MIN_FAST_MINUTES, `fast must be at least ${MIN_FAST_MINUTES / 60}h`)
    .max(MAX_FAST_MINUTES, `fast must be at most ${MAX_FAST_MINUTES / 60}h`),
  /** ISO 8601 instant the fast actually ended. Absent while the fast is active. */
  endedAt: z.string().datetime().nullable().optional(),
  /** Optional user note, saved with the journal entry. */
  note: z.string().max(500).nullable().optional(),
});

export type FastingRecord = z.infer<typeof FastingRecordSchema>;

export function isValidFastingRecord(v: unknown): v is FastingRecord {
  return FastingRecordSchema.safeParse(v).success;
}

/** Epoch ms when the target completes. */
export function fastEndMs(r: FastingRecord): number {
  return Date.parse(r.startedAt) + r.targetMinutes * 60_000;
}

/**
 * Elapsed ms of the fast at `nowMs`.
 * - Ended fast: endedAt − startedAt (clamped ≥ 0).
 * - Active fast: now − startedAt, clamped to [0, target] (a clock skew /
 *   future start never produces negative elapsed time).
 */
export function elapsedMs(r: FastingRecord, nowMs: number = Date.now()): number {
  const start = Date.parse(r.startedAt);
  const target = r.targetMinutes * 60_000;
  const raw = r.endedAt ? Date.parse(r.endedAt) - start : nowMs - start;
  return Math.min(Math.max(0, raw), target);
}

/** ms remaining until the target completes. Never negative. */
export function remainingMs(r: FastingRecord, nowMs: number = Date.now()): number {
  if (r.endedAt) return 0;
  return Math.max(0, fastEndMs(r) - nowMs);
}

/** 0–100, rounded to one decimal. An ended fast reports its true duration. */
export function completionPct(r: FastingRecord, nowMs: number = Date.now()): number {
  const pct = (elapsedMs(r, nowMs) / (r.targetMinutes * 60_000)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}

/** Timer status of a record at `nowMs`. `null` input → 'idle'. */
export function fastingStatus(
  r: FastingRecord | null | undefined,
  nowMs: number = Date.now(),
): 'idle' | 'fasting' | 'complete' {
  if (!r || !isValidFastingRecord(r)) return 'idle';
  if (r.endedAt) return 'complete';
  return remainingMs(r, nowMs) <= 0 ? 'complete' : 'fasting';
}

/**
 * True when starting a new fast must ask for confirmation first — i.e. an
 * existing fast is still active (not yet complete).
 */
export function shouldConfirmReplace(
  active: FastingRecord | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return fastingStatus(active, nowMs) === 'fasting';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "7h 24m" / "42m 10s" / "0m 05s" — countdown readout for the live timer. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `0m ${pad(s)}s`;
}

/** "16h 00m" — duration readout for the summary/journal. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${pad(m)}m`;
}
