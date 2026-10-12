/**
 * Meal repeats / copy-from-date / recent-foods helpers (pure).
 *
 * Repeat-yesterday re-POSTs entries to a new date with FRESH idempotency
 * keys. The keys are deterministic per (source entry, target date) so
 * double-tapping "log all" replays instead of duplicating.
 */

export interface RepeatSourceEntry {
  id: string;
  mealType: string;
  foodId?: string | null;
  customName?: string | null;
  servings: number;
  kcal: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
}

export interface RepeatPayload {
  body: Record<string, unknown>;
  idempotencyKey: string;
}

/** Deterministic idempotency key for repeating one entry onto a target date. */
export function repeatIdempotencyKey(entryId: string, targetDate: string): string {
  return `repeat-${targetDate}-${entryId}`;
}

/**
 * Build the POST /api/diary payload for repeating `entry` onto `targetDate`.
 * Nutrients are re-snapshotted server-side from the food's CURRENT values
 * (the API recomputes from foodId); we pass the serving count through.
 */
export function buildRepeatPayload(entry: RepeatSourceEntry, targetDate: string): RepeatPayload {
  const body: Record<string, unknown> = {
    date: targetDate,
    mealType: entry.mealType,
    servings: entry.servings,
  };
  if (entry.foodId) {
    body.foodId = entry.foodId;
    body.customName = entry.customName ?? undefined;
  } else {
    body.customName = entry.customName ?? 'Logged item';
    body.kcal = entry.kcal;
    body.proteinG = entry.proteinG ?? 0;
    body.carbsG = entry.carbsG ?? 0;
    body.fatG = entry.fatG ?? 0;
    body.fiberG = entry.fiberG ?? 0;
  }
  return { body, idempotencyKey: repeatIdempotencyKey(entry.id, targetDate) };
}

export interface RecentFood {
  foodId?: string | null;
  name: string;
  servingUnit?: string | null;
  lastLoggedAt?: string | null;
}

/**
 * Derive the most recent distinct foods from diary history (newest first),
 * capped at `limit` (default 20). Dedupes by foodId, falling back to the
 * lowercased custom name for manual entries.
 */
export function distinctRecentFoods<T extends { foodId?: string | null; customName?: string | null }>(
  entries: T[],
  nameOf: (e: T) => string,
  limit = 20,
): RecentFood[] {
  const seen = new Set<string>();
  const out: RecentFood[] = [];
  for (const e of entries) {
    const key = e.foodId ? `food:${e.foodId}` : `name:${nameOf(e).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      foodId: e.foodId ?? null,
      name: nameOf(e),
    });
    if (out.length >= limit) break;
  }
  return out;
}
