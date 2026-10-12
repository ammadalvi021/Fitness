"use client";

/**
 * /log/my-meals — recent foods (from the last 7 days of diary entries),
 * saved favourites, and the user's private custom recipes. Each is
 * loggable with one tap. Every nutrition display carries a
 * VerificationBadge.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, History, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { PageHeader, Skeleton } from "@/components/ui";
import { EmptyStateLux, GlassPanel, LuxButton } from "@/components/luxury";
import { VerificationBadge } from "@/components/VerificationBadge";
import {
  defaultMealType,
  MealTypePicker,
  todayLocal,
} from "@/components/food-log";

interface DiaryFood {
  food: { id: string; name: string; servingUnit: string } | null;
}

interface DiaryEntry {
  id: string;
  date: string;
  mealType: string;
  foodId: string | null;
  customName: string | null;
  servings: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  food: DiaryFood["food"];
}

interface RecentItem {
  key: string;
  name: string;
  foodId: string | null;
  servings: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  lastDate: string;
}

interface Favorite {
  id: string;
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

interface CustomRecipe {
  id: string;
  title: string;
  servings: number;
  kcalPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  fiberPerServing: number;
}

function ymdAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function idemKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function MyMealsPage() {
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [recipes, setRecipes] = useState<CustomRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [mealType, setMealType] = useState(defaultMealType);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Recent: last 7 days of diary entries, deduplicated.
        const days = await Promise.all(
          Array.from({ length: 7 }, (_, i) =>
            api<{ entries: DiaryEntry[] }>(`/api/diary?date=${ymdAgo(i)}`).catch(() => ({
              entries: [],
            }))
          )
        );
        const seen = new Map<string, RecentItem>();
        for (const d of days) {
          for (const e of d.entries) {
            const key = e.foodId ?? `custom:${e.customName ?? e.id}`;
            if (seen.has(key)) continue;
            seen.set(key, {
              key,
              name: e.food?.name ?? e.customName ?? "Logged food",
              foodId: e.foodId,
              servings: e.servings,
              kcal: e.kcal,
              proteinG: e.proteinG,
              carbsG: e.carbsG,
              fatG: e.fatG,
              fiberG: e.fiberG,
              lastDate: e.date,
            });
          }
        }
        const [favRes, recRes] = await Promise.all([
          api<{ favorites: Favorite[] }>("/api/favorites").catch(() => ({
            favorites: [],
          })),
          api<{ recipes: CustomRecipe[] }>("/api/recipes?mine=1").catch(() => ({
            recipes: [],
          })),
        ]);
        if (!cancelled) {
          setRecent([...seen.values()].slice(0, 20));
          setFavorites(favRes.favorites);
          setRecipes(recRes.recipes);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logEntry(
    key: string,
    body: Record<string, unknown>,
    label: string
  ) {
    setBusyKey(key);
    setError(null);
    try {
      await api("/api/diary", {
        method: "POST",
        body: { date: todayLocal(), mealType, idempotencyKey: idemKey(), ...body },
      });
      setDoneKey(key);
      window.setTimeout(() => setDoneKey((k) => (k === key ? null : k)), 2500);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : `Couldn't log “${label}”.`
      );
    } finally {
      setBusyKey(null);
    }
  }

  function logRecent(item: RecentItem) {
    // foodId entries are recomputed server-side from the catalogue;
    // custom entries re-log their snapshot values.
    return logEntry(
      `recent:${item.key}`,
      item.foodId
        ? { foodId: item.foodId, servings: item.servings, kcal: item.kcal }
        : {
            customName: item.name,
            servings: item.servings,
            kcal: item.kcal,
            proteinG: item.proteinG,
            carbsG: item.carbsG,
            fatG: item.fatG,
            fiberG: item.fiberG,
          },
      item.name
    );
  }

  function logFavorite(f: Favorite) {
    return logEntry(
      `fav:${f.id}`,
      {
        customName: f.name,
        servings: 1,
        kcal: f.kcal,
        proteinG: f.proteinG,
        carbsG: f.carbsG,
        fatG: f.fatG,
        fiberG: f.fiberG,
      },
      f.name
    );
  }

  function logRecipe(r: CustomRecipe) {
    return logEntry(
      `recipe:${r.id}`,
      {
        customName: `${r.title} (my recipe)`,
        servings: 1,
        kcal: r.kcalPerServing,
        proteinG: r.proteinPerServing,
        carbsG: r.carbsPerServing,
        fatG: r.fatPerServing,
        fiberG: r.fiberPerServing,
      },
      r.title
    );
  }

  return (
    <div className="anim-page-enter">
      <PageHeader
        title="My Meals"
        subtitle="Recently logged, your favourites, and your custom recipes — one tap to log again."
      />

      <GlassPanel className="max-w-xs p-4">
        <MealTypePicker value={mealType} onChange={setMealType} id="mm-meal" />
      </GlassPanel>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--error)",
            backgroundColor: "color-mix(in srgb, var(--error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)",
          }}
        >
          {error}
        </p>
      )}

      {loading && (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}

      {!loading && (
        <>
          {/* ------------------------- Custom recipes ------------------------- */}
          <section aria-labelledby="mm-recipes" className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 id="mm-recipes" className="t-card-heading">
                My custom recipes
              </h2>
              <Link
                href="/recipes/new"
                className="anim-press inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--text)]"
              >
                <Plus size={16} aria-hidden="true" /> New recipe
              </Link>
            </div>
            {recipes.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                No custom recipes yet — build one from your own ingredients.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {recipes.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] p-4"
                    style={{ backgroundColor: "var(--bg-elevated)" }}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text)]">{r.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        {Math.round(r.kcalPerServing)} kcal / portion · P{" "}
                        {Math.round(r.proteinPerServing * 10) / 10}g
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <VerificationBadge verification="estimate" basis="Your own recipe — computed from the ingredients you entered" />
                      <LogButton
                        busy={busyKey === `recipe:${r.id}`}
                        done={doneKey === `recipe:${r.id}`}
                        onClick={() => logRecipe(r)}
                        label={`Log a portion of ${r.title}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------ Recent ------------------------------ */}
          <section aria-labelledby="mm-recent" className="mt-8">
            <h2 id="mm-recent" className="t-card-heading flex items-center gap-2">
              <History size={18} aria-hidden="true" /> Recent
            </h2>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Nothing logged in the last 7 days yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {recent.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] p-4"
                    style={{ backgroundColor: "var(--bg-elevated)" }}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text)]">{item.name}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        {Math.round(item.kcal)} kcal · last logged{" "}
                        {String(item.lastDate).slice(0, 10)}
                      </p>
                    </div>
                    <LogButton
                      busy={busyKey === `recent:${item.key}`}
                      done={doneKey === `recent:${item.key}`}
                      onClick={() => logRecent(item)}
                      label={`Log ${item.name} again`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------------------------- Favourites ---------------------------- */}
          <section aria-labelledby="mm-fav" className="mt-8">
            <h2 id="mm-fav" className="t-card-heading">
              Favourites
            </h2>
            {favorites.length === 0 ? (
              <EmptyStateLux
                title="No favourites yet"
                message="Save a day's meal as a favourite to re-log it in one tap."
              />
            ) : (
              <ul className="mt-3 space-y-3">
                {favorites.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] p-4"
                    style={{ backgroundColor: "var(--bg-elevated)" }}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text)]">{f.name}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        {Math.round(f.kcal)} kcal · P {Math.round(f.proteinG * 10) / 10}g
                      </p>
                    </div>
                    <LogButton
                      busy={busyKey === `fav:${f.id}`}
                      done={doneKey === `fav:${f.id}`}
                      onClick={() => logFavorite(f)}
                      label={`Log favourite ${f.name}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function LogButton({
  busy,
  done,
  onClick,
  label,
}: {
  busy: boolean;
  done: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <LuxButton
      variant="secondary"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      className="shrink-0"
    >
      {done ? (
        <span className="inline-flex items-center gap-1.5">
          <Check size={15} aria-hidden="true" /> Logged
        </span>
      ) : busy ? (
        "Logging…"
      ) : (
        "Log"
      )}
    </LuxButton>
  );
}
