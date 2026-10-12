"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Flag, MapPin, Plus, Star, ExternalLink } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { GlassPanel, LuxButton, EmptyStateLux, ErrorStateLux } from "@/components/luxury";
import { Modal, PageHeader, Select, Skeleton, Textarea, Field } from "@/components/ui";
import { VerificationBadge } from "@/components/VerificationBadge";
import { MenuStatusBadge, verificationForStatus } from "@/components/MenuStatusBadge";

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  portion: string | null;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  nutritionStatus: string;
  assumptions: string[];
  source: string | null;
  lastVerifiedAt: string | null;
}

interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  rating: number | null;
  priceLevel: number | null;
  website: string | null;
  menuUrl: string | null;
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function MenuItemCard({
  item,
  onFlag,
  onAddToDiary,
}: {
  item: MenuItem;
  onFlag: (item: MenuItem) => void;
  onAddToDiary: (item: MenuItem) => void;
}) {
  const verification = verificationForStatus(item.nutritionStatus);
  const hasKcal = item.kcal !== null && item.kcal !== undefined;
  return (
    <GlassPanel className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            {item.name}
          </h3>
          {item.description && (
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              {item.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MenuStatusBadge status={item.nutritionStatus} />
            {verification && (
              <VerificationBadge
                verification={verification}
                basis={[...(item.assumptions ?? []), item.source ?? ""].filter(Boolean).join("; ") || null}
              />
            )}
            {item.portion && (
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Portion: {item.portion}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          {hasKcal ? (
            <p className="text-xl font-bold" style={{ color: "var(--text)" }}>
              {Math.round(item.kcal as number)}{" "}
              <span className="text-sm font-normal" style={{ color: "var(--text-secondary)" }}>
                kcal
              </span>
            </p>
          ) : (
            <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              Nutrition unavailable
            </p>
          )}
          {hasKcal && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
              P {Math.round(item.proteinG ?? 0)}g · C {Math.round(item.carbsG ?? 0)}g · F{" "}
              {Math.round(item.fatG ?? 0)}g
            </p>
          )}
        </div>
      </div>

      {item.assumptions.length > 0 && (
        <details className="mt-3">
          <summary
            className="cursor-pointer text-xs font-medium"
            style={{ color: "var(--accent)" }}
          >
            Assumptions ({item.assumptions.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs" style={{ color: "var(--text-secondary)" }}>
            {item.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <LuxButton
          variant="secondary"
          className="min-h-[40px] px-4 py-1.5 text-sm"
          onClick={() => onAddToDiary(item)}
          disabled={!hasKcal}
          title={hasKcal ? "Log this item to your diary" : "Can't log: nutrition unavailable"}
        >
          <Plus size={14} /> Add to diary
        </LuxButton>
        <LuxButton
          variant="ghost"
          className="min-h-[40px] px-4 py-1.5 text-sm"
          onClick={() => onFlag(item)}
        >
          <Flag size={14} /> Flag incorrect
        </LuxButton>
      </div>
    </GlassPanel>
  );
}

export default function RestaurantMenuPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [flagItem, setFlagItem] = useState<MenuItem | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagDone, setFlagDone] = useState(false);

  const [diaryItem, setDiaryItem] = useState<MenuItem | null>(null);
  const [mealType, setMealType] = useState<string>("lunch");
  const [diaryBusy, setDiaryBusy] = useState(false);
  const [diaryDone, setDiaryDone] = useState<string | null>(null);
  const [diaryError, setDiaryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ restaurant: Restaurant; items: MenuItem[] }>(
      `/api/restaurants/${encodeURIComponent(id)}/menu`,
    )
      .then((data) => {
        if (cancelled) return;
        setRestaurant(data.restaurant);
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Couldn't load the menu");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function submitFlag() {
    if (!flagItem || flagNote.trim().length < 4) return;
    setFlagBusy(true);
    try {
      await api(`/api/menu-items/${flagItem.id}/corrections`, {
        method: "POST",
        body: { note: flagNote.trim() },
      });
      setFlagDone(true);
      setFlagNote("");
    } catch (e) {
      setFlagNote((n) => n); // keep the note
      alert(e instanceof ApiError ? e.message : "Couldn't submit the correction");
    } finally {
      setFlagBusy(false);
    }
  }

  async function submitDiary() {
    if (!diaryItem || diaryItem.kcal === null) return;
    setDiaryBusy(true);
    setDiaryError(null);
    try {
      await api("/api/diary", {
        method: "POST",
        body: {
          date: todayYMD(),
          mealType,
          customName: `${diaryItem.name} — ${restaurant?.name ?? "restaurant"}`,
          kcal: Math.round(diaryItem.kcal),
          proteinG: Math.round(diaryItem.proteinG ?? 0),
          carbsG: Math.round(diaryItem.carbsG ?? 0),
          fatG: Math.round(diaryItem.fatG ?? 0),
          fiberG: Math.round(diaryItem.fiberG ?? 0),
          servings: 1,
        },
        headers: {
          "Idempotency-Key": `menu-${diaryItem.id}-${todayYMD()}-${mealType}`,
        },
      });
      setDiaryDone(
        `Logged "${diaryItem.name}" (${Math.round(diaryItem.kcal)} kcal) to ${mealType}.`,
      );
    } catch (e) {
      setDiaryError(e instanceof ApiError ? e.message : "Couldn't log to diary");
    } finally {
      setDiaryBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    );
  }

  if (error || !restaurant) {
    return (
      <ErrorStateLux
        title="Menu not available"
        message={error ?? "This restaurant could not be found."}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={restaurant.name}
        subtitle={[
          [restaurant.address, restaurant.city, restaurant.country].filter(Boolean).join(", "),
          restaurant.rating != null ? `★ ${restaurant.rating.toFixed(1)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          restaurant.website ? (
            <a
              href={restaurant.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 text-sm font-medium"
              style={{ borderColor: "var(--accent)", color: "var(--text)" }}
            >
              <ExternalLink size={14} /> Website
            </a>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyStateLux
          icon={<MapPin size={28} />}
          title="No menu items yet"
          message="Nobody has added this restaurant's menu. Scan a menu photo to add items."
          action={
            <LuxButton onClick={() => (window.location.href = "/log/order-scan")}>
              Scan a menu
            </LuxButton>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <MenuItemCard
              key={item.id}
              item={item}
              onFlag={(it) => {
                setFlagItem(it);
                setFlagNote("");
                setFlagDone(false);
              }}
              onAddToDiary={(it) => {
                setDiaryItem(it);
                setDiaryDone(null);
                setDiaryError(null);
              }}
            />
          ))}
        </div>
      )}

      {/* Flag-incorrect modal */}
      <Modal
        open={flagItem !== null}
        onClose={() => setFlagItem(null)}
        title={`Flag "${flagItem?.name ?? ""}"`}
      >
        {flagDone ? (
          <p className="text-sm" style={{ color: "var(--text)" }}>
            Thanks — your correction was submitted for review.
          </p>
        ) : (
          <>
            <Field label="What's wrong? (e.g. the calorie count looks off, wrong portion)">
              <Textarea
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                rows={4}
                placeholder="Describe the issue…"
              />
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <LuxButton variant="ghost" onClick={() => setFlagItem(null)}>
                Cancel
              </LuxButton>
              <LuxButton
                onClick={submitFlag}
                disabled={flagBusy || flagNote.trim().length < 4}
              >
                {flagBusy ? "Submitting…" : "Submit correction"}
              </LuxButton>
            </div>
          </>
        )}
      </Modal>

      {/* Add-to-diary modal */}
      <Modal
        open={diaryItem !== null}
        onClose={() => setDiaryItem(null)}
        title={`Log "${diaryItem?.name ?? ""}"`}
      >
        {diaryDone ? (
          <p className="text-sm" style={{ color: "var(--text)" }}>
            {diaryDone}
          </p>
        ) : (
          <>
            {diaryItem && diaryItem.nutritionStatus !== "restaurant_published" && (
              <p className="mb-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                Logs the best estimate ({Math.round(diaryItem.kcal ?? 0)} kcal) — see assumptions
                on the menu for what it&apos;s based on.
              </p>
            )}
            <Field label="Meal">
              <Select value={mealType} onChange={(e) => setMealType(e.target.value)}>
                {MEAL_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            {diaryError && (
              <p className="mt-2 text-sm" style={{ color: "var(--error)" }}>
                {diaryError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <LuxButton variant="ghost" onClick={() => setDiaryItem(null)}>
                Cancel
              </LuxButton>
              <LuxButton onClick={submitDiary} disabled={diaryBusy}>
                <Star size={14} /> {diaryBusy ? "Logging…" : "Log to diary"}
              </LuxButton>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
