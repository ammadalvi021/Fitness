"use client";

/**
 * Recipe URL importer UI: paste a URL → loading → REVIEW screen with all
 * parsed fields editable → "Save as my recipe" via the EXISTING
 * POST /api/recipes custom-recipe path (so server nutrition math stays
 * consistent). Recipes save private to the user.
 *
 * Honesty: imported rows carry no nutrition data — grams are prefilled from
 * an approximate unit table (editable), and the UI says so out loud.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Link2, Loader2, PencilLine, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { GlassPanel, LuxButton } from "@/components/luxury";
import { VerificationBadge } from "@/components/VerificationBadge";
import {
  buildCustomRecipePayload,
  recipeToReview,
  validateReview,
  type ImportedRecipe,
  type ImportReviewIngredient,
  type ImportReviewState,
} from "@/lib/recipe-import-shared";

interface ImportApiResponse {
  recipe: ImportedRecipe;
}

let rowSeq = 0;
function blankRow(): ImportReviewIngredient {
  rowSeq += 1;
  return { name: "", quantity: "", unit: "", grams: "" };
}

export default function RecipeImportClient({
  initialRecipe,
}: {
  /** For preview/screenshot use: skip the URL step and start in review. */
  initialRecipe?: ImportedRecipe;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"enter" | "loading" | "review" | "saved">(
    initialRecipe ? "review" : "enter"
  );
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ImportReviewState>(() =>
    initialRecipe
      ? recipeToReview(initialRecipe)
      : { title: "", servings: "4", ingredients: [blankRow()], instructions: "", dietCategory: "vegetarian" }
  );
  const [saving, setSaving] = useState(false);
  const [savedTitle, setSavedTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState(initialRecipe?.sourceUrl ?? "");

  function updateIngredient(index: number, patch: Partial<ImportReviewIngredient>) {
    setReview((r) => ({
      ...r,
      ingredients: r.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)),
    }));
  }

  function removeIngredient(index: number) {
    setReview((r) => ({
      ...r,
      ingredients: r.ingredients.length > 1 ? r.ingredients.filter((_, i) => i !== index) : r.ingredients,
    }));
  }

  async function importUrl() {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste a recipe URL first.");
      return;
    }
    setPhase("loading");
    try {
      const res = await api<ImportApiResponse>("/api/recipes/import", {
        method: "POST",
        body: { url: trimmed },
      });
      setReview(recipeToReview(res.recipe));
      setSourceUrl(res.recipe.sourceUrl);
      setPhase("review");
    } catch (err) {
      setPhase("enter");
      setError(err instanceof ApiError ? err.message : "Couldn't import that page. Try again.");
    }
  }

  async function save() {
    setError(null);
    const problem = validateReview(review);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      const payload = buildCustomRecipePayload(review);
      const res = await api<{ recipe: { title: string } }>("/api/recipes", {
        method: "POST",
        body: payload,
      });
      setSavedTitle(res.recipe.title);
      setPhase("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your recipe.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="anim-page-enter mx-auto max-w-3xl">
      <PageHeader
        title="Import recipe from URL"
        subtitle="Paste a link to a recipe page. Review everything before saving — nothing is saved until you say so."
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

      {phase === "enter" && (
        <GlassPanel className="space-y-4 p-5">
          <Field label="Recipe page URL" htmlFor="ri-url" required>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2
                  size={16}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
                />
                <Input
                  id="ri-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void importUrl()}
                  placeholder="https://example.com/best-daal-recipe"
                  className="pl-9"
                  inputMode="url"
                  autoComplete="off"
                />
              </div>
              <LuxButton onClick={() => void importUrl()} className="!min-h-[44px]">
                Import
              </LuxButton>
            </div>
          </Field>
          <p className="text-xs text-[var(--text-secondary)]">
            We fetch the page safely (private/internal addresses are blocked), read its
            text, and use AI to pull out the recipe. Pages without a recipe, PDFs, and
            unreachable links are reported — never guessed.
          </p>
          <Link
            href="/recipes"
            className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[var(--text-secondary)]"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Back to recipes
          </Link>
        </GlassPanel>
      )}

      {phase === "loading" && (
        <GlassPanel className="flex items-center gap-3 p-8" aria-live="polite">
          <Loader2 size={22} aria-hidden="true" className="animate-spin text-[var(--accent)]" />
          <p className="text-[var(--text)]">Fetching the page and reading the recipe…</p>
        </GlassPanel>
      )}

      {(phase === "review" || phase === "saved") && (
        <GlassPanel className="space-y-5 p-5">
          <div
            className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-sm"
            style={{ backgroundColor: "var(--bg-secondary)" }}
          >
            <PencilLine size={16} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
            <p className="text-[var(--text-secondary)]">
              Review everything below — quantities are <strong>approximate</strong> and
              imported ingredients carry <strong>no nutrition data</strong>. Fix grams
              before saving.
            </p>
            <VerificationBadge
              verification="estimate"
              basis="Imported from a web page — quantities approximate, nutrition unknown"
            />
          </div>

          <Field label="Recipe title" htmlFor="ri-title" required>
            <Input
              id="ri-title"
              value={review.title}
              onChange={(e) => setReview((r) => ({ ...r, title: e.target.value }))}
              maxLength={200}
              disabled={phase === "saved"}
            />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text)]">Ingredients</span>
              {phase === "review" && (
                <LuxButton
                  variant="secondary"
                  onClick={() => setReview((r) => ({ ...r, ingredients: [...r.ingredients, blankRow()] }))}
                  className="!min-h-[40px] px-3 py-1 text-sm"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Plus size={15} aria-hidden="true" /> Add row
                  </span>
                </LuxButton>
              )}
            </div>
            <ul className="space-y-3">
              {review.ingredients.map((ing, i) => (
                <li
                  key={i}
                  className="rounded-2xl border border-[var(--border)] p-3"
                  style={{ backgroundColor: "var(--bg-secondary)" }}
                >
                  <div className="flex gap-2">
                    <Input
                      aria-label={`Ingredient ${i + 1} name`}
                      placeholder="Ingredient name"
                      value={ing.name}
                      onChange={(e) => updateIngredient(i, { name: e.target.value })}
                      className="flex-1"
                      disabled={phase === "saved"}
                    />
                    {phase === "review" && (
                      <button
                        type="button"
                        aria-label={`Remove ingredient ${ing.name || i + 1}`}
                        onClick={() => removeIngredient(i)}
                        className="anim-press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--border)] text-[var(--text-secondary)]"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Input
                      aria-label={`Ingredient ${i + 1} quantity (as on the page)`}
                      placeholder="qty"
                      value={ing.quantity}
                      onChange={(e) => updateIngredient(i, { quantity: e.target.value })}
                      inputMode="decimal"
                      disabled={phase === "saved"}
                    />
                    <Input
                      aria-label={`Ingredient ${i + 1} unit (as on the page)`}
                      placeholder="unit"
                      value={ing.unit}
                      onChange={(e) => updateIngredient(i, { unit: e.target.value })}
                      disabled={phase === "saved"}
                    />
                    <Input
                      aria-label={`Ingredient ${i + 1} grams (editable)`}
                      placeholder="grams *"
                      value={ing.grams}
                      onChange={(e) => updateIngredient(i, { grams: e.target.value })}
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      disabled={phase === "saved"}
                    />
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    grams is what gets saved — prefilled approximately from qty × unit.
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Servings" htmlFor="ri-servings" hint="How many servings the batch makes.">
              <Input
                id="ri-servings"
                type="number"
                min={1}
                max={100}
                value={review.servings}
                onChange={(e) => setReview((r) => ({ ...r, servings: e.target.value }))}
                inputMode="numeric"
                disabled={phase === "saved"}
              />
            </Field>
            <Field label="Diet" htmlFor="ri-diet">
              <Select
                id="ri-diet"
                value={review.dietCategory}
                onChange={(e) => setReview((r) => ({ ...r, dietCategory: e.target.value as "vegetarian" | "non_vegetarian" }))}
                disabled={phase === "saved"}
              >
                <option value="vegetarian">Vegetarian</option>
                <option value="non_vegetarian">Non-vegetarian</option>
              </Select>
            </Field>
          </div>

          <Field label="Instructions" htmlFor="ri-instructions" hint="One step per line.">
            <Textarea
              id="ri-instructions"
              value={review.instructions}
              onChange={(e) => setReview((r) => ({ ...r, instructions: e.target.value }))}
              rows={5}
              disabled={phase === "saved"}
            />
          </Field>

          {sourceUrl && (
            <p className="truncate text-xs text-[var(--text-secondary)]">
              Source: {sourceUrl}
            </p>
          )}

          {phase === "review" ? (
            <LuxButton onClick={() => void save()} disabled={saving} className="w-full">
              {saving ? "Saving…" : "Save as my recipe (private)"}
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
                Saved “{savedTitle}” privately
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/log/my-meals">
                  <LuxButton variant="secondary">My Meals</LuxButton>
                </Link>
                <Link href="/recipes">
                  <LuxButton variant="ghost">All recipes</LuxButton>
                </Link>
              </div>
            </div>
          )}

          {phase === "review" && (
            <button
              type="button"
              onClick={() => {
                setPhase("enter");
                setUrl("");
              }}
              className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[var(--text-secondary)]"
            >
              <ArrowLeft size={16} aria-hidden="true" /> Import a different URL
            </button>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
