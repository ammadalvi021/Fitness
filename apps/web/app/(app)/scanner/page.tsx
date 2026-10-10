'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';
import {
  allergenHits,
  formatDayLabel,
  mealLabel,
  newIdempotencyKey,
  num,
  todayYMD,
  unwrapList,
  unwrapObject,
  type MealType,
  type Nutrients,
  type ProfileLike,
} from '../nutrition/_shared';

const ESTIMATE_COPY = 'Estimates only — a photo can\u2019t show exact portions, oils, or hidden ingredients.';

/* ---------- shapes ---------- */

interface ScanItemRaw {
  name?: unknown;
  servings?: unknown;
  grams?: unknown;
  kcal?: unknown;
  kcalBest?: unknown;
  kcalLow?: unknown;
  kcalHigh?: unknown;
  kcalMin?: unknown;
  kcalMax?: unknown;
  proteinG?: unknown;
  carbsG?: unknown;
  fatG?: unknown;
  fiberG?: unknown;
  confidence?: unknown;
  assumptions?: unknown;
  alternatives?: unknown;
}

interface ScanDraft {
  key: string;
  name: string;
  servings: string;
  grams: string;
  kcalBest: string;
  kcalLow: number | null;
  kcalHigh: number | null;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fiberG: string;
  confidence: string;
  assumptions: string[];
  alternatives: string[];
  include: boolean;
}

interface FoodScanView {
  id: string;
  status: string;
  createdAt?: string;
  itemCount: number;
  rawItems: ScanItemRaw[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        if (typeof o.name === 'string') return o.name;
        if (typeof o.text === 'string') return o.text;
      }
      return '';
    })
    .filter((s) => s.trim().length > 0);
}

function normalizeItems(raw: unknown): ScanItemRaw[] {
  let arr: unknown = raw;
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is ScanItemRaw => x !== null && typeof x === 'object');
}

function toDraft(item: ScanItemRaw, key: string): ScanDraft {
  const kcalBest = num(item.kcalBest ?? item.kcal, 0);
  const lowRaw = item.kcalLow ?? item.kcalMin;
  const highRaw = item.kcalHigh ?? item.kcalMax;
  return {
    key,
    name: str(item.name) || 'Unknown food',
    servings: String(num(item.servings, 1) || 1),
    grams: item.grams != null ? String(num(item.grams)) : '',
    kcalBest: String(kcalBest),
    kcalLow: lowRaw != null ? num(lowRaw) : null,
    kcalHigh: highRaw != null ? num(highRaw) : null,
    proteinG: String(num(item.proteinG)),
    carbsG: String(num(item.carbsG)),
    fatG: String(num(item.fatG)),
    fiberG: String(num(item.fiberG)),
    confidence: str(item.confidence),
    assumptions: strList(item.assumptions),
    alternatives: strList(item.alternatives),
    include: true,
  };
}

function normalizeScan(s: Record<string, unknown>): FoodScanView {
  const rawItems = normalizeItems(s.items);
  return {
    id: String(s.id ?? ''),
    status: String(s.status ?? 'pending'),
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : undefined,
    itemCount: rawItems.length,
    rawItems,
  };
}

function confidenceTone(c: string): 'green' | 'amber' | 'red' | undefined {
  const v = c.toLowerCase();
  if (/(^|\D)(0\.[7-9]|0\.9\d*|1(\.0)?)(\D|$)/.test(v) || v.includes('high')) return 'green';
  if (v.includes('low')) return 'red';
  if (v.includes('med') || v === '') return undefined;
  return 'amber';
}

const MEAL_OPTIONS: MealType[] = [
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'extra',
];

export default function ScannerPage() {
  const [visionChecked, setVisionChecked] = useState(false);
  const [visionConfigured, setVisionConfigured] = useState(false);
  const [allergies, setAllergies] = useState<string[]>([]);

  const [uploading, setUploading] = useState(false);
  const [scan, setScan] = useState<FoodScanView | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [drafts, setDrafts] = useState<ScanDraft[]>([]);
  const [history, setHistory] = useState<FoodScanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDate, setConfirmDate] = useState(todayYMD());
  const [confirmMeal, setConfirmMeal] = useState<MealType>('lunch');
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  /* ---------------- setup checks ---------------- */

  const checkVision = useCallback(async () => {
    try {
      const cfg = await api<unknown>('/api/config');
      const root = unwrapObject<Record<string, unknown>>(cfg, 'data');
      const ai = (root as Record<string, unknown> | null)?.ai as Record<string, unknown> | undefined;
      const vision = ai?.vision;
      setVisionConfigured(
        vision != null && typeof vision === 'object'
          ? Boolean((vision as Record<string, unknown>).configured)
          : Boolean(vision),
      );
    } catch {
      setVisionConfigured(false);
    } finally {
      setVisionChecked(true);
    }
  }, []);

  const loadAllergies = useCallback(async () => {
    try {
      const meData = await api<unknown>('/api/auth/me');
      const root = unwrapObject<Record<string, unknown>>(meData, 'data');
      const prof =
        root && typeof root.profile === 'object' && root.profile !== null
          ? (root.profile as ProfileLike)
          : null;
      const alg = Array.isArray(prof?.allergies) ? prof.allergies.filter((a): a is string => typeof a === 'string') : [];
      const intol = Array.isArray(prof?.intolerances)
        ? prof.intolerances.filter((a): a is string => typeof a === 'string')
        : [];
      setAllergies([...alg, ...intol]);
    } catch {
      setAllergies([]);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api<unknown>('/api/scans');
      const list = unwrapList<Record<string, unknown>>(data, 'scans').map(normalizeScan);
      setHistory(list);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void checkVision();
    void loadAllergies();
    void loadHistory();
  }, [checkVision, loadAllergies, loadHistory]);

  /* ---------------- upload ---------------- */

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setConfirmed(false);
    setNotConfigured(false);
    try {
      const form = new FormData();
      form.append('image', file);
      // NOTE: the shared api() helper always sends JSON, so multipart uploads
      // use fetch directly (same 401 -> /login behavior as api()).
      const res = await fetch('/api/scans', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      if (res.status === 401 && typeof window !== 'undefined') {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        throw new ApiError(401, 'Not signed in', 'unauthorized');
      }
      let data: unknown = null;
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const err = (await res.json()) as { error?: { message?: string } };
          if (err?.error?.message) message = err.error.message;
        } catch {
          /* keep generic message */
        }
        throw new ApiError(res.status, message);
      }
      data = (await res.json()) as unknown;
      const s = normalizeScan(
        unwrapObject<Record<string, unknown>>(data, 'scan') ?? (data as Record<string, unknown>),
      );
      if (s.status === 'not_configured') {
        setNotConfigured(true);
        setScan(null);
        setDrafts([]);
      } else {
        setScan(s);
        setDrafts(s.rawItems.map((it, i) => toDraft(it, `${Date.now()}-${i}`)));
      }
      await loadHistory();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not analyze that photo. Try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function updateDraft(key: string, patch: Partial<ScanDraft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function removeDraft(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  function addBlankDraft() {
    setDrafts((prev) => [
      ...prev,
      {
        key: `blank-${Date.now()}`,
        name: '',
        servings: '1',
        grams: '',
        kcalBest: '0',
        kcalLow: null,
        kcalHigh: null,
        proteinG: '0',
        carbsG: '0',
        fatG: '0',
        fiberG: '0',
        confidence: '',
        assumptions: [],
        alternatives: [],
        include: true,
      },
    ]);
  }

  const included = drafts.filter((d) => d.include && d.name.trim().length > 0);
  const includedKcal = Math.round(included.reduce((n, d) => n + num(d.kcalBest), 0));

  /* ---------------- confirm ---------------- */

  async function handleConfirm() {
    if (!scan || included.length === 0) return;
    setConfirming(true);
    setError(null);
    try {
      const items = included.map((d) => {
        const nutrients: Nutrients = {
          kcal: num(d.kcalBest),
          proteinG: num(d.proteinG),
          carbsG: num(d.carbsG),
          fatG: num(d.fatG),
          fiberG: num(d.fiberG),
        };
        return { name: d.name.trim(), servings: Math.max(0.25, num(d.servings, 1)), nutrients };
      });
      await api(`/api/scans/${scan.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey() },
        body: { items, date: confirmDate, mealType: confirmMeal },
      });
      setConfirmed(true);
      setConfirmOpen(false);
      await loadHistory();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save those items to your diary.');
    } finally {
      setConfirming(false);
    }
  }

  function reviewScan(s: FoodScanView) {
    setScan(s);
    setNotConfigured(false);
    setConfirmed(false);
    setDrafts(s.rawItems.map((it, i) => toDraft(it, `${s.id}-${i}`)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- render ---------------- */

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 pb-24">
      <PageHeader title="Food scanner" subtitle="Snap a meal, review the estimate, log it" />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {/* ------- upload card ------- */}
      <Card className="p-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{ESTIMATE_COPY}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            id="scan-photo"
            aria-label="Take or choose a photo of your food"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <label
            htmlFor="scan-photo"
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {uploading ? 'Analyzing…' : 'Take / choose photo'}
          </label>
          {uploading && <span className="text-sm text-neutral-500">Analyzing your photo…</span>}
        </div>
        {!visionChecked ? (
          <Skeleton className="mt-3 h-4 w-48" />
        ) : (
          !visionConfigured && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              AI vision doesn&apos;t look configured — uploads will show the setup screen below.
            </p>
          )
        )}
      </Card>

      {/* ------- not configured ------- */}
      {notConfigured && (
        <Card className="p-6 text-center" role="status">
          <h2 className="text-lg font-semibold">AI food scanning isn&apos;t set up yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-neutral-600 dark:text-neutral-400">
            Photo analysis needs an AI vision provider. To enable it, add your vision API key — see
            the project README (&ldquo;AI setup&rdquo;) for instructions.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              className="min-h-[44px]"
              onClick={() => {
                window.location.href = '/nutrition';
              }}
            >
              Log food manually instead
            </Button>
            <Button
              type="button"
              className="min-h-[44px]"
              onClick={() => {
                setNotConfigured(false);
                fileRef.current?.click();
              }}
            >
              Try another photo
            </Button>
          </div>
        </Card>
      )}

      {/* ------- review screen ------- */}
      {scan && scan.status !== 'not_configured' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Review detected items</h2>
              <Badge tone={scan.status === 'review' ? 'amber' : undefined}>
                {scan.status === 'confirmed' ? 'Already logged' : 'Needs review'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{ESTIMATE_COPY}</p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400" aria-live="polite">
              {included.length} item{included.length === 1 ? '' : 's'} selected · ≈ {includedKcal} kcal
              total (estimate)
            </p>
          </Card>

          {drafts.length === 0 && (
            <EmptyState
              title="No items detected"
              message="The photo didn't yield any recognizable foods. Add items by hand instead."
              action={
                <Button type="button" className="min-h-[44px]" onClick={addBlankDraft}>
                  Add item manually
                </Button>
              }
            />
          )}

          {drafts.map((d) => {
            const hits = allergenHits([d.name], allergies);
            return (
              <Card key={d.key} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={d.include}
                      onChange={(e) => updateDraft(d.key, { include: e.target.checked })}
                      aria-label={`Include ${d.name || 'this item'} in diary`}
                    />
                    Include
                  </label>
                  {d.confidence && <Badge tone={confidenceTone(d.confidence)}>Confidence: {d.confidence}</Badge>}
                  <Button
                    type="button"
                    className="min-h-[44px]"
                    aria-label={`Remove ${d.name || 'item'}`}
                    onClick={() => removeDraft(d.key)}
                  >
                    Remove
                  </Button>
                </div>

                {hits.length > 0 && (
                  <div
                    role="alert"
                    className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                  >
                    May contain your allergen{hits.length > 1 ? 's' : ''}: {hits.join(', ')}.
                  </div>
                )}

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="Food name"
                    placeholder="Food name"
                    value={d.name}
                    onChange={(e) => updateDraft(d.key, { name: e.target.value })}
                    className="min-h-[44px] sm:col-span-2"
                  />
                  <Input
                    type="number"
                    min={0.25}
                    step={0.25}
                    aria-label="Servings"
                    placeholder="Servings"
                    value={d.servings}
                    onChange={(e) => updateDraft(d.key, { servings: e.target.value })}
                    className="min-h-[44px]"
                  />
                  <Input
                    type="number"
                    min={0}
                    aria-label="Grams (optional)"
                    placeholder="Grams (optional)"
                    value={d.grams}
                    onChange={(e) => updateDraft(d.key, { grams: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>

                <div className="mt-3 rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`kcal-${d.key}`} className="text-sm font-medium">
                      Best estimate (kcal)
                    </label>
                    <Input
                      id={`kcal-${d.key}`}
                      type="number"
                      min={0}
                      value={d.kcalBest}
                      onChange={(e) => updateDraft(d.key, { kcalBest: e.target.value })}
                      className="min-h-[44px] w-28"
                    />
                    {(d.kcalLow != null || d.kcalHigh != null) && (
                      <span className="text-xs text-neutral-500">
                        Range: {d.kcalLow != null ? Math.round(d.kcalLow) : '?'}–
                        {d.kcalHigh != null ? Math.round(d.kcalHigh) : '?'} kcal (estimate)
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(
                      [
                        ['proteinG', 'Protein (g)'],
                        ['carbsG', 'Carbs (g)'],
                        ['fatG', 'Fat (g)'],
                        ['fiberG', 'Fiber (g)'],
                      ] as const
                    ).map(([field, label]) => (
                      <Input
                        key={field}
                        type="number"
                        min={0}
                        aria-label={`${label} — ${d.name || 'item'}`}
                        placeholder={label}
                        value={d[field]}
                        onChange={(e) => updateDraft(d.key, { [field]: e.target.value })}
                        className="min-h-[44px]"
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">All nutrition values are estimates.</p>
                </div>

                {d.assumptions.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-sm font-semibold">What the AI assumed</h4>
                    <ul className="mt-1 list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
                      {d.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {d.alternatives.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-sm font-semibold">Could it be one of these instead?</h4>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {d.alternatives.map((a, i) => (
                        <Button
                          key={i}
                          type="button"
                          className="min-h-[44px]"
                          onClick={() => updateDraft(d.key, { name: a })}
                          aria-label={`Use ${a} instead`}
                        >
                          {a}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-[44px]" onClick={addBlankDraft}>
              + Add item
            </Button>
            <Button
              type="button"
              className="min-h-[44px]"
              disabled={included.length === 0 || scan.status === 'confirmed'}
              onClick={() => setConfirmOpen(true)}
            >
              {scan.status === 'confirmed' ? 'Already logged' : `Confirm & log (${included.length})`}
            </Button>
          </div>

          {confirmed && (
            <div
              role="status"
              className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
            >
              Logged to your diary for {formatDayLabel(confirmDate)} ·{' '}
              <a className="underline" href={`/nutrition?date=${confirmDate}`}>
                View diary
              </a>
            </div>
          )}
        </div>
      )}

      {/* ------- confirm modal ------- */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Log to diary">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {included.length} item{included.length === 1 ? '' : 's'} · ≈ {includedKcal} kcal (estimate).
          Choose where they go.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="scan-date" className="block text-sm font-medium">
              Date
            </label>
            <Input
              id="scan-date"
              type="date"
              value={confirmDate}
              max={todayYMD()}
              onChange={(e) => e.target.value && setConfirmDate(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="scan-meal" className="block text-sm font-medium">
              Meal
            </label>
            <Select
              id="scan-meal"
              value={confirmMeal}
              onChange={(e) => setConfirmMeal(e.target.value as MealType)}
              className="min-h-[44px]"
            >
              {MEAL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {mealLabel(m)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Button
          type="button"
          className="mt-4 min-h-[44px] w-full"
          disabled={confirming}
          onClick={() => void handleConfirm()}
        >
          {confirming ? 'Logging…' : 'Confirm & log to diary'}
        </Button>
      </Modal>

      {/* ------- history ------- */}
      <div>
        <h2 className="text-lg font-semibold">Scan history</h2>
        {history === null ? (
          <div className="mt-2 space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : history.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No scans yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {history.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {s.createdAt ? formatDayLabel(s.createdAt.slice(0, 10)) : 'Scan'} ·{' '}
                      {s.itemCount} item{s.itemCount === 1 ? '' : 's'}
                    </p>
                    <div className="mt-1">
                      <Badge
                        tone={
                          s.status === 'confirmed'
                            ? 'green'
                            : s.status === 'review'
                              ? 'amber'
                              : s.status === 'failed'
                                ? 'red'
                                : undefined
                        }
                      >
                        {s.status}
                      </Badge>
                    </div>
                  </div>
                  {s.status === 'review' && (
                    <Button
                      type="button"
                      className="min-h-[44px]"
                      onClick={() => reviewScan(s)}
                      aria-label={`Review scan from ${s.createdAt ?? s.id}`}
                    >
                      Review
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  );
}
