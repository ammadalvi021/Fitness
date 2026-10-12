"use client";

/**
 * /log/ghar-ka-khana — Ghar Ka Khana: Pakistani home foods by category.
 * Category chips, Urdu labels per the language setting, household portions
 * with assumed gram equivalents ("1 katori ≈ 200 g"), adjustable quantity,
 * add-to-diary. Every nutrition display carries a VerificationBadge.
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

/** Categories that read as "ghar ka khana" — everything else hides behind "All". */
const HOME_CATEGORY_NAMES = [
  "Bread & Bakery",
  "Rice & Grains",
  "Lentils & Beans (Daal)",
  "Chicken, Meat & Fish",
  "Vegetables",
  "Sweets & Desserts",
  "Tea, Coffee & Drinks",
  "Breakfast",
  "Snacks & Street Food",
  "Dairy",
];

interface Category {
  id: string;
  name: string;
  nameUrdu: string | null;
}

export default function GharKaKhanaPage() {
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
        const home = d.categories.filter((c) => HOME_CATEGORY_NAMES.includes(c.name));
        setCategories(home);
        // Default to Daal — the most-logged home category.
        const daal = home.find((c) => c.name === "Lentils & Beans (Daal)");
        setActiveId(daal?.id ?? home[0]?.id ?? "");
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
        title="Ghar Ka Khana"
        subtitle="گھر کا کھانا — home-style portions: katoris, rotis, plates and glasses."
      />

      <GlassPanel className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Food category"
            className="flex flex-1 flex-wrap gap-2"
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
        </div>
        <div className="mt-3 max-w-xs">
          <MealTypePicker value={mealType} onChange={setMealType} id="gkk-meal" />
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
            title={active ? `No ${active.name} foods yet` : "Nothing here yet"}
            message="Try another category — the catalogue keeps growing."
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
