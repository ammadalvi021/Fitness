"use client";

/**
 * /recipes/new — custom recipe builder.
 * Ingredient rows (catalogue search + grams, or manual), quick-add rows for
 * oil / ghee / sugar / salt / water, yield + portions, live per-portion
 * nutrition preview, save privately, and "log a portion".
 * Every nutrition display carries a VerificationBadge.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Plus, Search, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { GlassPanel, LuxButton } from "@/components/luxury";
import { VerificationBadge } from "@/components/VerificationBadge";
import { computeRecipeNutrition } from "@fitfusion/core";
import { todayLocal } from "@/components/food-log";

interface IngredientRow {
  key: string;
  foodId?: string;
  name: string;
  grams: string;
  /** per-100-g values (from catalogue or manual quick-add) */
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  fromCatalogue: boolean;
}

interface FoodHit {
  id: string;
  name: string;
  servingSize: number;
  perServing: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
}

/** Standard quick-add staples (per-100-g, generic values). */
const QUICK_ADD: { label: string; name: string; per100: [number, number, number, number, number] }[] = [
  { label: "Oil", name: "Cooking Oil", per100: [884, 0, 0, 100, 0] },
  { label: "Ghee", name: "Desi Ghee", per100: [900, 0, 0, 100, 0] },
  { label: "Sugar", name: "Sugar", per100: [400, 0, 100, 0, 0] },
  { label: "Salt", name: "Salt", per100: [0, 0, 0, 0, 0] },
  { label: "Water", name: "Water", per100: [0, 0, 0, 0, 0] },
];

let rowSeq = 0;
function newRow(): IngredientRow {
  rowSeq += 1;
  return {
    key: `row-${Date.now()}-${rowSeq}`,
    name: "",
    grams: "",
    kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
    fromCatalogue: false,
  };
}

export default function NewRecipePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [rows, setRows] = useState<IngredientRow[]>([newRow()]);
  const [portions, setPortions] = useState("4");
  const [yieldGrams, setYieldGrams] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dietCategory, setDietCategory] = useState<"vegetarian" | "non_vegetarian">("vegetarian");
  const [saving, setSaving] = useState(false);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState("");

  // Autocomplete state per row.
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const [hits, setHits] = useState<FoodHit[]>([]);
  const [searching, setSearching] = useState(false);

  function updateRow(key: string, patch: Partial<IngredientRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  function quickAdd(q: (typeof QUICK_ADD)[number]) {
    setRows((rs) => [
      ...rs,
      {
        ...newRow(),
        name: q.name,
        kcal: q.per100[0],
        proteinG: q.per100[1],
        carbsG: q.per100[2],
        fatG: q.per100[3],
        fiberG: q.per100[4],
        fromCatalogue: false,
      },
    ]);
  }

  async function searchFoods(rowKey: string, term: string) {
    updateRow(rowKey, { name: term, foodId: undefined, fromCatalogue: false });
    setSearchFor(rowKey);
    if (term.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api<{ foods: FoodHit[] }>(
        `/api/foods?q=${encodeURIComponent(term.trim())}&limit=8`
      );
      setHits(res.foods);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  function pickFood(rowKey: string, hit: FoodHit) {
    const factor = hit.servingSize > 0 ? 100 / hit.servingSize : 0;
    updateRow(rowKey, {
      foodId: hit.id,
      name: hit.name,
      kcal: Math.round(hit.perServing.kcal * factor * 10) / 10,
      proteinG: Math.round(hit.perServing.proteinG * factor * 10) / 10,
      carbsG: Math.round(hit.perServing.carbsG * factor * 10) / 10,
      fatG: Math.round(hit.perServing.fatG * factor * 10) / 10,
      fiberG: Math.round(hit.perServing.fiberG * factor * 10) / 10,
      fromCatalogue: true,
    });
    setSearchFor(null);
    setHits([]);
  }

  const portionCount = Math.max(1, Math.floor(Number(portions) || 1));

  const preview = useMemo(() => {
    const ingredients = rows
      .filter((r) => r.name.trim() && Number(r.grams) > 0)
      .map((r) => ({
        name: r.name.trim(),
        grams: Number(r.grams),
        kcal: r.kcal,
        proteinG: r.proteinG,
        carbsG: r.carbsG,
        fatG: r.fatG,
        fiberG: r.fiberG,
      }));
    if (ingredients.length === 0) return null;
    return computeRecipeNutrition(ingredients, portionCount);
  }, [rows, portionCount]);

  function buildPayload() {
    const ingredients = rows
      .filter((r) => r.name.trim() && Number(r.grams) > 0)
      .map((r) => ({
        ...(r.foodId ? { foodId: r.foodId } : {}),
        name: r.name.trim(),
        grams: Number(r.grams),
        kcal: r.kcal,
        proteinG: r.proteinG,
        carbsG: r.carbsG,
        fatG: r.fatG,
        fiberG: r.fiberG,
      }));
    const yg = Number(yieldGrams);
    return {
      name: name.trim(),
      ingredients,
      portions: portionCount,
      ...(Number.isFinite(yg) && yg > 0 ? { yieldGrams: yg } : {}),
      ...(instructions.trim()
        ? { instructions: instructions.split("\n").map((s) => s.trim()).filter(Boolean) }
        : {}),
      dietCategory,
    };
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await api<{ recipe: { id: string; title: string } }>("/api/recipes", {
        method: "POST",
        body: buildPayload(),
      });
      setSavedId(res.recipe.id);
      setSavedTitle(res.recipe.title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your recipe.");
    } finally {
      setSaving(false);
    }
  }

  async function logPortion() {
    if (!preview) return;
    setLogging(true);
    setError(null);
    try {
      await api("/api/diary", {
        method: "POST",
        body: {
          date: todayLocal(),
          mealType: "dinner",
          customName: `${savedTitle || name.trim()} (my recipe)`,
          servings: 1,
          kcal: preview.perPortion.kcal,
          proteinG: preview.perPortion.proteinG,
          carbsG: preview.perPortion.carbsG,
          fatG: preview.perPortion.fatG,
          fiberG: preview.perPortion.fiberG,
          idempotencyKey:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      });
      router.push("/nutrition");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log the portion.");
    } finally {
      setLogging(false);
    }
  }

  const canSave =
    name.trim().length > 0 &&
    rows.some((r) => r.name.trim() && Number(r.grams) > 0) &&
    !saving;

  return (
    <div className="anim-page-enter mx-auto max-w-3xl">
      <PageHeader
        title="New custom recipe"
        subtitle="Your recipe stays private. Nutrition is computed from your ingredients — water never adds calories."
      />

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--error)",
            backgroundColor: "color-mix(in srgb, var(--error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)",
          }}
        >
          {error}
        </p>
      )}

      <GlassPanel className="space-y-5 p-5">
        <Field label="Recipe name" htmlFor="nr-name" required>
          <Input
            id="nr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ammi's Moong Daal"
            maxLength={200}
          />
        </Field>

        {/* ------------------------------ Ingredients ------------------------------ */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[var(--text)]">Ingredients</span>
            <LuxButton variant="secondary" onClick={() => setRows((rs) => [...rs, newRow()])} className="!min-h-[40px] px-3 py-1 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Plus size={15} aria-hidden="true" /> Add row
              </span>
            </LuxButton>
          </div>

          <div className="mb-3 flex flex-wrap gap-2" aria-label="Quick-add staples">
            {QUICK_ADD.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => quickAdd(q)}
                className="anim-press min-h-[44px] rounded-full border border-[var(--border)] px-4 text-sm text-[var(--text-secondary)]"
              >
                + {q.label}
              </button>
            ))}
          </div>

          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r.key}
                className="rounded-2xl border border-[var(--border)] p-3"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <div className="relative">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search
                        size={16}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
                      />
                      <Input
                        aria-label="Ingredient name — type to search the catalogue"
                        placeholder="Type to search foods…"
                        value={r.name}
                        onChange={(e) => searchFoods(r.key, e.target.value)}
                        onFocus={() => r.name.trim().length >= 2 && setSearchFor(r.key)}
                        className="pl-9"
                        autoComplete="off"
                      />
                      {searchFor === r.key && (hits.length > 0 || searching) && (
                        <ul
                          role="listbox"
                          aria-label="Matching foods"
                          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-[var(--border)] p-1 shadow-xl"
                          style={{ backgroundColor: "var(--bg-elevated)" }}
                        >
                          {searching && (
                            <li className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                              Searching…
                            </li>
                          )}
                          {hits.map((h) => (
                            <li key={h.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected="false"
                                onClick={() => pickFood(r.key, h)}
                                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--bg-secondary)]"
                              >
                                <span className="truncate">{h.name}</span>
                                <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                                  {Math.round(h.perServing.kcal)} kcal / {h.servingSize}g
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ingredient ${r.name || "row"}`}
                      onClick={() => removeRow(r.key)}
                      className="anim-press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--border)] text-[var(--text-secondary)]"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="w-32">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`Grams of ${r.name || "ingredient"}`}
                      placeholder="grams"
                      value={r.grams}
                      onChange={(e) => updateRow(r.key, { grams: e.target.value })}
                      inputMode="decimal"
                    />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {r.fromCatalogue ? (
                      <>from catalogue · {r.kcal}/100g</>
                    ) : r.name.trim() ? (
                      <>manual · {r.kcal}/100g</>
                    ) : (
                      <>grams of the ingredient as used</>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ------------------------------ Yield / portions ------------------------------ */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Portions" htmlFor="nr-portions" hint="How many servings the batch makes.">
            <Input
              id="nr-portions"
              type="number"
              min={1}
              max={100}
              value={portions}
              onChange={(e) => setPortions(e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label="Total yield (g)" htmlFor="nr-yield" hint="Optional — cooked weight of the whole batch.">
            <Input
              id="nr-yield"
              type="number"
              min={0}
              value={yieldGrams}
              onChange={(e) => setYieldGrams(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 800"
            />
          </Field>
          <Field label="Diet" htmlFor="nr-diet">
            <Select
              id="nr-diet"
              value={dietCategory}
              onChange={(e) => setDietCategory(e.target.value as "vegetarian" | "non_vegetarian")}
            >
              <option value="vegetarian">Vegetarian</option>
              <option value="non_vegetarian">Non-vegetarian</option>
            </Select>
          </Field>
        </div>

        <Field label="Instructions" htmlFor="nr-instructions" hint="Optional — one step per line.">
          <Textarea
            id="nr-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={"Boil the daal until soft.\nAdd tarka and simmer 10 minutes."}
            rows={4}
          />
        </Field>

        {/* ------------------------------ Live preview ------------------------------ */}
        <div
          className="rounded-2xl border border-[var(--border)] p-4"
          style={{ backgroundColor: "var(--bg-secondary)" }}
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="t-card-heading">Per-portion preview</h2>
            <VerificationBadge
              verification="estimate"
              basis="Computed from the ingredients you entered"
            />
          </div>
          {preview ? (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="text-2xl font-bold text-[var(--text)]">
                {Math.round(preview.perPortion.kcal)} kcal
              </span>
              <span className="text-sm text-[var(--text-secondary)]">
                Protein {preview.perPortion.proteinG}g
              </span>
              <span className="text-sm text-[var(--text-secondary)]">
                Carbs {preview.perPortion.carbsG}g
              </span>
              <span className="text-sm text-[var(--text-secondary)]">
                Fat {preview.perPortion.fatG}g
              </span>
              <span className="text-sm text-[var(--text-secondary)]">
                Fiber {preview.perPortion.fiberG}g
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                ÷ {preview.portions} portions · {Math.round(preview.totals.kcal)} kcal total
              </span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Add at least one ingredient with grams to see the nutrition preview.
            </p>
          )}
        </div>

        {/* ------------------------------ Actions ------------------------------ */}
        {!savedId ? (
          <LuxButton onClick={save} disabled={!canSave} className="w-full">
            {saving ? "Saving…" : "Save recipe (private)"}
          </LuxButton>
        ) : (
          <div
            className="rounded-2xl border p-4"
            style={{
              borderColor: "color-mix(in srgb, var(--success) 45%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--success) 10%, transparent)",
            }}
          >
            <p className="flex items-center gap-2 font-semibold text-[var(--text)]">
              <Check size={18} aria-hidden="true" style={{ color: "var(--success)" }} />
              Saved “{savedTitle}” privately ✓
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <LuxButton onClick={logPortion} disabled={logging || !preview}>
                {logging ? "Logging…" : "Log a portion to diary"}
              </LuxButton>
              <Link href="/log/my-meals">
                <LuxButton variant="secondary">My Meals</LuxButton>
              </Link>
              <Link href="/recipes">
                <LuxButton variant="ghost">All recipes</LuxButton>
              </Link>
            </div>
          </div>
        )}

        <Link
          href="/recipes"
          className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[var(--text-secondary)]"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back to recipes
        </Link>
      </GlassPanel>
    </div>
  );
}
