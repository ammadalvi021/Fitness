"use client";

/**
 * /log/search — food search with autocomplete, category/country/verified
 * filters, and add-to-diary rows. Every nutrition display carries a
 * VerificationBadge.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { Field, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import { EmptyStateLux, GlassPanel } from "@/components/luxury";
import {
  defaultMealType,
  FoodLogRow,
  MealTypePicker,
  useFoodSearch,
  useProfileLocale,
} from "@/components/food-log";

interface Category {
  id: string;
  name: string;
  nameUrdu: string | null;
}

export default function FoodSearchPage() {
  const searchParams = useSearchParams();
  const { language } = useProfileLocale();
  const [categories, setCategories] = useState<Category[]>([]);
  const [mealType, setMealType] = useState(defaultMealType);
  const [toast, setToast] = useState<string | null>(null);

  const {
    query, setQuery, category, setCategory, country, setCountry,
    verifiedOnly, setVerifiedOnly,
    foods, total, loading,
  } = useFoodSearch();

  // Categories for the filter + resolving ?categoryName= (used by the
  // "Snacks & Drinks" hub card).
  useEffect(() => {
    let cancelled = false;
    api<{ categories: Category[] }>("/api/foods/categories")
      .then((d) => {
        if (cancelled) return;
        setCategories(d.categories);
        const wanted = searchParams.get("categoryName");
        if (wanted) {
          const match = d.categories.find(
            (c) => c.name.toLowerCase() === wanted.toLowerCase()
          );
          if (match) setCategory(match.id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="anim-page-enter">
      <PageHeader
        title="Search food"
        subtitle="English, Urdu (اردو), or Roman Urdu — e.g. “roti”, “روٹی”, “biryani”."
      />

      <GlassPanel className="p-4 sm:p-5">
        <div className="relative">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
          />
          <Input
            type="search"
            role="combobox"
            aria-expanded="false"
            aria-label="Search foods"
            aria-autocomplete="list"
            placeholder="Try “daal”, “دال”, “chai”…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-11"
            autoComplete="off"
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Category" htmlFor="fs-category">
            <Select
              id="fs-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.nameUrdu ? ` · ${c.nameUrdu}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Country" htmlFor="fs-country">
            <Select
              id="fs-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">All countries</option>
              <option value="PK">Pakistan</option>
              <option value="IN">India</option>
            </Select>
          </Field>
          <Field label="Meal" htmlFor="fs-meal">
            <MealTypePicker id="fs-meal" value={mealType} onChange={setMealType} />
          </Field>
        </div>

        <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
            className="h-5 w-5"
            style={{ accentColor: "var(--accent)" }}
          />
          Verified values only
        </label>
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
            title="No foods found"
            message="Try a different spelling — or try the Urdu name, e.g. “دال” for daal."
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
        {!loading && foods.length > 0 && (
          <p className="text-center text-xs text-[var(--text-secondary)]">
            Showing {foods.length} of {total} matches
          </p>
        )}
      </div>
    </div>
  );
}
