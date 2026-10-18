"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Check,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  GlassPanel,
  LuxButton,
  EmptyStateLux,
  ErrorStateLux,
  LuxBadge,
} from "@/components/luxury";
import { Input, Modal, PageHeader, Select, Skeleton, Textarea, Field } from "@/components/ui";
import { MenuStatusBadge } from "@/components/MenuStatusBadge";
import { estimateFromRecipe, type EstimateIngredient } from "@/lib/menu-estimate";

/* ---------- shapes ---------- */

interface QueueItem {
  id: string;
  note: string;
  status: string;
  createdAt: string;
  user: { id: string; email: string; name: string | null };
  menuItem: {
    id: string;
    name: string;
    kcal: number | null;
    nutritionStatus: string;
    restaurant: { id: string; name: string };
  };
}

interface SubmissionItem {
  id: string;
  name: string;
  portion: string | null;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  nutritionStatus: string;
  assumptions: string[];
  source: string | null;
  matchedFoodId: string | null;
  status: string;
  submittedAt: string;
  reviewNote: string | null;
  submitter: { id: string; email: string; name: string | null };
  restaurant: { id: string; name: string };
}

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

const STATUSES = [
  "restaurant_published",
  "calculated_estimate",
  "menu_photo_estimate",
  "user_submitted",
  "unavailable",
] as const;

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

/* ---------- page ---------- */

export default function AdminMenusPage() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);

  // v21.8 P2 — private customer submissions awaiting approval before publication.
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [subError, setSubError] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<SubmissionItem | null>(null);

  const [restaurantId, setRestaurantId] = useState("");
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  const [resolveTarget, setResolveTarget] = useState<QueueItem | null>(null);
  const [editTarget, setEditTarget] = useState<MenuItem | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ corrections: QueueItem[] }>("/api/corrections?status=open")
      .then((data) => {
        if (cancelled) return;
        setQueue(data.corrections ?? []);
        setAdmin(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          setAdmin(false);
        } else {
          setQueueError(e instanceof ApiError ? e.message : "Couldn't load the queue");
          setAdmin(true);
        }
      });
    api<{ submissions: SubmissionItem[] }>("/api/menu-submissions?status=pending")
      .then((data) => {
        if (cancelled) return;
        setSubmissions(data.submissions ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSubError(e instanceof ApiError ? e.message : "Couldn't load submissions");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSubmissions() {
    try {
      const data = await api<{ submissions: SubmissionItem[] }>(
        "/api/menu-submissions?status=pending",
      );
      setSubmissions(data.submissions ?? []);
    } catch {
      /* keep old queue */
    }
  }

  async function refreshQueue() {
    try {
      const data = await api<{ corrections: QueueItem[] }>("/api/corrections?status=open");
      setQueue(data.corrections ?? []);
    } catch {
      /* keep old queue */
    }
  }

  async function loadItems() {
    const rid = restaurantId.trim();
    if (!rid) return;
    setItemsLoading(true);
    setItemsError(null);
    try {
      const data = await api<{ restaurant: { name: string }; items: MenuItem[] }>(
        `/api/restaurants/${encodeURIComponent(rid)}/menu`,
      );
      setRestaurantName(data.restaurant.name);
      setItems(data.items ?? []);
    } catch (e) {
      setItems([]);
      setRestaurantName(null);
      setItemsError(e instanceof ApiError ? e.message : "Couldn't load menu items");
    } finally {
      setItemsLoading(false);
    }
  }

  async function verifyItem(item: MenuItem) {
    try {
      await api(`/api/menu-items/${item.id}`, {
        method: "PATCH",
        body: { verify: true },
      });
      await loadItems();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Couldn't verify the item");
    }
  }

  if (admin === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (admin === false) {
    return (
      <ErrorStateLux
        title="Admins only"
        message="This area is restricted to administrators (ADMIN_EMAILS)."
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Menu administration"
        subtitle="Review user corrections, verify menu items, and add or edit items."
      />

      {/* ---- corrections queue ---- */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold" style={{ color: "var(--text)" }}>
          Pending corrections ({queue.length})
        </h2>
        {queueError && (
          <p className="mb-3 text-sm" style={{ color: "var(--error)" }}>
            {queueError}
          </p>
        )}
        {queue.length === 0 ? (
          <EmptyStateLux
            icon={<BadgeCheck size={28} />}
            title="Queue is clear"
            message="No open menu corrections right now."
          />
        ) : (
          <div className="space-y-3">
            {queue.map((c) => (
              <GlassPanel key={c.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {c.menuItem.name}{" "}
                      <span className="font-normal" style={{ color: "var(--text-secondary)" }}>
                        @ {c.menuItem.restaurant.name}
                      </span>
                    </p>
                    <p className="mt-1 text-sm" style={{ color: "var(--text)" }}>
                      “{c.note}”
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      from {c.user.email} · {new Date(c.createdAt).toLocaleString()} · currently{" "}
                      {c.menuItem.kcal !== null ? `${Math.round(c.menuItem.kcal)} kcal` : "no kcal"},{" "}
                      <MenuStatusBadge status={c.menuItem.nutritionStatus} />
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <LuxButton
                      variant="secondary"
                      className="px-4 py-1.5 text-sm"
                      onClick={() => setResolveTarget(c)}
                    >
                      <Check size={14} /> Resolve
                    </LuxButton>
                  </div>
                </div>
              </GlassPanel>
            ))}
          </div>
        )}
      </section>

      {/* ---- pending menu submissions (private until approved) ---- */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold" style={{ color: "var(--text)" }}>
          Pending menu submissions ({submissions.length})
        </h2>
        <p className="mb-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          Customer menu-photo submissions stay private until approved here. Approving publishes
          the item to the restaurant&apos;s shared menu.
        </p>
        {subError && (
          <p className="mb-3 text-sm" style={{ color: "var(--error)" }}>
            {subError}
          </p>
        )}
        {submissions.length === 0 ? (
          <EmptyStateLux
            icon={<BadgeCheck size={28} />}
            title="No pending submissions"
            message="Nothing is waiting for review right now."
          />
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => (
              <GlassPanel key={sub.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {sub.name}{" "}
                      <span className="font-normal" style={{ color: "var(--text-secondary)" }}>
                        @ {sub.restaurant.name}
                        {sub.portion ? ` · ${sub.portion}` : ""}
                      </span>
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {sub.kcal !== null ? `${Math.round(sub.kcal)} kcal` : "no kcal"},{" "}
                      <MenuStatusBadge status={sub.nutritionStatus} />
                      {" · "}source: {sub.source ?? "—"}
                      {" · "}from {sub.submitter.email} ·{" "}
                      {new Date(sub.submittedAt).toLocaleString()}
                    </p>
                    {Array.isArray(sub.assumptions) && sub.assumptions.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {sub.assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <LuxButton
                      variant="secondary"
                      className="px-4 py-1.5 text-sm"
                      onClick={() => setReviewTarget(sub)}
                    >
                      <Check size={14} /> Review
                    </LuxButton>
                  </div>
                </div>
              </GlassPanel>
            ))}
          </div>
        )}
      </section>

      {/* ---- menu item management ---- */}
      <section>
        <h2 className="mb-3 text-lg font-semibold" style={{ color: "var(--text)" }}>
          Manage a restaurant&apos;s menu
        </h2>
        <GlassPanel className="mb-4 p-4">
          <Field label="Restaurant ID">
            <div className="flex gap-2">
              <Input
                value={restaurantId}
                onChange={(e) => setRestaurantId(e.target.value)}
                placeholder="Paste a restaurant ID"
                className="flex-1"
              />
              <LuxButton
                variant="secondary"
                onClick={loadItems}
                disabled={itemsLoading || restaurantId.trim().length === 0}
                className="px-4 text-sm"
              >
                {itemsLoading ? <Loader2 size={14} className="animate-spin" /> : "Load"}
              </LuxButton>
              <LuxButton
                onClick={() => setAdding(true)}
                disabled={restaurantId.trim().length === 0}
                className="px-4 text-sm"
              >
                <Plus size={14} /> Add item
              </LuxButton>
            </div>
          </Field>
          {restaurantName && (
            <p className="mt-2 text-sm" style={{ color: "var(--success)" }}>
              {restaurantName}
            </p>
          )}
          {itemsError && (
            <p className="mt-2 text-sm" style={{ color: "var(--error)" }}>
              {itemsError}
            </p>
          )}
        </GlassPanel>

        <div className="space-y-3">
          {items.map((item) => (
            <GlassPanel key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                    {item.name}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {item.kcal !== null ? `${Math.round(item.kcal)} kcal` : "Nutrition unavailable"}
                    {" · "}
                    <MenuStatusBadge status={item.nutritionStatus} />
                    {item.lastVerifiedAt && (
                      <> · verified {new Date(item.lastVerifiedAt).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <LuxButton
                    variant="secondary"
                    className="px-3 py-1.5 text-sm"
                    onClick={() => verifyItem(item)}
                    title={
                      item.nutritionStatus === "unavailable"
                        ? "Nothing to verify — nutrition is unavailable"
                        : "Stamp as verified now"
                    }
                    disabled={item.nutritionStatus === "unavailable"}
                  >
                    <BadgeCheck size={14} /> Verify
                  </LuxButton>
                  <LuxButton
                    variant="ghost"
                    className="px-3 py-1.5 text-sm"
                    onClick={() => setEditTarget(item)}
                  >
                    <Pencil size={14} /> Edit
                  </LuxButton>
                </div>
              </div>
            </GlassPanel>
          ))}
        </div>
      </section>

      {/* ---- resolve correction modal ---- */}
      <Modal
        open={resolveTarget !== null}
        onClose={() => setResolveTarget(null)}
        title="Resolve correction"
      >
        {resolveTarget && (
          <ResolveForm
            correction={resolveTarget}
            onDone={async () => {
              setResolveTarget(null);
              await refreshQueue();
            }}
          />
        )}
      </Modal>

      {/* ---- review submission modal ---- */}
      <Modal
        open={reviewTarget !== null}
        onClose={() => setReviewTarget(null)}
        title="Review menu submission"
      >
        {reviewTarget && (
          <SubmissionReviewForm
            submission={reviewTarget}
            onDone={async () => {
              setReviewTarget(null);
              await refreshSubmissions();
            }}
          />
        )}
      </Modal>

      {/* ---- add / edit item modal ---- */}
      <Modal
        open={editTarget !== null || adding}
        onClose={() => {
          setEditTarget(null);
          setAdding(false);
        }}
        title={editTarget ? `Edit "${editTarget.name}"` : "Add menu item"}
      >
        {(editTarget || adding) && (
          <ItemForm
            restaurantId={restaurantId.trim()}
            initial={editTarget ?? undefined}
            onDone={async () => {
              setEditTarget(null);
              setAdding(false);
              await loadItems();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ---------- resolve a correction ---------- */

function ResolveForm({
  correction,
  onDone,
}: {
  correction: QueueItem;
  onDone: () => void;
}) {
  const [kcal, setKcal] = useState(
    correction.menuItem.kcal !== null ? String(Math.round(correction.menuItem.kcal)) : "",
  );
  const [status, setStatus] = useState<string>(correction.menuItem.nutritionStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(decision: "accepted" | "rejected", withUpdates: boolean) {
    setBusy(true);
    setError(null);
    try {
      const k = num(kcal);
      const updates =
        withUpdates && decision === "accepted"
          ? { kcal: k, nutritionStatus: status }
          : undefined;
      await api(`/api/corrections/${correction.id}`, {
        method: "PATCH",
        body: { status: decision, ...(updates ? { updates } : {}) },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't resolve the correction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm" style={{ color: "var(--text)" }}>
        “{correction.note}”
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Corrected kcal (optional)">
          <Input
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 650"
          />
        </Field>
        <Field label="Nutrition status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && (
        <p className="mt-2 text-sm" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <LuxButton variant="ghost" onClick={() => resolve("rejected", false)} disabled={busy}>
          <X size={14} /> Reject
        </LuxButton>
        <LuxButton variant="secondary" onClick={() => resolve("accepted", false)} disabled={busy}>
          <Check size={14} /> Accept as-is
        </LuxButton>
        <LuxButton onClick={() => resolve("accepted", true)} disabled={busy}>
          <Check size={14} /> Accept + update item
        </LuxButton>
      </div>
    </div>
  );
}

/* ---------- review a menu submission (approve -> publish / reject) ---------- */

function SubmissionReviewForm({
  submission,
  onDone,
}: {
  submission: SubmissionItem;
  onDone: () => void;
}) {
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/menu-submissions/${submission.id}`, {
        method: "PATCH",
        body: { action, reviewNote: reviewNote.trim() || undefined },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't record the decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        {submission.name}{" "}
        <span className="font-normal" style={{ color: "var(--text-secondary)" }}>
          @ {submission.restaurant.name}
          {submission.portion ? ` · ${submission.portion}` : ""}
        </span>
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        {submission.kcal !== null ? `${Math.round(submission.kcal)} kcal` : "no kcal"},{" "}
        <MenuStatusBadge status={submission.nutritionStatus} />
        {" · "}source: {submission.source ?? "—"} · from {submission.submitter.email}
      </p>
      {Array.isArray(submission.assumptions) && submission.assumptions.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {submission.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      <Field label="Review note (optional)" className="mt-4">
        <Textarea
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          rows={2}
          placeholder="Why approve or reject…"
        />
      </Field>
      {error && (
        <p className="mt-2 text-sm" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <LuxButton variant="ghost" onClick={() => decide("reject")} disabled={busy}>
          <X size={14} /> Reject
        </LuxButton>
        <LuxButton onClick={() => decide("approve")} disabled={busy}>
          <Check size={14} /> Approve & publish
        </LuxButton>
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        Approving publishes this item to the restaurant&apos;s shared menu.
      </p>
    </div>
  );
}

/* ---------- add / edit menu item (with estimate calculator) ---------- */

function ItemForm({
  restaurantId,
  initial,
  onDone,
}: {
  restaurantId: string;
  initial?: MenuItem;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [portion, setPortion] = useState(initial?.portion ?? "");
  const [kcal, setKcal] = useState(initial?.kcal !== null && initial?.kcal !== undefined ? String(Math.round(initial.kcal)) : "");
  const [proteinG, setProteinG] = useState(initial?.proteinG != null ? String(initial.proteinG) : "");
  const [carbsG, setCarbsG] = useState(initial?.carbsG != null ? String(initial.carbsG) : "");
  const [fatG, setFatG] = useState(initial?.fatG != null ? String(initial.fatG) : "");
  const [fiberG, setFiberG] = useState(initial?.fiberG != null ? String(initial.fiberG) : "");
  const [nutritionStatus, setNutritionStatus] = useState<string>(
    initial?.nutritionStatus ?? "unavailable",
  );
  const [source, setSource] = useState(initial?.source ?? "");
  const [assumptions, setAssumptions] = useState<string[]>(
    Array.isArray(initial?.assumptions) ? initial.assumptions : [],
  );

  const [showCalc, setShowCalc] = useState(false);
  const [ingredients, setIngredients] = useState<EstimateIngredient[]>([
    { name: "", grams: 0, kcalPer100g: 0 },
  ]);
  const [portionGrams, setPortionGrams] = useState("");
  const [cookingMethod, setCookingMethod] = useState("");
  const [oilGrams, setOilGrams] = useState("");
  const [estimate, setEstimate] = useState<ReturnType<typeof estimateFromRecipe> | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState(false);

  function runEstimate() {
    const est = estimateFromRecipe({
      // Only drop truly blank placeholder rows; let the estimator classify
      // named/incomplete rows so problems surface instead of silently
      // disappearing from the total.
      ingredients: ingredients.filter(
        (i) => i.name.trim() || i.grams !== 0 || i.kcalPer100g !== 0,
      ),
      portionGrams: Number(portionGrams) || 0,
      cookingMethod: cookingMethod || undefined,
      oilGrams: Number(oilGrams) || 0,
    });
    setEstimate(est);
  }

  function applyEstimate() {
    if (!estimate || !estimate.complete) return;
    setKcal(String(Math.round(estimate.kcalBest)));
    setProteinG(String(estimate.proteinG));
    setCarbsG(String(estimate.carbsG));
    setFatG(String(estimate.fatG));
    setFiberG(String(estimate.fiberG));
    setNutritionStatus("calculated_estimate");
    setAssumptions(estimate.assumptions);
    setShowCalc(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const k = num(kcal);
    if (k === null && nutritionStatus !== "unavailable") {
      setError("This status requires a kcal value — or choose “unavailable”.");
      setBusy(false);
      return;
    }
    if (k !== null && nutritionStatus === "unavailable") {
      setError("An item with a kcal value can't be “unavailable”.");
      setBusy(false);
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      portion: portion.trim() || null,
      kcal: k,
      proteinG: num(proteinG),
      carbsG: num(carbsG),
      fatG: num(fatG),
      fiberG: num(fiberG),
      nutritionStatus,
      source: source.trim() || null,
      assumptions,
      ...(initial ? { verify } : {}),
    };
    try {
      if (initial) {
        await api(`/api/menu-items/${initial.id}`, { method: "PATCH", body: payload });
      } else {
        await api(`/api/restaurants/${encodeURIComponent(restaurantId)}/menu`, {
          method: "POST",
          body: payload,
        });
      }
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the item");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-h-[75vh] overflow-y-auto pr-1">
      <div className="grid gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Portion">
            <Input value={portion} onChange={(e) => setPortion(e.target.value)} placeholder="e.g. 1 plate" />
          </Field>
          <Field label="kcal">
            <Input value={kcal} onChange={(e) => setKcal(e.target.value)} inputMode="decimal" placeholder="—" />
          </Field>
          <Field label="Protein (g)">
            <Input value={proteinG} onChange={(e) => setProteinG(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Carbs (g)">
            <Input value={carbsG} onChange={(e) => setCarbsG(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Fat (g)">
            <Input value={fatG} onChange={(e) => setFatG(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Fiber (g)">
            <Input value={fiberG} onChange={(e) => setFiberG(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nutrition status">
            <Select value={nutritionStatus} onChange={(e) => setNutritionStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source">
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. restaurant website" />
          </Field>
        </div>
        {initial && (
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
            <input
              type="checkbox"
              checked={verify}
              onChange={(e) => setVerify(e.target.checked)}
              className="h-4 w-4"
            />
            Mark as verified now
          </label>
        )}
        {assumptions.length > 0 && (
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <p className="mb-1 text-xs font-medium" style={{ color: "var(--text)" }}>
              Assumptions ({assumptions.length})
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs" style={{ color: "var(--text-secondary)" }}>
              {assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setAssumptions([])}
              className="mt-2 text-xs underline"
              style={{ color: "var(--error)" }}
            >
              Clear assumptions
            </button>
          </div>
        )}
      </div>

      {/* estimate calculator */}
      <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
        <button
          type="button"
          onClick={() => setShowCalc((v) => !v)}
          className="text-sm font-medium"
          style={{ color: "var(--accent)" }}
        >
          {showCalc ? "− Hide" : "+ Estimate from recipe"} (calculated estimate)
        </button>
        {showCalc && (
          <div className="mt-3 space-y-2">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={ing.name}
                  onChange={(e) => {
                    const next = [...ingredients];
                    next[i] = { ...next[i], name: e.target.value };
                    setIngredients(next);
                  }}
                  placeholder="Ingredient"
                  className="flex-1"
                />
                <Input
                  value={ing.grams ? String(ing.grams) : ""}
                  onChange={(e) => {
                    const next = [...ingredients];
                    next[i] = { ...next[i], grams: Number(e.target.value) || 0 };
                    setIngredients(next);
                  }}
                  placeholder="g"
                  inputMode="decimal"
                  className="w-20"
                />
                <Input
                  value={ing.kcalPer100g == null ? "" : String(ing.kcalPer100g)}
                  onChange={(e) => {
                    const next = [...ingredients];
                    next[i] = { ...next[i], kcalPer100g: Number(e.target.value) || 0 };
                    setIngredients(next);
                  }}
                  placeholder="kcal/100g"
                  inputMode="decimal"
                  className="w-24"
                  title="kcal per 100 g (0 = known zero, e.g. water)"
                />
                {(
                  [
                    ["proteinPer100g", "P/100g"],
                    ["carbsPer100g", "C/100g"],
                    ["fatPer100g", "F/100g"],
                    ["fiberPer100g", "Fib/100g"],
                  ] as const
                ).map(([key, placeholder]) => (
                  <Input
                    key={key}
                    value={ing[key] == null ? "" : String(ing[key])}
                    onChange={(e) => {
                      const next = [...ingredients];
                      const v = e.target.value.trim() === "" ? undefined : Number(e.target.value) || 0;
                      next[i] = { ...next[i], [key]: v };
                      setIngredients(next);
                    }}
                    placeholder={placeholder}
                    inputMode="decimal"
                    className="w-20"
                    title={`${placeholder.replace("/100g", "")} per 100 g (0 = known zero; blank = unknown)`}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setIngredients(ingredients.filter((_, j) => j !== i))}
                  aria-label="Remove ingredient"
                  className="rounded-full p-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setIngredients([...ingredients, { name: "", grams: 0, kcalPer100g: 0 }])}
              className="text-xs underline"
              style={{ color: "var(--accent)" }}
            >
              + Add ingredient
            </button>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Portion (g)">
                <Input value={portionGrams} onChange={(e) => setPortionGrams(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Method">
                <Input
                  value={cookingMethod}
                  onChange={(e) => setCookingMethod(e.target.value)}
                  placeholder="e.g. fried"
                />
              </Field>
              <Field label="Oil (g)">
                <Input value={oilGrams} onChange={(e) => setOilGrams(e.target.value)} inputMode="decimal" />
              </Field>
            </div>
            <LuxButton variant="secondary" className="px-4 py-1.5 text-sm" onClick={runEstimate}>
              Calculate estimate
            </LuxButton>
            {estimate && estimate.complete && (
              <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: "color-mix(in srgb, var(--warning) 10%, transparent)" }}>
                <p style={{ color: "var(--text)" }}>
                  <strong>
                    {Math.round(estimate.kcalLow)}–{Math.round(estimate.kcalHigh)} kcal
                  </strong>{" "}
                  (best {Math.round(estimate.kcalBest)} kcal)
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {estimate.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                <LuxButton className="mt-2 px-4 py-1.5 text-sm" onClick={applyEstimate}>
                  Use this estimate
                </LuxButton>
              </div>
            )}
            {estimate && !estimate.complete && (
              <div className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--error)", backgroundColor: "color-mix(in srgb, var(--error) 8%, transparent)" }}>
                <p className="font-semibold" style={{ color: "var(--error)" }}>
                  <ShieldAlert size={14} className="mr-1 inline" />
                  Incomplete estimate — {estimate.problems.length} ingredient row(s) need correction
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--text)" }}>
                  The subtotal below covers only the valid rows and is{" "}
                  <strong>not</strong> the dish total. Fix the rows, then recalculate.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs" style={{ color: "var(--text)" }}>
                  {estimate.problems.map((p, i) => (
                    <li key={i}>
                      <strong>Row {p.row}{p.ingredient ? ` (“${p.ingredient}”)` : ""}:</strong>{" "}
                      {p.reason}
                      {p.fields.length > 0 && (
                        <span className="mt-0.5 block" style={{ color: "var(--text-secondary)" }}>
                          Missing fields: {p.fields.join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Partial subtotal of valid rows: {Math.round(estimate.kcalBest)} kcal — do not use as the item&apos;s nutrition.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm" style={{ color: "var(--error)" }}>
          <ShieldAlert size={14} className="mr-1 inline" />
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <LuxButton variant="ghost" onClick={onDone}>
          Cancel
        </LuxButton>
        <LuxButton onClick={save} disabled={busy || name.trim().length === 0}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add item"}
        </LuxButton>
      </div>
      {!initial && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          Items created here go live immediately on the restaurant&apos;s menu.
        </p>
      )}
    </div>
  );
}
