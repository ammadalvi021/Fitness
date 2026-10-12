"use client";

import { useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  Loader2,
  ScanLine,
  Search,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  GlassPanel,
  LuxButton,
  EmptyStateLux,
  ErrorStateLux,
} from "@/components/luxury";
import { Input, PageHeader, Select, Field, Skeleton } from "@/components/ui";
import { MenuStatusBadge } from "@/components/MenuStatusBadge";

/* ---------- shapes ---------- */

interface Extracted {
  name: string;
  description: string | null;
  confidence: "low" | "medium" | "high" | string;
  assumptions: string[];
  alternatives: string[];
}

interface FoodHit {
  id: string;
  name: string;
  brand: string | null;
  servingSize: number;
  servingUnit: string;
  perServing: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
}

interface Draft {
  key: string;
  name: string;
  portion: string;
  search: string;
  hits: FoodHit[];
  searching: boolean;
  matched: FoodHit | null;
  include: boolean;
}

interface CreatedItem {
  id: string;
  name: string;
  kcal: number | null;
  nutritionStatus: string;
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function toDraft(e: Extracted): Draft {
  return {
    key: newKey(),
    name: e.name,
    portion: e.description ?? "",
    search: "",
    hits: [],
    searching: false,
    matched: null,
    include: true,
  };
}

const CONFIDENCE_TONE: Record<string, "success" | "warning" | "neutral"> = {
  high: "success",
  medium: "warning",
  low: "neutral",
};

/* ---------- page ---------- */

export default function OrderScanPage() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [restaurantId, setRestaurantId] = useState("");
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [checkingRestaurant, setCheckingRestaurant] = useState(false);
  const [restaurantError, setRestaurantError] = useState<string | null>(null);

  const [phase, setPhase] = useState<"upload" | "review" | "done">("upload");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [created, setCreated] = useState<CreatedItem[]>([]);

  const [logMeal, setLogMeal] = useState<string>("lunch");
  const [logToDiary, setLogToDiary] = useState(false);
  const [logging, setLogging] = useState(false);
  const [loggedCount, setLoggedCount] = useState<number | null>(null);

  function updateDraft(key: string, patch: Partial<Draft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  async function checkRestaurant() {
    const rid = restaurantId.trim();
    if (!rid) return;
    setCheckingRestaurant(true);
    setRestaurantError(null);
    try {
      const data = await api<{ restaurant: { id: string; name: string } }>(
        `/api/restaurants/${encodeURIComponent(rid)}/menu`,
      );
      setRestaurantName(data.restaurant.name);
    } catch (e) {
      setRestaurantName(null);
      setRestaurantError(
        e instanceof ApiError && e.status === 404
          ? "No restaurant with that ID. Find one on the restaurants page."
          : "Couldn't look up that restaurant.",
      );
    } finally {
      setCheckingRestaurant(false);
    }
  }

  async function onFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/menus/extract", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        throw new ApiError(res.status, body?.error?.message ?? "Extraction failed", body?.error?.code);
      }
      if (body.aiConfigured === false) {
        setError(
          "AI extraction isn't configured on this server (no vision API key). The menu photo was saved, but items can't be read automatically.",
        );
        return;
      }
      const extracted: Extracted[] = body.extracted ?? [];
      setDisclaimer(body.disclaimer ?? null);
      setDrafts(extracted.map(toDraft));
      setPhase("review");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function searchFoods(d: Draft) {
    const q = d.search.trim();
    if (!q) return;
    updateDraft(d.key, { searching: true, hits: [] });
    try {
      const data = await api<{ foods: FoodHit[] }>(
        `/api/foods?q=${encodeURIComponent(q)}&limit=8`,
      );
      updateDraft(d.key, { hits: data.foods ?? [] });
    } catch {
      updateDraft(d.key, { hits: [] });
    } finally {
      updateDraft(d.key, { searching: false });
    }
  }

  async function confirm() {
    const rid = restaurantId.trim();
    const chosen = drafts.filter((d) => d.include && d.name.trim().length > 0);
    if (!rid || chosen.length === 0) return;
    setConfirming(true);
    setError(null);
    try {
      const data = await api<{ items: CreatedItem[] }>("/api/menus/confirm", {
        method: "POST",
        body: {
          restaurantId: rid,
          items: chosen.map((d) => ({
            name: d.name.trim(),
            portion: d.portion.trim() || null,
            matchedFoodId: d.matched?.id ?? null,
          })),
        },
      });
      setCreated(data.items ?? []);
      setPhase("done");

      if (logToDiary) {
        setLogging(true);
        let count = 0;
        for (const it of data.items ?? []) {
          if (it.kcal === null) continue; // never log numbers we don't have
          try {
            await api("/api/diary", {
              method: "POST",
              body: {
                date: todayYMD(),
                mealType: logMeal,
                customName: `${it.name} — ${restaurantName ?? "restaurant"}`,
                kcal: Math.round(it.kcal),
                proteinG: 0,
                carbsG: 0,
                fatG: 0,
                fiberG: 0,
                servings: 1,
              },
              headers: { "Idempotency-Key": `order-scan-${it.id}-${todayYMD()}-${logMeal}` },
            });
            count += 1;
          } catch {
            /* keep going; per-item failures are surfaced by count below */
          }
        }
        setLoggedCount(count);
        setLogging(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the menu items");
    } finally {
      setConfirming(false);
    }
  }

  function reset() {
    setPhase("upload");
    setDrafts([]);
    setCreated([]);
    setLoggedCount(null);
    setError(null);
  }

  const readyToConfirm =
    restaurantId.trim().length > 0 &&
    drafts.some((d) => d.include && d.name.trim().length > 0);

  return (
    <div>
      <PageHeader
        title="Scan a menu"
        subtitle="Photograph a restaurant menu or order screenshot. Items are extracted for your review — you confirm each one before anything is saved."
      />

      {/* Restaurant picker */}
      <GlassPanel className="mb-4 p-4">
        <Field label="Restaurant (menu items will be added here)">
          <div className="flex gap-2">
            <Input
              value={restaurantId}
              onChange={(e) => {
                setRestaurantId(e.target.value);
                setRestaurantName(null);
              }}
              placeholder="Paste a restaurant ID"
              className="flex-1"
            />
            <LuxButton
              variant="secondary"
              onClick={checkRestaurant}
              disabled={checkingRestaurant || restaurantId.trim().length === 0}
              className="px-4 text-sm"
            >
              {checkingRestaurant ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Check
            </LuxButton>
          </div>
        </Field>
        {restaurantName && (
          <p className="mt-2 text-sm" style={{ color: "var(--success)" }}>
            <Check size={14} className="mr-1 inline" /> {restaurantName}
          </p>
        )}
        {restaurantError && (
          <p className="mt-2 text-sm" style={{ color: "var(--error)" }}>
            {restaurantError}
          </p>
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          Find restaurants on the{" "}
          <a href="/log/restaurants" className="underline" style={{ color: "var(--accent)" }}>
            restaurants page
          </a>{" "}
          and open one to copy its ID from the URL.
        </p>
      </GlassPanel>

      {error && (
        <ErrorStateLux
          title="Something went wrong"
          message={error}
          onRetry={() => setError(null)}
        />
      )}

      {phase === "upload" && (
        <GlassPanel className="p-6 text-center">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Reading the menu…
              </p>
              <Skeleton className="h-4 w-48" />
            </div>
          ) : (
            <>
              <ScanLine size={40} className="mx-auto" style={{ color: "var(--accent)" }} />
              <h2 className="mt-3 text-lg font-semibold" style={{ color: "var(--text)" }}>
                Upload a menu photo
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
                Works with printed menus, menu boards, and order/receipt screenshots. Nutrition
                is never guessed from the photo — you match items to foods (or leave them
                unmatched) in the next step.
              </p>
              <LuxButton className="mt-4" onClick={() => fileRef.current?.click()}>
                <Camera size={16} /> Choose photo
              </LuxButton>
            </>
          )}
        </GlassPanel>
      )}

      {phase === "review" && (
        <div>
          {disclaimer && (
            <p className="mb-3 text-xs" style={{ color: "var(--text-secondary)" }}>
              {disclaimer}
            </p>
          )}
          {drafts.length === 0 ? (
            <EmptyStateLux
              icon={<UtensilsCrossed size={28} />}
              title="No items found"
              message="The photo didn't yield any readable menu items. Try a clearer, well-lit photo."
              action={<LuxButton onClick={reset}>Try another photo</LuxButton>}
            />
          ) : (
            <>
              <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                {drafts.length} item{drafts.length === 1 ? "" : "s"} extracted. Review each one:
                fix the name, match it to a food for estimated nutrition, or leave it unmatched
                (it will be saved as “Nutrition unavailable”).
              </p>
              <div className="space-y-3">
                {drafts.map((d, idx) => (
                  <DraftCard
                    key={d.key}
                    draft={d}
                    index={idx}
                    onChange={(patch) => updateDraft(d.key, patch)}
                    onRemove={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                    onSearch={() => searchFoods(d)}
                  />
                ))}
              </div>

              <GlassPanel className="mt-4 p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                    <input
                      type="checkbox"
                      checked={logToDiary}
                      onChange={(e) => setLogToDiary(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Also log items with nutrition to my diary
                  </label>
                  {logToDiary && (
                    <Select
                      value={logMeal}
                      onChange={(e) => setLogMeal(e.target.value)}
                      className="w-36"
                    >
                      {MEAL_TYPES.map((m) => (
                        <option key={m} value={m}>
                          {m[0].toUpperCase() + m.slice(1)}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <LuxButton variant="ghost" onClick={reset}>
                    Start over
                  </LuxButton>
                  <LuxButton onClick={confirm} disabled={!readyToConfirm || confirming}>
                    {confirming ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Saving…
                      </>
                    ) : (
                      <>
                        Confirm & save <ChevronRight size={16} />
                      </>
                    )}
                  </LuxButton>
                </div>
                {!restaurantId.trim() && (
                  <p className="mt-2 text-right text-xs" style={{ color: "var(--warning)" }}>
                    Pick a restaurant above before confirming.
                  </p>
                )}
              </GlassPanel>
            </>
          )}
        </div>
      )}

      {phase === "done" && (
        <GlassPanel className="p-6">
          <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            <Check size={18} className="mr-2 inline" style={{ color: "var(--success)" }} />
            {created.length} item{created.length === 1 ? "" : "s"} saved to the menu
          </h2>
          <div className="mt-4 space-y-2">
            {created.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3 text-sm">
                <span style={{ color: "var(--text)" }}>{it.name}</span>
                <span className="flex items-center gap-2">
                  <span style={{ color: "var(--text-secondary)" }}>
                    {it.kcal !== null ? `${Math.round(it.kcal)} kcal` : "Nutrition unavailable"}
                  </span>
                  <MenuStatusBadge status={it.nutritionStatus} />
                </span>
              </div>
            ))}
          </div>
          {(logging || loggedCount !== null) && (
            <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>
              {logging ? (
                "Logging to diary…"
              ) : (
                <>
                  Logged {loggedCount} item{loggedCount === 1 ? "" : "s"} to {logMeal}. Items
                  without nutrition were not logged.
                </>
              )}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <LuxButton variant="secondary" onClick={reset}>
              Scan another menu
            </LuxButton>
            {restaurantId.trim() && (
              <a href={`/log/restaurants/${encodeURIComponent(restaurantId.trim())}`}>
                <LuxButton>
                  View restaurant menu <ChevronRight size={16} />
                </LuxButton>
              </a>
            )}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}

/* ---------- per-item review card ---------- */

function DraftCard({
  draft: d,
  index,
  onChange,
  onRemove,
  onSearch,
}: {
  draft: Draft;
  index: number;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
  onSearch: () => void;
}) {
  return (
    <GlassPanel className={`p-4 ${d.include ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Item {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove item"
          className="rounded-full p-1.5"
          style={{ color: "var(--text-secondary)" }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Field label="Item name">
          <Input value={d.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Portion (optional)">
          <Input
            value={d.portion}
            onChange={(e) => onChange({ portion: e.target.value })}
            placeholder="e.g. 1 plate, 250 g"
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Match to a food for estimated nutrition (optional)">
          <div className="flex gap-2">
            <Input
              value={d.search}
              onChange={(e) => onChange({ search: e.target.value })}
              placeholder="Search the food database…"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSearch();
                }
              }}
            />
            <LuxButton variant="secondary" onClick={onSearch} disabled={d.searching} className="px-4 text-sm">
              {d.searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Search
            </LuxButton>
          </div>
        </Field>
        {d.hits.length > 0 && (
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto rounded-xl border p-2"
            style={{ borderColor: "var(--border)" }}>
            {d.hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => onChange({ matched: h, hits: [] })}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span style={{ color: "var(--text)" }}>
                    {h.name}
                    {h.brand && (
                      <span style={{ color: "var(--text-secondary)" }}> · {h.brand}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {Math.round(h.perServing.kcal)} kcal / {h.servingSize}
                    {h.servingUnit}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {d.matched ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm"
            style={{ backgroundColor: "color-mix(in srgb, var(--success) 10%, transparent)" }}>
            <span style={{ color: "var(--text)" }}>
              <Check size={14} className="mr-1 inline" style={{ color: "var(--success)" }} />
              Matched: {d.matched.name} ({Math.round(d.matched.perServing.kcal)} kcal per{" "}
              {d.matched.servingSize}
              {d.matched.servingUnit})
            </span>
            <button
              type="button"
              onClick={() => onChange({ matched: null })}
              aria-label="Clear match"
              className="rounded-full p-1"
              style={{ color: "var(--text-secondary)" }}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            No match → saved as “Nutrition unavailable” (no numbers guessed).
          </p>
        )}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
        <input
          type="checkbox"
          checked={d.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          className="h-4 w-4"
        />
        Include this item
      </label>
    </GlassPanel>
  );
}
