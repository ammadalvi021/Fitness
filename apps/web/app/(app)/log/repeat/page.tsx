"use client";

/**
 * /log/repeat — meal repeats & favourites (V18 Phase E).
 *
 * - "Repeat yesterday": one tap re-logs yesterday's entries to today with
 *   fresh, deterministic idempotency keys (repeat-<date>-<entryId>) so
 *   double-tapping replays instead of duplicating. Nutrients are
 *   re-snapshotted server-side from the food's current values.
 * - "Copy from date": pick any date, preview its meals, select, log to today.
 * - Favourites: log a saved favourite; save today's meal as a favourite.
 * - Recent foods: your last 20 distinct logged foods, one-tap re-log.
 */
import { useEffect, useState } from "react";
import { CalendarDays, Check, Heart, History, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { buildRepeatPayload, type RepeatSourceEntry } from "@/lib/repeat";
import { GlassPanel, LuxBadge, LuxButton } from "@/components/luxury";
import { Input, Select, Skeleton } from "@/components/ui";
import {
  addDaysYMD,
  formatDayLabel,
  mealLabel,
  mealTypeOptions,
  todayYMD,
} from "../../nutrition/_shared";
import type { MealType } from "@fitfusion/core";
import { useSession } from "@/components/session";

interface DiaryEntryLike {
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
  food?: { id: string; name: string } | null;
}

interface FavoriteLike {
  id: string;
  name: string;
  items: unknown;
  kcal: number;
}

interface RecentFoodLike {
  foodId: string | null;
  name: string;
  servingUnit: string | null;
}

function entryName(e: DiaryEntryLike): string {
  return e.food?.name ?? e.customName ?? "Logged item";
}

export default function RepeatPage() {
  const session = useSession();
  const ramadanMode = Boolean(
    (session.profile as Record<string, unknown> | null)?.ramadanMode,
  );
  const options = mealTypeOptions(ramadanMode);
  const today = todayYMD();
  const yesterday = addDaysYMD(today, -1);

  const [yEntries, setYEntries] = useState<DiaryEntryLike[] | null>(null);
  const [repeating, setRepeating] = useState(false);
  const [repeatDone, setRepeatDone] = useState<number | null>(null);

  const [copyDate, setCopyDate] = useState(yesterday);
  const [copyEntries, setCopyEntries] = useState<DiaryEntryLike[] | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [copyDone, setCopyDone] = useState<number | null>(null);

  const [favorites, setFavorites] = useState<FavoriteLike[] | null>(null);
  const [favName, setFavName] = useState("");
  const [favBusy, setFavBusy] = useState<string | null>(null);
  const [favMealType, setFavMealType] = useState<MealType>("lunch");

  const [recent, setRecent] = useState<RecentFoodLike[] | null>(null);
  const [recentMealType, setRecentMealType] = useState<MealType>("lunch");
  const [recentBusy, setRecentBusy] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  async function loadDay(date: string): Promise<DiaryEntryLike[]> {
    const data = await api<{ entries?: DiaryEntryLike[] }>(
      `/api/diary?date=${encodeURIComponent(date)}`,
    );
    return Array.isArray(data.entries) ? data.entries : [];
  }

  useEffect(() => {
    let cancelled = false;
    loadDay(yesterday)
      .then((e) => { if (!cancelled) setYEntries(e); })
      .catch(() => { if (!cancelled) setYEntries([]); });
    api<{ favorites?: FavoriteLike[] }>("/api/favorites")
      .then((d) => { if (!cancelled) setFavorites(Array.isArray(d.favorites) ? d.favorites : []); })
      .catch(() => { if (!cancelled) setFavorites([]); });
    api<{ foods?: RecentFoodLike[] }>("/api/diary/recent?limit=20")
      .then((d) => { if (!cancelled) setRecent(Array.isArray(d.foods) ? d.foods : []); })
      .catch(() => { if (!cancelled) setRecent([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCopyLoading(true);
    setSelected(new Set());
    loadDay(copyDate)
      .then((e) => { if (!cancelled) { setCopyEntries(e); setCopyLoading(false); } })
      .catch(() => { if (!cancelled) { setCopyEntries([]); setCopyLoading(false); } });
    return () => { cancelled = true; };
  }, [copyDate]);

  async function postRepeat(entry: RepeatSourceEntry) {
    const { body, idempotencyKey } = buildRepeatPayload(entry, today);
    await api("/api/diary", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
  }

  async function repeatYesterday() {
    if (!yEntries || yEntries.length === 0) return;
    setRepeating(true);
    setError(null);
    try {
      for (const e of yEntries) await postRepeat(e);
      setRepeatDone(yEntries.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't repeat all entries.");
    } finally {
      setRepeating(false);
    }
  }

  async function copySelected() {
    const list = (copyEntries ?? []).filter((e) => selected.has(e.id));
    if (list.length === 0) return;
    setCopying(true);
    setError(null);
    try {
      for (const e of list) await postRepeat(e);
      setCopyDone(list.length);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't copy all entries.");
    } finally {
      setCopying(false);
    }
  }

  async function logFavorite(fav: FavoriteLike) {
    setFavBusy(fav.id);
    setError(null);
    try {
      const items = Array.isArray(fav.items) ? fav.items : [];
      if (items.length === 0) {
        // Recipe-style favourite: log the saved totals as one manual entry.
        await api("/api/diary", {
          method: "POST",
          headers: { "Idempotency-Key": `fav-${today}-${fav.id}-${Date.now()}` },
          body: {
            date: today, mealType: favMealType, customName: fav.name, servings: 1,
            kcal: Math.round(fav.kcal),
            proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
          },
        });
      } else {
        for (let i = 0; i < items.length; i++) {
          const it = items[i] as Record<string, unknown>;
          const foodId = typeof it.foodId === "string" ? it.foodId : undefined;
          const body: Record<string, unknown> = {
            date: today,
            mealType: typeof it.mealType === "string" ? it.mealType : favMealType,
            servings: typeof it.servings === "number" && it.servings > 0 ? it.servings : 1,
          };
          if (foodId) {
            body.foodId = foodId;
            body.customName = it.customName ?? undefined;
          } else {
            body.customName = it.customName ?? fav.name;
            body.kcal = it.kcal ?? 0;
            body.proteinG = it.proteinG ?? 0;
            body.carbsG = it.carbsG ?? 0;
            body.fatG = it.fatG ?? 0;
            body.fiberG = it.fiberG ?? 0;
          }
          await api("/api/diary", {
            method: "POST",
            headers: { "Idempotency-Key": `fav-${today}-${fav.id}-${i}` },
            body,
          });
        }
      }
      setFavBusy(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log that favourite.");
      setFavBusy(null);
    }
  }

  async function saveTodayAsFavorite() {
    const name = favName.trim();
    if (!name) {
      setError("Name your favourite first (e.g. “Workday lunch”).");
      return;
    }
    setFavBusy("save");
    setError(null);
    try {
      await api("/api/favorites", { method: "POST", body: { name, date: today } });
      setFavName("");
      const d = await api<{ favorites?: FavoriteLike[] }>("/api/favorites");
      setFavorites(Array.isArray(d.favorites) ? d.favorites : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that favourite.");
    } finally {
      setFavBusy(null);
    }
  }

  async function logRecent(r: RecentFoodLike) {
    setRecentBusy(r.foodId ?? r.name);
    setError(null);
    try {
      await api("/api/diary", {
        method: "POST",
        headers: { "Idempotency-Key": `recent-${today}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
        body: r.foodId
          ? { date: today, mealType: recentMealType, foodId: r.foodId, customName: r.name, servings: 1 }
          : { date: today, mealType: recentMealType, customName: r.name, servings: 1, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log that food.");
    } finally {
      setRecentBusy(null);
    }
  }

  return (
    <div className="anim-page-enter">
      <h1 className="t-greeting">Repeat & favourites</h1>
      <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
        Eat the same thing often? Re-log it in one tap.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl px-4 py-3 text-sm"
          style={{ color: "var(--error)", backgroundColor: "color-mix(in srgb, var(--error) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)" }}>
          {error}
        </p>
      )}

      {/* Repeat yesterday */}
      <GlassPanel className="mt-4 p-5">
        <h2 className="t-card-heading flex items-center gap-2">
          <History size={18} aria-hidden="true" /> Repeat yesterday
        </h2>
        {yEntries === null ? (
          <Skeleton className="mt-3 h-10 w-full" />
        ) : yEntries.length === 0 ? (
          <p className="t-body mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Nothing logged yesterday ({formatDayLabel(yesterday)}).
          </p>
        ) : (
          <>
            <ul className="t-body mt-2 space-y-1 text-sm">
              {yEntries.map((e) => (
                <li key={e.id}>
                  <LuxBadge>{mealLabel(e.mealType)}</LuxBadge>{" "}
                  {entryName(e)} · {e.servings} serving{e.servings === 1 ? "" : "s"} · {Math.round(e.kcal)} kcal
                </li>
              ))}
            </ul>
            <LuxButton className="mt-3" disabled={repeating} onClick={() => void repeatYesterday()}>
              {repeating ? "Logging…" : `Log all ${yEntries.length} to today`}
            </LuxButton>
            {repeatDone != null && (
              <p className="t-body mt-2 flex items-center gap-1.5 text-sm" style={{ color: "var(--success)" }}>
                <Check size={15} aria-hidden="true" /> {repeatDone} entr{repeatDone === 1 ? "y" : "ies"} logged to today.
              </p>
            )}
          </>
        )}
      </GlassPanel>

      {/* Copy from date */}
      <GlassPanel className="mt-4 p-5">
        <h2 className="t-card-heading flex items-center gap-2">
          <CalendarDays size={18} aria-hidden="true" /> Copy from a date
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="t-meta" htmlFor="copy-date">Date</label>
          <Input
            id="copy-date" type="date" value={copyDate} max={today}
            onChange={(e) => e.target.value && setCopyDate(e.target.value)}
            className="w-auto"
          />
        </div>
        {copyLoading ? (
          <Skeleton className="mt-3 h-10 w-full" />
        ) : !copyEntries || copyEntries.length === 0 ? (
          <p className="t-body mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Nothing logged on {formatDayLabel(copyDate)}.
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-2">
              {copyEntries.map((e) => (
                <li key={e.id}>
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={(ev) => setSelected((s) => {
                        const n = new Set(s);
                        if (ev.target.checked) n.add(e.id); else n.delete(e.id);
                        return n;
                      })}
                      className="h-5 w-5"
                      style={{ accentColor: "var(--brand)" }}
                      aria-label={`Select ${entryName(e)}`}
                    />
                    <span className="t-body text-sm">
                      <LuxBadge>{mealLabel(e.mealType)}</LuxBadge>{" "}
                      {entryName(e)} · {Math.round(e.kcal)} kcal
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <LuxButton className="mt-3" disabled={copying || selected.size === 0} onClick={() => void copySelected()}>
              {copying ? "Logging…" : `Log ${selected.size} selected to today`}
            </LuxButton>
            {copyDone != null && (
              <p className="t-body mt-2 flex items-center gap-1.5 text-sm" style={{ color: "var(--success)" }}>
                <Check size={15} aria-hidden="true" /> {copyDone} logged to today.
              </p>
            )}
          </>
        )}
      </GlassPanel>

      {/* Favourites */}
      <GlassPanel className="mt-4 p-5">
        <h2 className="t-card-heading flex items-center gap-2">
          <Heart size={18} aria-hidden="true" /> Favourites
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label className="t-meta" htmlFor="fav-name">Save today&apos;s meal as…</label>
            <Input id="fav-name" value={favName} onChange={(e) => setFavName(e.target.value)} placeholder="e.g. Workday lunch" />
          </div>
          <LuxButton variant="secondary" disabled={favBusy === "save"} onClick={() => void saveTodayAsFavorite()}>
            <Plus size={16} aria-hidden="true" /> {favBusy === "save" ? "Saving…" : "Save today"}
          </LuxButton>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="t-meta" htmlFor="fav-meal">Log favourites to</label>
          <Select id="fav-meal" value={favMealType} onChange={(e) => setFavMealType(e.target.value as MealType)} className="w-auto">
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        {favorites === null ? (
          <Skeleton className="mt-3 h-10 w-full" />
        ) : favorites.length === 0 ? (
          <p className="t-body mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            No favourites yet — save today&apos;s meal above.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {favorites.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
                <div className="min-w-0">
                  <p className="t-body truncate font-medium">{f.name}</p>
                  <p className="t-meta">{Math.round(f.kcal)} kcal</p>
                </div>
                <LuxButton variant="secondary" disabled={favBusy === f.id} onClick={() => void logFavorite(f)} aria-label={`Log ${f.name} to today`}>
                  {favBusy === f.id ? "Logging…" : "Log to today"}
                </LuxButton>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      {/* Recent foods */}
      <GlassPanel className="mt-4 p-5">
        <h2 className="t-card-heading">Recent foods</h2>
        <p className="t-meta mt-1 normal-case tracking-normal">Your last 20 distinct logged foods.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="t-meta" htmlFor="recent-meal">Log to</label>
          <Select id="recent-meal" value={recentMealType} onChange={(e) => setRecentMealType(e.target.value as MealType)} className="w-auto">
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        {recent === null ? (
          <Skeleton className="mt-3 h-10 w-full" />
        ) : recent.length === 0 ? (
          <p className="t-body mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Nothing logged yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recent.map((r, i) => {
              const key = r.foodId ?? `name-${i}`;
              return (
                <li key={key} className="flex items-center justify-between gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
                  <p className="t-body truncate text-sm font-medium">{r.name}</p>
                  <LuxButton variant="secondary" disabled={recentBusy === key} onClick={() => void logRecent(r)} aria-label={`Log ${r.name} to ${recentMealType}`}>
                    {recentBusy === key ? "Logging…" : "Log"}
                  </LuxButton>
                </li>
              );
            })}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}
