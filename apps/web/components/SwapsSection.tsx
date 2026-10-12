"use client";

import { useEffect, useState } from "react";
import { Leaf } from "lucide-react";
import { api } from "@/lib/api";
import {
  foodResultToSwapLike,
  suggestSwaps,
  type SwapFoodLike,
  type SwapSuggestion,
} from "@/lib/swaps";
import { loadSwapsEnabled } from "@/lib/ramadan";
import { VerificationBadge } from "./VerificationBadge";

/**
 * "Lighter alternatives" — non-judgmental healthier-swap suggestions for one
 * food, shown under food search rows. Same-category, lower-calorie-density
 * options with a computed, honest basis ("55% fewer calories per 100g").
 * Dismissible per food; globally toggleable via the `ff-swaps` setting
 * (default on). Renders nothing when swaps are disabled or no lighter
 * option exists.
 */
export function SwapsSection({
  food,
  onUseInstead,
}: {
  food: SwapFoodLike;
  /** Called with the raw /api/foods record when the user picks a swap. */
  onUseInstead?: (rawFood: Record<string, unknown>) => void;
}) {
  const [enabled] = useState<boolean>(() => loadSwapsEnabled());
  const [dismissed, setDismissed] = useState(false);
  const [suggestions, setSuggestions] = useState<SwapSuggestion[] | null>(null);
  const [rawById, setRawById] = useState<Record<string, Record<string, unknown>>>({});
  // Stable fetch key: the parent passes a fresh object literal each render.
  const foodKey = JSON.stringify([
    food.id, food.name, food.perServingKcal, food.servingSize,
    food.servingUnit, food.categoryId, food.categoryName,
  ]);

  useEffect(() => {
    if (!enabled || dismissed) return;
    let cancelled = false;
    (async () => {
      try {
        const url = food.categoryId
          ? `/api/foods?category=${encodeURIComponent(food.categoryId)}&limit=50`
          : `/api/foods?q=${encodeURIComponent(food.name.split(/\s+/).slice(0, 2).join(" "))}&limit=50`;
        const data = await api<{ foods?: unknown[] }>(url);
        const raws = Array.isArray(data.foods) ? data.foods : [];
        const candidates = raws.map((r) =>
          foodResultToSwapLike(r as Record<string, unknown>),
        );
        const byId: Record<string, Record<string, unknown>> = {};
        for (const r of raws) {
          const rec = r as Record<string, unknown>;
          if (typeof rec.id === "string") byId[rec.id] = rec;
        }
        if (!cancelled) {
          setRawById(byId);
          setSuggestions(suggestSwaps(food, candidates));
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dismissed, foodKey]);

  if (!enabled || dismissed || !suggestions || suggestions.length === 0) return null;

  return (
    <div
      className="mt-2 rounded-xl border p-3"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-elevated)" }}
      aria-label={`Lighter alternatives to ${food.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="t-meta flex items-center gap-1.5">
          <Leaf size={13} aria-hidden="true" style={{ color: "var(--success)" }} />
          Lighter alternatives
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="t-meta underline underline-offset-2"
          aria-label={`Dismiss lighter alternatives for ${food.name}`}
        >
          Dismiss
        </button>
      </div>
      <p className="t-meta mt-1 normal-case tracking-normal">
        Same kind of food, fewer calories — entirely your choice.
      </p>
      <ul className="mt-2 space-y-2">
        {suggestions.map((s) => (
          <li key={s.food.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                {s.food.name}
              </p>
              <p className="t-meta normal-case tracking-normal">
                {s.basis}
              </p>
              <div className="mt-0.5">
                <VerificationBadge verification={s.food.verification ?? "estimate"} basis={s.food.basis} />
              </div>
            </div>
            {onUseInstead && rawById[s.food.id] && (
              <button
                type="button"
                onClick={() => onUseInstead(rawById[s.food.id])}
                className="shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
                aria-label={`Log ${s.food.name} instead of ${food.name}`}
              >
                Use instead
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
