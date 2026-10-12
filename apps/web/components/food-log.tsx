"use client";

/**
 * Shared Log-a-Meal UI: food rows with portion pickers + add-to-diary.
 * Diary entries snapshot nutrients server-side (POST /api/diary recomputes
 * from the Food), and every nutrition display renders VerificationBadge.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field, Select } from "@/components/ui";
import { LuxButton } from "@/components/luxury";
import { VerificationBadge } from "@/components/VerificationBadge";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PortionDto {
  id: string;
  label: string;
  labelUrdu: string | null;
  grams: number | null;
  ml: number | null;
}

export interface FoodDto {
  id: string;
  name: string;
  brand: string | null;
  category: { id: string; name: string; nameUrdu: string | null } | null;
  servingSize: number;
  servingUnit: string;
  perServing: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };
  portions: PortionDto[];
  countryCodes: string[];
  verification: string;
  basis: string | null;
  source: string;
  verified: boolean;
}

export type AppLanguage = "en" | "ur" | "roman-ur";

export const MEAL_TYPES = [
  { value: "breakfast", label: "Breakfast" },
  { value: "morning_snack", label: "Morning snack" },
  { value: "lunch", label: "Lunch" },
  { value: "afternoon_snack", label: "Afternoon snack" },
  { value: "dinner", label: "Dinner" },
  { value: "extra", label: "Extra" },
] as const;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function todayLocal(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Sensible default meal from the local time of day. */
export function defaultMealType(): string {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 12) return "morning_snack";
  if (h < 15) return "lunch";
  if (h < 18) return "afternoon_snack";
  if (h < 22) return "dinner";
  return "extra";
}

/** Gram/ml equivalent of a portion; ml ≈ grams for drinks. */
export function portionAmount(p: PortionDto): number | null {
  if (typeof p.grams === "number" && p.grams > 0) return p.grams;
  if (typeof p.ml === "number" && p.ml > 0) return p.ml;
  return null;
}

export function portionAmountLabel(p: PortionDto): string {
  const amt = portionAmount(p);
  if (amt === null) return "";
  const unit = typeof p.ml === "number" && p.ml > 0 && !(typeof p.grams === "number" && p.grams > 0) ? "ml" : "g";
  return `≈ ${amt} ${unit}`;
}

/** Label shown for a food name honoring the language setting. */
export function foodDisplayName(food: FoodDto, language: AppLanguage): string {
  return food.name;
}

/* ------------------------------------------------------------------ */
/* Profile locale hook                                                 */
/* ------------------------------------------------------------------ */

export function useProfileLocale(): { language: AppLanguage; country: string } {
  const [locale, setLocale] = useState<{ language: AppLanguage; country: string }>({
    language: "en",
    country: "PK",
  });
  useEffect(() => {
    let cancelled = false;
    api<{ profile: { language?: string; country?: string } | null }>("/api/profile")
      .then((d) => {
        if (cancelled) return;
        const lang = d.profile?.language;
        setLocale({
          language: lang === "ur" || lang === "roman-ur" ? lang : "en",
          country: d.profile?.country ?? "PK",
        });
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return locale;
}

/* ------------------------------------------------------------------ */
/* FoodLogRow — one food with portion picker, quantity, add-to-diary   */
/* ------------------------------------------------------------------ */

export function FoodLogRow({
  food,
  language,
  mealType,
  onLogged,
  compact = false,
}: {
  food: FoodDto;
  language: AppLanguage;
  mealType: string;
  onLogged?: (foodName: string) => void;
  compact?: boolean;
}) {
  const [portionIdx, setPortionIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portion = food.portions[portionIdx] ?? null;
  const portionG = portion ? portionAmount(portion) : null;

  // Servings relative to the food's serving: servings = grams / servingSize.
  // The server recomputes nutrients from the Food — we only send servings.
  const servings = useMemo(() => {
    if (portionG !== null && food.servingSize > 0) {
      return Math.round(((portionG * qty) / food.servingSize) * 100) / 100;
    }
    return qty;
  }, [portionG, qty, food.servingSize]);

  const shown = useMemo(() => {
    const f = food.perServing;
    return {
      kcal: Math.round(f.kcal * servings),
      proteinG: Math.round(f.proteinG * servings * 10) / 10,
      carbsG: Math.round(f.carbsG * servings * 10) / 10,
      fatG: Math.round(f.fatG * servings * 10) / 10,
    };
  }, [food.perServing, servings]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/diary", {
        method: "POST",
        body: {
          date: todayLocal(),
          mealType,
          foodId: food.id,
          servings,
          kcal: shown.kcal,
          proteinG: shown.proteinG,
          carbsG: shown.carbsG,
          fatG: shown.fatG,
          idempotencyKey:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      });
      setDone(true);
      onLogged?.(food.name);
      window.setTimeout(() => setDone(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log this food.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-2xl border border-[var(--border)] p-4"
      style={{ backgroundColor: "var(--bg-elevated)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--text)]">{foodDisplayName(food, language)}</p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            {food.category?.nameUrdu && language !== "en" ? `${food.category.nameUrdu} · ` : ""}
            {food.category?.name ?? "Food"} · per {food.servingUnit}
          </p>
        </div>
        <VerificationBadge verification={food.verification} basis={food.basis} />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="text-lg font-bold text-[var(--text)]">{shown.kcal} kcal</span>
        <span className="text-[var(--text-secondary)]">P {shown.proteinG}g</span>
        <span className="text-[var(--text-secondary)]">C {shown.carbsG}g</span>
        <span className="text-[var(--text-secondary)]">F {shown.fatG}g</span>
      </div>

      {!compact && food.portions.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Portion" htmlFor={`portion-${food.id}`}>
            <Select
              id={`portion-${food.id}`}
              value={String(portionIdx)}
              onChange={(e) => setPortionIdx(Number(e.target.value))}
            >
              {food.portions.map((p, i) => (
                <option key={p.id} value={i}>
                  {language !== "en" && p.labelUrdu ? p.labelUrdu : p.label}
                  {portionAmountLabel(p) ? ` (${portionAmountLabel(p)})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-[var(--text)]">
              Quantity
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQty((v) => Math.max(0.5, Math.round((v - 0.5) * 10) / 10))}
                className="anim-press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--border)]"
                style={{ color: "var(--text)" }}
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <span aria-live="polite" className="min-w-[3rem] text-center font-semibold text-[var(--text)]">
                {qty}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQty((v) => Math.round((v + 0.5) * 10) / 10)}
                className="anim-press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--border)]"
                style={{ color: "var(--text)" }}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              {portionG !== null && (
                <span className="text-xs text-[var(--text-secondary)]">
                  ≈ {Math.round(portionG * qty)} g total
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      <LuxButton
        onClick={add}
        disabled={busy}
        className="mt-3 w-full"
        aria-label={done ? `${food.name} logged` : `Log ${food.name} to diary`}
      >
        {done ? (
          <span className="inline-flex items-center gap-2">
            <Check size={16} aria-hidden="true" /> Logged ✓
          </span>
        ) : busy ? (
          "Logging…"
        ) : (
          `Add to diary · ${shown.kcal} kcal`
        )}
      </LuxButton>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MealTypePicker                                                      */
/* ------------------------------------------------------------------ */

export function MealTypePicker({
  value,
  onChange,
  id = "meal-type",
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  return (
    <Field label="Meal" htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {MEAL_TYPES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* useFoodSearch — debounced search against GET /api/foods             */
/* ------------------------------------------------------------------ */

export function useFoodSearch() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [foods, setFoods] = useState<FoodDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set("q", debounced);
      if (category) params.set("category", category);
      if (country) params.set("country", country);
      if (verifiedOnly) params.set("verified", "true");
      params.set("limit", "30");
      const res = await api<{ foods: FoodDto[]; total: number }>(
        `/api/foods?${params.toString()}`
      );
      setFoods(res.foods);
      setTotal(res.total);
    } catch {
      setFoods([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debounced, category, country, verifiedOnly]);

  useEffect(() => {
    search();
  }, [search]);

  return {
    query, setQuery, category, setCategory, country, setCountry,
    verifiedOnly, setVerifiedOnly,
    foods, total, loading, refresh: search,
  };
}
