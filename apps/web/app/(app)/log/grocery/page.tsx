"use client";

/**
 * /log/grocery — Grocery / pantry logging: atta, daal, oils, dry fruit and
 * other raw ingredients, browsed by pantry category. Dry goods carry 100 g
 * reference portions so you can weigh what you cook with. Every nutrition
 * display carries a VerificationBadge.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Skeleton } from "@/components/ui";
import { EmptyStateLux, GlassPanel } from "@/components/luxury";
import {
  defaultMealType,
  FoodDto,
  FoodLogRow,
  MealTypePicker,
  useProfileLocale,
} from "@/components/food-log";

const PANTRY_CATEGORY_NAMES = [
  "Flour, Atta & Cereals",
  "Rice & Grains",
  "Lentils & Beans (Daal)",
  "Oils & Ghee",
  "Nuts & Seeds",
  "Vegetables",
  "Fruits",
  "Dairy",
  "Eggs",
  "Sauces & Condiments",
];

interface Category {
  id: string;
  name: string;
  nameUrdu: string | null;
}

export default function GroceryPage() {
  const { language } = useProfileLocale();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [foods, setFoods] = useState<FoodDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [mealType, setMealType] = useState(defaultMealType);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ categories: Category[] }>("/api/foods/categories")
      .then((d) => {
        if (cancelled) return;
        const pantry = d.categories.filter((c) =>
          PANTRY_CATEGORY_NAMES.includes(c.name)
        );
        setCategories(pantry);
        const atta = pantry.find((c) => c.name === "Flour, Atta & Cereals");
        setActiveId(atta?.id ?? pantry[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setLoading(true);
    api<{ foods: FoodDto[] }>(`/api/foods?category=${activeId}&limit=60`)
      .then((d) => {
        if (!cancelled) {
          setFoods(d.foods);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFoods([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const active = useMemo(
    () => categories.find((c) => c.id === activeId),
    [categories, activeId]
  );

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="anim-page-enter">
      <PageHeader
        title="Grocery"
        subtitle="کریانہ — log raw ingredients & pantry staples. Tip: raw and cooked are separate entries (dry rice ≠ cooked rice)."
      />

      <GlassPanel className="p-4">
        <div
          role="group"
          aria-label="Pantry category"
          className="flex flex-wrap gap-2"
        >
          {categories.map((c) => {
            const selected = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                aria-pressed={selected}
                className="anim-press min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors"
                style={
                  selected
                    ? {
                        backgroundColor: "var(--accent)",
                        borderColor: "var(--accent)",
                        color: "var(--on-accent)",
                      }
                    : {
                        borderColor: "var(--border)",
                        color: "var(--text-secondary)",
                        backgroundColor: "transparent",
                      }
                }
              >
                {language !== "en" && c.nameUrdu ? c.nameUrdu : c.name}
              </button>
            );
          })}
        </div>
        <div className="mt-3 max-w-xs">
          <MealTypePicker value={mealType} onChange={setMealType} id="groc-meal" />
        </div>
      </GlassPanel>

      {toast && (
        <p
          role="status"
          className="mt-4 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--success)",
            backgroundColor: "color-mix(in srgb, var(--success) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--success) 38%, transparent)",
          }}
        >
          {toast}
        </p>
      )}

      <div className="mt-6 space-y-4" aria-live="polite">
        {loading && (
          <>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </>
        )}
        {!loading && foods.length === 0 && (
          <EmptyStateLux
            title={active ? `No ${active.name} items yet` : "Nothing here yet"}
            message="Try another pantry category."
          />
        )}
        {!loading &&
          foods.map((f) => (
            <FoodLogRow
              key={f.id}
              food={f}
              language={language}
              mealType={mealType}
              onLogged={(name) => flash(`Logged “${name}” ✓`)}
            />
          ))}
      </div>
    </div>
  );
}
