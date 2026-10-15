'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ChevronLeft, ChevronRight, Copy, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import { Input, Modal, Select, Skeleton } from '@/components/ui';
import { SwapsSection } from '@/components/SwapsSection';
import { MicronutrientSection } from '@/components/MicronutrientSection';
import {
  DAILY_VALUES,
  scaleMicros,
  sumEntryMicros,
  trackedMicroKeys,
  type MicroNutrients,
} from '@/lib/daily-values';
import {
  EmptyStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
  MetricCard,
  ProgressBar,
  ProgressRing,
  Tooltip,
} from '@/components/luxury';
import {
  addDaysYMD,
  allergenHits,
  computeTargets,
  entryName,
  formatDayLabel,
  mealLabel,
  newIdempotencyKey,
  num,
  round1,
  sumEntries,
  todayYMD,
  toDiaryPayload,
  unwrapList,
  unwrapObject,
  type DiaryEntry,
  type MealType,
  type Nutrients,
  type ProfileLike,
  type Targets,
} from './_shared';

/* ---------- API shapes (defensive: contract responses may be wrapped) ---------- */

interface FoodResult {
  id: string;
  name: string;
  brand?: string | null;
  servingSize?: number | null;
  servingUnit?: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  verified?: boolean;
  /** V18: present when /api/foods (Phase A) returns category data. */
  categoryId?: string | null;
  categoryName?: string | null;
}

/**
 * Normalize a /api/foods record to FoodResult. Accepts both the legacy
 * flat shape (top-level kcal/proteinG/...) and the Phase A shape
 * (perServing.{kcal,...}, category.{id,name}). Missing numbers become 0 —
 * the row shows "0 kcal" rather than crashing; VerificationBadge (via the
 * swaps section) still labels the data source honestly.
 */
function normalizeFoodResult(raw: Record<string, unknown>): FoodResult {
  const ps = (raw.perServing ?? {}) as Record<string, unknown>;
  const cat = (raw.category ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Food'),
    brand: typeof raw.brand === 'string' ? raw.brand : null,
    servingSize: num(raw.servingSize) > 0 ? num(raw.servingSize) : null,
    servingUnit: typeof raw.servingUnit === 'string' ? raw.servingUnit : null,
    kcal: num(ps.kcal ?? raw.kcal),
    proteinG: num(ps.proteinG ?? raw.proteinG),
    carbsG: num(ps.carbsG ?? raw.carbsG),
    fatG: num(ps.fatG ?? raw.fatG),
    fiberG: num(ps.fiberG ?? raw.fiberG),
    verified:
      typeof raw.verified === 'boolean' ? raw.verified : raw.verification === 'verified',
    categoryId:
      typeof raw.categoryId === 'string'
        ? raw.categoryId
        : typeof cat.id === 'string'
          ? cat.id
          : null,
    categoryName:
      typeof raw.categoryName === 'string'
        ? raw.categoryName
        : typeof cat.name === 'string'
          ? cat.name
          : null,
  };
}

interface RecipeResult {
  id: string;
  slug: string;
  title: string;
  kcalPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  fiberPerServing: number;
  servings?: number;
  ingredients?: unknown;
}

interface FavoriteItem {
  key: string;
  name: string;
  nutrients: Nutrients;
  detail?: string;
  recipeId?: string;
  allergenWarning?: string[];
}

const MEAL_ORDER: MealType[] = [
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'extra',
];

function servingText(e: DiaryEntry): string {
  const s = num(e.servings, 1);
  return `${s} serving${s === 1 ? '' : 's'}`;
}

function MacroBar({
  label,
  value,
  target,
  unit,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="t-body font-medium">{label}</span>
        <span className="t-meta" aria-live="polite">
          <span className="t-numeral">{round1(value)}</span> / <span className="t-numeral">{target}</span> {unit}
        </span>
      </div>
      <ProgressBar
        value={value}
        max={target}
        label={`${label} ${round1(value)} of ${target} ${unit}`}
      />
    </div>
  );
}

export default function NutritionDiaryPage() {
  const [date, setDate] = useState<string>(todayYMD());
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [waterMl, setWaterMl] = useState<number | null>(null);
  const [waterSaving, setWaterSaving] = useState(false);
  const [customWater, setCustomWater] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** V18: Ramadan mode from profile — adds Sehri/Iftar meal sections. */
  const [ramadanMode, setRamadanMode] = useState(false);

  const [modal, setModal] = useState<null | { kind: 'add'; mealType: MealType } | { kind: 'copy' }>(null);
  const [tab, setTab] = useState<'search' | 'manual' | 'recipe' | 'favorites'>('search');

  const [foodQuery, setFoodQuery] = useState('');
  const [foodResults, setFoodResults] = useState<FoodResult[] | null>(null);
  const [foodSearching, setFoodSearching] = useState(false);
  const [foodServings, setFoodServings] = useState<Record<string, number>>({});
  /** V18: which search-row food has its "Lighter alternatives" expanded. */
  const [swapsFor, setSwapsFor] = useState<string | null>(null);

  /** V19: internet food search (USDA + Open Food Facts) for the Search tab. */
  interface WebFoodResult {
    id: string;
    name: string;
    brand: string | null;
    servingSize: number | null;
    servingUnit: string | null;
    kcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    /** V20: USDA micros (per serving); null = not tracked. */
    micros: MicroNutrients | null;
    source: 'USDA' | 'Open Food Facts';
    sourceNote: string | null;
    verification: 'estimate';
    verificationBasis: string | null;
  }
  const [webResults, setWebResults] = useState<WebFoodResult[] | null>(null);
  const [webSearching, setWebSearching] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [webSources, setWebSources] = useState<{ usda: boolean; openFoodFacts: boolean } | null>(null);
  const [webServings, setWebServings] = useState<Record<string, number>>({});
  const [webAutoDoneFor, setWebAutoDoneFor] = useState<string>('');

  const [manual, setManual] = useState({
    name: '',
    servings: '1',
    kcal: '',
    proteinG: '',
    carbsG: '',
    fatG: '',
    fiberG: '',
  });

  const [recipeQuery, setRecipeQuery] = useState('');
  const [recipeResults, setRecipeResults] = useState<RecipeResult[] | null>(null);
  const [recipeSearching, setRecipeSearching] = useState(false);
  const [pickedRecipe, setPickedRecipe] = useState<RecipeResult | null>(null);
  const [recipeServings, setRecipeServings] = useState(1);

  const [favorites, setFavorites] = useState<FavoriteItem[] | null>(null);
  const [favServings, setFavServings] = useState<Record<string, number>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingServings, setEditingServings] = useState('1');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState(addDaysYMD(todayYMD(), -1));
  const [copyBusy, setCopyBusy] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------- data loading ---------------- */

  const loadTargets = useCallback(async () => {
    try {
      // Contract: GET /api/auth/me -> {user, profile, subscription}
      const meData = await api<unknown>('/api/auth/me');
      const root = unwrapObject<Record<string, unknown>>(meData, 'data');
      const prof = (
        root && typeof root.profile === 'object' && root.profile !== null
          ? (root.profile as ProfileLike)
          : (root as ProfileLike | null)
      );
      let weightKg: number | null = null;
      try {
        const mData = await api<unknown>('/api/measurements?type=weight');
        const list = unwrapList<{ value: number; recordedAt?: string }>(mData, 'measurements')
          .filter((m) => Number.isFinite(num(m.value)))
          .sort((a, b) => {
            const ta = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
            const tb = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
            return tb - ta;
          });
        if (list[0]) weightKg = num(list[0].value);
      } catch {
        weightKg = null;
      }
      setTargets(computeTargets(prof, weightKg));
      setRamadanMode(Boolean((prof as Record<string, unknown> | null)?.ramadanMode));
      const alg = Array.isArray(prof?.allergies) ? prof.allergies.filter((a): a is string => typeof a === 'string') : [];
      const intol = Array.isArray(prof?.intolerances)
        ? prof.intolerances.filter((a): a is string => typeof a === 'string')
        : [];
      setAllergies([...alg, ...intol]);
    } catch {
      setTargets(computeTargets(null, null));
      setAllergies([]);
    }
  }, []);

  const loadDiary = useCallback(async (d: string) => {
    setEntries(null);
    setError(null);
    try {
      const data = await api<unknown>(`/api/diary?date=${encodeURIComponent(d)}`);
      setEntries(unwrapList<DiaryEntry>(data, 'entries'));
    } catch (e) {
      setEntries([]);
      setError(e instanceof ApiError ? e.message : 'Could not load your food diary.');
    }
  }, []);

  const loadWater = useCallback(async (d: string) => {
    setWaterMl(null);
    try {
      const data = await api<unknown>(`/api/water?date=${encodeURIComponent(d)}`);
      const obj = unwrapObject<{ ml: number }>(data, 'water');
      setWaterMl(num(obj?.ml ?? (data as Record<string, unknown>)?.ml, 0));
    } catch {
      setWaterMl(0);
    }
  }, []);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    void loadDiary(date);
    void loadWater(date);
  }, [date, loadDiary, loadWater]);

  const totals = useMemo(() => (entries ? sumEntries(entries) : null), [entries]);
  const entriesByMeal = useMemo(() => {
    const map = new Map<string, DiaryEntry[]>();
    for (const e of entries ?? []) {
      const k = String(e.mealType);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return map;
  }, [entries]);

  /* ---------------- diary mutations ---------------- */

  const refreshDiary = useCallback(() => loadDiary(date), [date, loadDiary]);

  async function postEntry(body: Record<string, unknown>) {
    await api('/api/diary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey() },
      // toDiaryPayload flattens the nested `nutrients` object into the
      // top-level shape DiaryEntrySchema requires (regression fix: every
      // add path was 400ing with "Invalid diary entry").
      body: toDiaryPayload(body),
    });
    await refreshDiary();
  }

  async function handleAddFood(food: FoodResult, mealType: MealType, servingsOverride?: number) {
    const servings = Math.max(0.25, servingsOverride ?? num(foodServings[food.id], 1));
    setBusyId(`food-${food.id}`);
    setError(null);
    try {
      await postEntry({
        date,
        mealType,
        foodId: food.id,
        customName: food.name,
        servings,
        nutrients: {
          kcal: round1(num(food.kcal) * servings),
          proteinG: round1(num(food.proteinG) * servings),
          carbsG: round1(num(food.carbsG) * servings),
          fatG: round1(num(food.fatG) * servings),
          fiberG: round1(num(food.fiberG) * servings),
        },
        source: 'manual',
      });
      setModal(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add that food.');
    } finally {
      setBusyId(null);
    }
  }

  /** V19: renders the web-search results block for the Search tab. */
  const renderWebResults = () => {
    if (webSearching) {
      return <Skeleton className="h-16 w-full" aria-label="Searching the web for foods" />;
    }
    if (webError) {
      return (
        <p role="alert" className="t-body" style={{ color: 'var(--error)' }}>
          {webError}
        </p>
      );
    }
    if (!webResults) return null;
    if (webResults.length === 0) {
      return (
        <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
          Nothing on the web either. Try the Manual tab instead.
        </p>
      );
    }
    const mealType = (modal as { mealType: MealType } | null)?.mealType;
    return (
      <div className="space-y-2">
        <p className="t-meta">
          Web results
          {webSources && (
            <span>
              {' '}
              ·{' '}
              {[webSources.usda && 'USDA', webSources.openFoodFacts && 'Open Food Facts']
                .filter(Boolean)
                .join(' + ')}
            </span>
          )}
        </p>
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {webResults.map((r) => {
            const hits = allergenHits([r.name, r.brand ?? ''], allergies);
            const servings = Math.max(0.25, num(webServings[r.id], 1));
            return (
              <li
                key={r.id}
                className="rounded-xl border p-3"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="t-body font-medium">
                      {r.name}
                      {r.brand ? (
                        <span style={{ color: 'var(--text-secondary)' }}> · {r.brand}</span>
                      ) : null}
                    </p>
                    <p className="t-meta">
                      {r.kcal != null ? (
                        <>
                          <span className="t-numeral">{Math.round(r.kcal)}</span> kcal /{' '}
                        </>
                      ) : (
                        'No calorie data / '
                      )}
                      {r.servingSize ? `${r.servingSize} ${r.servingUnit ?? ''}`.trim() : 'serving'}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <LuxBadge>{r.source === 'USDA' ? 'USDA' : 'Open Food Facts'}</LuxBadge>
                      <LuxBadge>Estimate</LuxBadge>
                      {hits.length > 0 && (
                        <LuxBadge tone="error">Contains your allergen: {hits.join(', ')}</LuxBadge>
                      )}
                    </div>
                    {/* V20: available micros from USDA — never shown as 0 when missing. */}
                    {r.source === 'USDA' &&
                      (() => {
                        const keys = trackedMicroKeys(r.micros);
                        if (keys.length === 0) return null;
                        const shown = keys.slice(0, 5).map((k) => DAILY_VALUES[k].label);
                        return (
                          <p className="t-meta mt-1" style={{ color: 'var(--text-secondary)' }}>
                            Micros: {shown.join(', ')}
                            {keys.length > shown.length ? ` +${keys.length - shown.length} more` : ''}
                          </p>
                        );
                      })()}
                  </div>
                </div>
                {r.kcal != null && mealType ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      type="number"
                      min={0.25}
                      step={0.25}
                      aria-label={`Servings of ${r.name}`}
                      value={String(servings)}
                      onChange={(e) =>
                        setWebServings((s) => ({ ...s, [r.id]: num(e.target.value, 1) }))
                      }
                      className="min-h-[44px] w-20"
                    />
                    <span className="t-meta">servings</span>
                    <LuxButton
                      className="ml-auto"
                      disabled={busyId === `web-${r.id}`}
                      onClick={() => void handleWebAdd(r, mealType)}
                      aria-label={`Add ${r.name} to ${mealLabel(mealType)}`}
                    >
                      {busyId === `web-${r.id}` ? 'Adding…' : 'Add'}
                    </LuxButton>
                  </div>
                ) : (
                  <p className="t-meta mt-2" style={{ color: 'var(--text-secondary)' }}>
                    No calorie data for this item — add it via the Manual tab.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  /** V18: log a "Use instead" swap pick as the same meal (servings preserved). */
  async function handleUseInstead(raw: Record<string, unknown>, servings: number, mealType: MealType) {
    await handleAddFood(normalizeFoodResult(raw), mealType, servings);
  }

  /** V19: log a web-search result. foodId is null (not in our DB); the diary
   *  stores it as a custom entry with source 'web'. Results without calorie
   *  data can't be added — the UI disables their Add button.
   *  V20: micros are scaled by servings and snapshotted on the entry. */
  async function handleWebAdd(item: WebFoodResult, mealType: MealType) {
    if (item.kcal == null) return;
    const servings = Math.max(0.25, num(webServings[item.id], 1));
    setBusyId(`web-${item.id}`);
    setError(null);
    try {
      await postEntry({
        date,
        mealType,
        foodId: null,
        customName: item.brand ? `${item.name} (${item.brand})` : item.name,
        servings,
        nutrients: {
          kcal: round1(num(item.kcal) * servings),
          proteinG: round1(num(item.proteinG) * servings),
          carbsG: round1(num(item.carbsG) * servings),
          fatG: round1(num(item.fatG) * servings),
          fiberG: round1(num(item.fiberG) * servings),
        },
        micros: scaleMicros(item.micros, servings),
        source: 'web',
      });
      setModal(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add that food.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleManualAdd(mealType: MealType) {
    const servings = Math.max(0.25, num(manual.servings, 1));
    if (!manual.name.trim()) {
      setError('Give the food a name first.');
      return;
    }
    setBusyId('manual');
    setError(null);
    try {
      await postEntry({
        date,
        mealType,
        customName: manual.name.trim(),
        servings,
        nutrients: {
          kcal: round1(num(manual.kcal) * servings),
          proteinG: round1(num(manual.proteinG) * servings),
          carbsG: round1(num(manual.carbsG) * servings),
          fatG: round1(num(manual.fatG) * servings),
          fiberG: round1(num(manual.fiberG) * servings),
        },
        source: 'manual',
      });
      setManual({ name: '', servings: '1', kcal: '', proteinG: '', carbsG: '', fatG: '', fiberG: '' });
      setModal(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add that food.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRecipeAdd(mealType: MealType) {
    if (!pickedRecipe) return;
    const servings = Math.max(0.25, recipeServings);
    setBusyId(`recipe-${pickedRecipe.id}`);
    setError(null);
    try {
      await postEntry({
        date,
        mealType,
        recipeId: pickedRecipe.id,
        customName: pickedRecipe.title,
        servings,
        nutrients: {
          kcal: round1(num(pickedRecipe.kcalPerServing) * servings),
          proteinG: round1(num(pickedRecipe.proteinPerServing) * servings),
          carbsG: round1(num(pickedRecipe.carbsPerServing) * servings),
          fatG: round1(num(pickedRecipe.fatPerServing) * servings),
          fiberG: round1(num(pickedRecipe.fiberPerServing) * servings),
        },
        source: 'recipe',
      });
      setPickedRecipe(null);
      setModal(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add that recipe.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleFavoriteAdd(item: FavoriteItem, mealType: MealType) {
    const servings = Math.max(0.25, num(favServings[item.key], 1));
    setBusyId(`fav-${item.key}`);
    setError(null);
    try {
      await postEntry({
        date,
        mealType,
        ...(item.recipeId ? { recipeId: item.recipeId } : {}),
        customName: item.name,
        servings,
        nutrients: {
          kcal: round1(item.nutrients.kcal * servings),
          proteinG: round1(item.nutrients.proteinG * servings),
          carbsG: round1(item.nutrients.carbsG * servings),
          fatG: round1(item.nutrients.fatG * servings),
          fiberG: round1(item.nutrients.fiberG * servings),
        },
        source: item.recipeId ? 'recipe' : 'manual',
      });
      setModal(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add that favorite.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      await api(`/api/diary/${id}`, { method: 'DELETE' });
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete that entry.');
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(e: DiaryEntry) {
    setEditingId(e.id);
    setEditingServings(String(num(e.servings, 1)));
  }

  async function saveEdit(e: DiaryEntry) {
    const nextServings = Math.max(0.25, num(editingServings, 1));
    const factor = nextServings / Math.max(0.25, num(e.servings, 1));
    setBusyId(e.id);
    setError(null);
    try {
      await api(`/api/diary/${e.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: {
          servings: nextServings,
          kcal: round1(num(e.kcal) * factor),
          proteinG: round1(num(e.proteinG) * factor),
          carbsG: round1(num(e.carbsG) * factor),
          fatG: round1(num(e.fatG) * factor),
          fiberG: round1(num(e.fiberG) * factor),
        },
      });
      setEditingId(null);
      await refreshDiary();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update servings.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDuplicateMeal(mealType: MealType) {
    setBusyId(`dup-${mealType}`);
    setError(null);
    try {
      let source: DiaryEntry[] = [];
      for (let back = 1; back <= 7 && source.length === 0; back += 1) {
        const d = addDaysYMD(date, -back);
        const data = await api<unknown>(`/api/diary?date=${encodeURIComponent(d)}`);
        source = unwrapList<DiaryEntry>(data, 'entries').filter((e) => String(e.mealType) === mealType);
      }
      if (source.length === 0) {
        setError(`No previous ${mealLabel(mealType).toLowerCase()} found in the last 7 days.`);
        return;
      }
      for (const e of source) {
        await api('/api/diary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey() },
          body: {
            date,
            mealType,
            ...(e.foodId ? { foodId: e.foodId } : {}),
            customName: entryName(e),
            servings: num(e.servings, 1),
            nutrients: {
              kcal: num(e.kcal),
              proteinG: num(e.proteinG),
              carbsG: num(e.carbsG),
              fatG: num(e.fatG),
              fiberG: num(e.fiberG),
            },
            source: e.source ?? 'manual',
          },
        });
      }
      await refreshDiary();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not duplicate that meal.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopyDay() {
    if (copyFrom === date) {
      setError('Pick a different day to copy from.');
      return;
    }
    setCopyBusy(true);
    setError(null);
    try {
      const data = await api<unknown>(`/api/diary?date=${encodeURIComponent(copyFrom)}`);
      const source = unwrapList<DiaryEntry>(data, 'entries');
      if (source.length === 0) {
        setError(`${formatDayLabel(copyFrom)} has no logged foods to copy.`);
        return;
      }
      for (const e of source) {
        await api('/api/diary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey() },
          body: {
            date,
            mealType: e.mealType,
            ...(e.foodId ? { foodId: e.foodId } : {}),
            customName: entryName(e),
            servings: num(e.servings, 1),
            nutrients: {
              kcal: num(e.kcal),
              proteinG: num(e.proteinG),
              carbsG: num(e.carbsG),
              fatG: num(e.fatG),
              fiberG: num(e.fiberG),
            },
            source: e.source ?? 'manual',
          },
        });
      }
      setModal(null);
      await refreshDiary();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not copy that day.');
    } finally {
      setCopyBusy(false);
    }
  }

  /* ---------------- water ---------------- */

  async function addWater(ml: number) {
    if (waterMl == null) return;
    const next = Math.max(0, waterMl + ml);
    setWaterSaving(true);
    try {
      await api('/api/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { date, ml: next },
      });
      setWaterMl(next);
      setCustomWater('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not log water.');
    } finally {
      setWaterSaving(false);
    }
  }

  /* ---------------- search effects ---------------- */

  useEffect(() => {
    if (tab !== 'search' || !modal) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = foodQuery.trim();
    if (q.length < 2) {
      setFoodResults(null);
      setFoodSearching(false);
      return;
    }
    setFoodSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await api<unknown>(`/api/foods?q=${encodeURIComponent(q)}`);
        setFoodResults(unwrapList<Record<string, unknown>>(data, 'foods').map(normalizeFoodResult));
      } catch {
        setFoodResults([]);
      } finally {
        setFoodSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [foodQuery, tab, modal]);

  /** V19: run the unified internet food search. */
  const runWebSearch = useCallback(
    async (q: string) => {
      const query = q.trim();
      if (query.length < 2 || webSearching) return;
      setWebSearching(true);
      setWebError(null);
      try {
        const data = await api<{
          results: WebFoodResult[];
          sources: { usda: boolean; openFoodFacts: boolean };
        }>(`/api/foods/web-search?q=${encodeURIComponent(query)}`);
        setWebResults(data.results ?? []);
        setWebSources(data.sources ?? null);
      } catch (e) {
        setWebResults([]);
        setWebError(e instanceof ApiError ? e.message : 'Web search failed — try the Manual tab.');
      } finally {
        setWebSearching(false);
      }
    },
    [webSearching],
  );

  // V19: when the local library has nothing for the query, automatically try
  // the web once per query. Manual re-runs stay available via the button.
  useEffect(() => {
    if (tab !== 'search' || !modal) return;
    if (foodSearching) return;
    const q = foodQuery.trim();
    if (q.length < 2) {
      setWebResults(null);
      setWebError(null);
      setWebSources(null);
      setWebAutoDoneFor('');
      return;
    }
    if (foodResults && foodResults.length === 0 && webAutoDoneFor !== q) {
      setWebAutoDoneFor(q);
      void runWebSearch(q);
    }
  }, [foodResults, foodSearching, foodQuery, tab, modal, webAutoDoneFor, runWebSearch]);

  // V19: reset web state whenever the query changes so a new query re-arms auto-search.
  useEffect(() => {
    setWebAutoDoneFor('');
    setWebResults(null);
    setWebError(null);
    setWebSources(null);
  }, [foodQuery]);

  useEffect(() => {
    if (tab !== 'recipe' || !modal || pickedRecipe) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = recipeQuery.trim();
    if (q.length < 2) {
      setRecipeResults(null);
      setRecipeSearching(false);
      return;
    }
    setRecipeSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await api<unknown>(`/api/recipes?q=${encodeURIComponent(q)}`);
        setRecipeResults(unwrapList<RecipeResult>(data, 'recipes'));
      } catch {
        setRecipeResults([]);
      } finally {
        setRecipeSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [recipeQuery, tab, modal, pickedRecipe]);

  useEffect(() => {
    if (tab !== 'favorites' || !modal || favorites) return;
    (async () => {
      try {
        const data = await api<unknown>('/api/favorites');
        const raw = unwrapList<Record<string, unknown>>(data, 'favorites');
        const items: FavoriteItem[] = raw.map((f, i) => {
          const isRecipe = f.slug != null || f.title != null;
          const name = String(f.name ?? f.title ?? 'Favorite');
          const nutrients: Nutrients = isRecipe
            ? {
                kcal: num(f.kcalPerServing),
                proteinG: num(f.proteinPerServing),
                carbsG: num(f.carbsPerServing),
                fatG: num(f.fatPerServing),
                fiberG: num(f.fiberPerServing),
              }
            : {
                kcal: num(f.kcal),
                proteinG: num(f.proteinG),
                carbsG: num(f.carbsG),
                fatG: num(f.fatG),
                fiberG: num(f.fiberG),
              };
          const recipeId = typeof f.id === 'string' && isRecipe ? (f.id as string) : undefined;
          return {
            key: `${i}-${name}`,
            name,
            nutrients,
            detail: isRecipe ? 'Recipe favorite' : 'Saved meal',
            recipeId,
          };
        });
        setFavorites(items);
      } catch {
        setFavorites([]);
      }
    })();
  }, [tab, modal, favorites]);

  const openAdd = (mealType: MealType) => {
    setTab('search');
    setFoodQuery('');
    setFoodResults(null);
    setRecipeQuery('');
    setRecipeResults(null);
    setPickedRecipe(null);
    setRecipeServings(1);
    setFavorites(null);
    setError(null);
    setSwapsFor(null);
    setModal({ kind: 'add', mealType });
  };

  const kcalTarget = targets?.kcal ?? 2000;
  const consumed = totals?.kcal ?? 0;
  const remaining = kcalTarget - consumed;
  const waterGoal = targets?.waterMl ?? 2000;
  const caloriePct = kcalTarget > 0 ? Math.min((consumed / kcalTarget) * 100, 100) : 0;
  /** V18: Ramadan mode adds Sehri/Iftar meal sections (accepted by the API, no migration). */
  const mealOrder: MealType[] = ramadanMode ? [...MEAL_ORDER, 'sehri', 'iftar'] : MEAL_ORDER;
  const waterPct = waterGoal > 0 && waterMl != null ? Math.min((waterMl / waterGoal) * 100, 100) : 0;

  return (
    <div className="anim-page-enter mx-auto max-w-3xl space-y-6 p-4 pb-24">
      {/* ------------------------------ header ------------------------------ */}
      <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">Food diary</h1>
          <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
            {formatDayLabel(date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LuxButton
            variant="secondary"
            className="px-3"
            aria-label="Previous day"
            onClick={() => setDate((d) => addDaysYMD(d, -1))}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </LuxButton>
          <Input
            type="date"
            aria-label="Choose diary date"
            value={date}
            max={todayYMD()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="min-h-[44px]"
          />
          <LuxButton
            variant="secondary"
            className="px-3"
            aria-label="Next day"
            disabled={date >= todayYMD()}
            onClick={() => setDate((d) => addDaysYMD(d, 1))}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </LuxButton>
        </div>
      </div>

      {/* V18: entry point to the Log-a-Meal hub. */}
      <Link
        href="/log"
        className="anim-press flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--on-accent)' }}
      >
        <Plus size={18} aria-hidden="true" />
        Log a meal
      </Link>

      {error && (
        <div
          role="alert"
          className="rounded-xl border p-3 text-sm"
          style={{
            borderColor: 'color-mix(in srgb, var(--error) 45%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
            color: 'var(--text)',
          }}
        >
          {error}
        </div>
      )}

      {targets?.professionalGuidance && (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{
            borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
            color: 'var(--text)',
          }}
        >
          {targets.professionalGuidance}
        </div>
      )}

      {/* ------- daily summary ------- */}
      <GlassPanel className="p-6">
        {entries === null || !totals || !targets ? (
          <div className="flex items-center gap-6">
            <Skeleton className="h-32 w-32 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="flex flex-col items-center gap-2">
              <h2 className="t-meta flex items-center gap-1">
                Calories
                <Tooltip tip="Targets are estimated from your profile (age, sex, height, weight, activity level, and goal) — complete your profile for personalized targets.">
                  <Info size={13} aria-hidden="true" className="cursor-help" style={{ color: 'var(--text-secondary)' }} />
                </Tooltip>
              </h2>
              <div className="relative">
                <ProgressRing value={caloriePct} size={160} showValue={false} label="Calories consumed vs target" />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                  <span className="t-numeral text-3xl leading-none">{Math.round(consumed).toLocaleString()}</span>
                  <span className="t-meta mt-1.5">of {kcalTarget.toLocaleString()} kcal</span>
                </div>
              </div>
              <p className="t-body text-center" style={{ color: 'var(--text-secondary)' }}>
                {entries.length === 0 ? (
                  <>Nothing logged yet — {kcalTarget.toLocaleString()} kcal available today.</>
                ) : remaining >= 0 ? (
                  <>
                    <span className="t-numeral">{Math.round(remaining)}</span> kcal remaining
                  </>
                ) : (
                  <>
                    <span className="t-numeral">+{Math.round(-remaining)}</span> kcal over target
                  </>
                )}
              </p>
            </div>
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Target" value={<span className="t-numeral">{kcalTarget} kcal</span>} />
                <MetricCard
                  label="Logged"
                  value={<span className="t-numeral">{Math.round(consumed)} kcal</span>}
                  subtext={`${mealOrder.reduce((n, m) => n + (entriesByMeal.get(m)?.length ?? 0), 0)} items`}
                />
              </div>
              <MacroBar label="Protein" value={totals.proteinG} target={targets.proteinG} unit="g" />
              <MacroBar label="Carbs" value={totals.carbsG} target={targets.carbsG} unit="g" />
              <MacroBar label="Fat" value={totals.fatG} target={targets.fatG} unit="g" />
              <MacroBar label="Fiber" value={totals.fiberG} target={targets.fiberG} unit="g" />
              {targets.estimated && (
                <p className="t-meta flex items-center gap-1.5">
                  <Info size={13} aria-hidden="true" />
                  Targets are estimates — complete your profile for personalized targets.
                </p>
              )}
            </div>
          </div>
        )}
      </GlassPanel>

      {/* ------- micronutrients (V20) ------- */}
      {entries === null ? (
        <GlassPanel className="p-6">
          <Skeleton className="h-4 w-1/3" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </GlassPanel>
      ) : (
        <MicronutrientSection totals={sumEntryMicros(entries)} />
      )}

      {/* ------- water ------- */}
      <GlassPanel className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex justify-center">
            {waterMl == null ? (
              <Skeleton className="h-24 w-24 rounded-full" />
            ) : (
              <div className="relative">
                <ProgressRing value={waterPct} size={110} showValue={false} label="Water intake vs goal" />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="t-numeral text-xl">{waterMl}</span>
                  <span className="t-meta">ml</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1">
            <h2 className="t-card-heading">Water</h2>
            <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
              Quick-add your intake for the day{waterMl != null ? <> — goal <span className="t-numeral">{waterGoal}</span> ml</> : ''}.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <LuxButton
                variant="secondary"
                disabled={waterSaving || waterMl == null}
                onClick={() => void addWater(250)}
                aria-label="Add 250 milliliters of water"
              >
                +250 ml
              </LuxButton>
              <LuxButton
                variant="secondary"
                disabled={waterSaving || waterMl == null}
                onClick={() => void addWater(500)}
                aria-label="Add 500 milliliters of water"
              >
                +500 ml
              </LuxButton>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label="Custom water amount in milliliters"
                placeholder="ml"
                value={customWater}
                onChange={(e) => setCustomWater(e.target.value)}
                className="min-h-[44px] w-24"
              />
              <LuxButton
                disabled={waterSaving || waterMl == null || !customWater}
                onClick={() => void addWater(num(customWater))}
              >
                Add
              </LuxButton>
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* ------- meal sections ------- */}
      <div className="flex items-center justify-between">
        <h2 className="t-card-heading">Meals</h2>
        <LuxButton variant="secondary" onClick={() => setModal({ kind: 'copy' })}>
          <Copy size={16} aria-hidden="true" />
          Copy from another day
        </LuxButton>
      </div>

      {entries === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <GlassPanel key={i} className="p-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-4 w-full" />
            </GlassPanel>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {entries.length === 0 && (
            <p className="t-meta rounded-xl border border-dashed px-4 py-3 text-center" style={{ borderColor: 'var(--border)' }}>
              Nothing logged yet — tap <strong>Add food</strong> under any meal to start.
            </p>
          )}
          {mealOrder.map((mt) => {
            const list = entriesByMeal.get(mt) ?? [];
            const mealKcal = Math.round(list.reduce((n, e) => n + num(e.kcal), 0));
            return (
              <GlassPanel key={mt} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="t-card-heading">{mealLabel(mt)}</h3>
                    {list.length > 0 ? (
                      <LuxBadge tone="success">Logged</LuxBadge>
                    ) : (
                      <LuxBadge>Not logged</LuxBadge>
                    )}
                  </div>
                  <span className="t-meta" aria-live="polite">
                    <span className="t-numeral">{mealKcal}</span> kcal
                  </span>
                </div>

                {list.length > 0 && (
                  <ul className="mt-3 divide-y" style={{ borderColor: 'var(--border)' }}>
                    {list.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="t-body truncate font-medium">{entryName(e)}</p>
                          {/* V21.4: entries logged with acknowledged incomplete
                              nutrition are marked partial — partial totals
                              are never presented as complete. */}
                          {e.nutritionPartial ? (
                            <LuxBadge tone="warning" className="mt-1">Partial nutrition</LuxBadge>
                          ) : null}
                          <p className="t-meta">
                            {servingText(e)} · <span className="t-numeral">{Math.round(num(e.kcal))}</span> kcal · P{' '}
                            <span className="t-numeral">{round1(num(e.proteinG))}</span>g
                          </p>
                          {allergies.length > 0 &&
                            allergenHits([e.customName], allergies).length > 0 && (
                              <LuxBadge tone="error" className="mt-1">Contains your allergen</LuxBadge>
                            )}
                        </div>
                        {editingId === e.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0.25}
                              step={0.25}
                              aria-label={`Servings for ${entryName(e)}`}
                              value={editingServings}
                              onChange={(ev) => setEditingServings(ev.target.value)}
                              className="min-h-[44px] w-20"
                            />
                            <LuxButton
                              disabled={busyId === e.id}
                              onClick={() => void saveEdit(e)}
                            >
                              Save
                            </LuxButton>
                            <LuxButton
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </LuxButton>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <LuxButton
                              variant="secondary"
                              aria-label={`Edit servings for ${entryName(e)}`}
                              onClick={() => startEdit(e)}
                            >
                              <Pencil size={15} aria-hidden="true" />
                              Edit
                            </LuxButton>
                            <LuxButton
                              variant="ghost"
                              aria-label={`Remove ${entryName(e)}`}
                              disabled={busyId === e.id}
                              onClick={() => void handleDelete(e.id)}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                              Remove
                            </LuxButton>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <LuxButton
                    onClick={() => openAdd(mt)}
                    aria-label={`Add food to ${mealLabel(mt)}`}
                  >
                    <Plus size={16} aria-hidden="true" />
                    Add food
                  </LuxButton>
                  <LuxButton
                    variant="secondary"
                    disabled={busyId === `dup-${mt}`}
                    onClick={() => void handleDuplicateMeal(mt)}
                    aria-label={`Repeat your last ${mealLabel(mt).toLowerCase()}`}
                  >
                    <Copy size={16} aria-hidden="true" />
                    {busyId === `dup-${mt}` ? 'Copying…' : 'Repeat last'}
                  </LuxButton>
                </div>
              </GlassPanel>
            );
          })}
        </div>
      )}

      {/* ------- add-food modal (existing Modal — focus behavior preserved) ------- */}
      <Modal
        open={modal?.kind === 'add'}
        onClose={() => setModal(null)}
        title={modal?.kind === 'add' ? `Add food — ${mealLabel(modal.mealType)}` : 'Add food'}
      >
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Add food methods">
          {(
            [
              ['search', 'Search'],
              ['manual', 'Manual'],
              ['recipe', 'From recipe'],
              ['favorites', 'Favorites'],
            ] as const
          ).map(([v, label]) => (
            <LuxButton
              key={v}
              role="tab"
              aria-selected={tab === v}
              variant={tab === v ? 'primary' : 'secondary'}
              onClick={() => setTab(v)}
            >
              {label}
            </LuxButton>
          ))}
        </div>

        {modal?.kind === 'add' && tab === 'search' && (
          <div role="tabpanel" className="space-y-3">
            <Input
              type="search"
              aria-label="Search foods"
              placeholder="Search foods (e.g. oatmeal)"
              value={foodQuery}
              onChange={(e) => setFoodQuery(e.target.value)}
              className="min-h-[44px]"
            />
            {foodSearching && <Skeleton className="h-16 w-full" />}
            {foodResults && foodResults.length === 0 && !foodSearching && (
              <div className="space-y-3">
                <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
                  Nothing in your food library — checking the web…
                </p>
                {renderWebResults()}
              </div>
            )}
            {foodResults && foodResults.length > 0 && !webResults && !webSearching && !webError && (
              <button
                type="button"
                onClick={() => void runWebSearch(foodQuery)}
                className="t-body w-full rounded-xl border border-dashed px-4 py-3 text-center"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Not finding it? <span className="underline underline-offset-2">Search the web</span>
              </button>
            )}
            {foodResults && foodResults.length > 0 && (webSearching || webError || (webResults && webResults.length > 0)) && (
              <div className="space-y-3">
                {renderWebResults()}
              </div>
            )}
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {(foodResults ?? []).map((f) => {
                const hits = allergenHits([f.name, f.brand], allergies);
                const servings = Math.max(0.25, num(foodServings[f.id], 1));
                return (
                  <li
                    key={f.id}
                    className="rounded-xl border p-3"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="t-body font-medium">
                          {f.name}
                          {f.brand ? <span style={{ color: 'var(--text-secondary)' }}> · {f.brand}</span> : null}
                        </p>
                        <p className="t-meta">
                          <span className="t-numeral">{Math.round(num(f.kcal))}</span> kcal /{' '}
                          {f.servingSize ? `${f.servingSize} ${f.servingUnit ?? ''}` : 'serving'}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {f.verified && <LuxBadge tone="success">Verified</LuxBadge>}
                          {hits.length > 0 && (
                            <LuxBadge tone="error">Contains your allergen: {hits.join(', ')}</LuxBadge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        min={0.25}
                        step={0.25}
                        aria-label={`Servings of ${f.name}`}
                        value={String(servings)}
                        onChange={(e) => setFoodServings((s) => ({ ...s, [f.id]: num(e.target.value, 1) }))}
                        className="min-h-[44px] w-20"
                      />
                      <span className="t-meta">servings</span>
                      <LuxButton
                        className="ml-auto"
                        disabled={busyId === `food-${f.id}`}
                        onClick={() => void handleAddFood(f, (modal as { mealType: MealType }).mealType)}
                        aria-label={`Add ${f.name} to ${mealLabel((modal as { mealType: MealType }).mealType)}`}
                      >
                        {busyId === `food-${f.id}` ? 'Adding…' : 'Add'}
                      </LuxButton>
                    </div>
                    {/* V18: lighter alternatives (lazy — fetches only when expanded) */}
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => setSwapsFor((cur) => (cur === f.id ? null : f.id))}
                        className="t-meta underline underline-offset-2"
                        aria-expanded={swapsFor === f.id}
                      >
                        {swapsFor === f.id ? 'Hide lighter options' : 'Lighter options'}
                      </button>
                      {swapsFor === f.id && (
                        <SwapsSection
                          food={{
                            id: f.id,
                            name: f.name,
                            perServingKcal: f.kcal,
                            servingSize: f.servingSize ?? null,
                            servingUnit: f.servingUnit ?? null,
                            categoryId: f.categoryId ?? null,
                            categoryName: f.categoryName ?? null,
                          }}
                          onUseInstead={(raw) =>
                            void handleUseInstead(raw, servings, (modal as { mealType: MealType }).mealType)
                          }
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {modal?.kind === 'add' && tab === 'manual' && (
          <div role="tabpanel" className="space-y-3">
            <Input
              aria-label="Food name"
              placeholder="Food name *"
              value={manual.name}
              onChange={(e) => setManual((m) => ({ ...m, name: e.target.value }))}
              className="min-h-[44px]"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min={0.25}
                step={0.25}
                aria-label="Servings"
                placeholder="Servings"
                value={manual.servings}
                onChange={(e) => setManual((m) => ({ ...m, servings: e.target.value }))}
                className="min-h-[44px]"
              />
              <Input
                type="number"
                min={0}
                aria-label="Calories per serving"
                placeholder="kcal / serving"
                value={manual.kcal}
                onChange={(e) => setManual((m) => ({ ...m, kcal: e.target.value }))}
                className="min-h-[44px]"
              />
              <Input
                type="number"
                min={0}
                aria-label="Protein grams per serving"
                placeholder="Protein (g)"
                value={manual.proteinG}
                onChange={(e) => setManual((m) => ({ ...m, proteinG: e.target.value }))}
                className="min-h-[44px]"
              />
              <Input
                type="number"
                min={0}
                aria-label="Carbs grams per serving"
                placeholder="Carbs (g)"
                value={manual.carbsG}
                onChange={(e) => setManual((m) => ({ ...m, carbsG: e.target.value }))}
                className="min-h-[44px]"
              />
              <Input
                type="number"
                min={0}
                aria-label="Fat grams per serving"
                placeholder="Fat (g)"
                value={manual.fatG}
                onChange={(e) => setManual((m) => ({ ...m, fatG: e.target.value }))}
                className="min-h-[44px]"
              />
              <Input
                type="number"
                min={0}
                aria-label="Fiber grams per serving"
                placeholder="Fiber (g)"
                value={manual.fiberG}
                onChange={(e) => setManual((m) => ({ ...m, fiberG: e.target.value }))}
                className="min-h-[44px]"
              />
            </div>
            <LuxButton
              className="w-full"
              disabled={busyId === 'manual'}
              onClick={() => void handleManualAdd((modal as { mealType: MealType }).mealType)}
            >
              {busyId === 'manual' ? 'Adding…' : 'Add to diary'}
            </LuxButton>
          </div>
        )}

        {modal?.kind === 'add' && tab === 'recipe' && (
          <div role="tabpanel" className="space-y-3">
            {!pickedRecipe ? (
              <>
                <Input
                  type="search"
                  aria-label="Search recipes"
                  placeholder="Search recipes"
                  value={recipeQuery}
                  onChange={(e) => setRecipeQuery(e.target.value)}
                  className="min-h-[44px]"
                />
                {recipeSearching && <Skeleton className="h-16 w-full" />}
                <ul className="max-h-80 space-y-2 overflow-y-auto">
                  {(recipeResults ?? []).map((r) => {
                    const hits = allergenHits(
                      Array.isArray(r.ingredients)
                        ? (r.ingredients as Record<string, unknown>[]).map((i) =>
                            typeof i === 'object' && i !== null ? String((i as Record<string, unknown>).name ?? '') : String(i),
                          )
                        : [r.title],
                      allergies,
                    );
                    return (
                      <li key={r.id}>
                        <LuxButton
                          variant="secondary"
                          className="w-full justify-start text-left"
                          onClick={() => {
                            setPickedRecipe(r);
                            setRecipeServings(num(r.servings, 1) || 1);
                          }}
                        >
                          <span className="block">
                            <span className="block truncate text-sm font-medium">{r.title}</span>
                            <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {Math.round(num(r.kcalPerServing))} kcal/serving
                            </span>
                            {hits.length > 0 && <LuxBadge tone="error">Allergen: {hits.join(', ')}</LuxBadge>}
                          </span>
                        </LuxButton>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="t-body font-medium">{pickedRecipe.title}</p>
                  <LuxButton variant="secondary" onClick={() => setPickedRecipe(null)}>
                    Change
                  </LuxButton>
                </div>
                {(() => {
                  const hits = allergenHits(
                    Array.isArray(pickedRecipe.ingredients)
                      ? (pickedRecipe.ingredients as Record<string, unknown>[]).map((i) =>
                          typeof i === 'object' && i !== null
                            ? String((i as Record<string, unknown>).name ?? '')
                            : String(i),
                        )
                      : [pickedRecipe.title],
                    allergies,
                  );
                  return hits.length > 0 ? (
                    <div
                      role="alert"
                      className="rounded-xl border p-3 text-sm"
                      style={{
                        borderColor: 'color-mix(in srgb, var(--error) 45%, transparent)',
                        backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
                        color: 'var(--text)',
                      }}
                    >
                      This recipe may contain your allergen{hits.length > 1 ? 's' : ''}:{' '}
                      {hits.join(', ')}. Nothing will be substituted — add it only if you are
                      sure it is safe for you.
                    </div>
                  ) : null;
                })()}
                <div className="flex items-center gap-2">
                  <span className="t-body">Servings</span>
                  <Input
                    type="number"
                    min={0.25}
                    step={0.25}
                    aria-label="Recipe servings"
                    value={String(recipeServings)}
                    onChange={(e) => setRecipeServings(Math.max(0.25, num(e.target.value, 1)))}
                    className="min-h-[44px] w-24"
                  />
                  <span className="t-body" style={{ color: 'var(--text-secondary)' }}>
                    ≈ <span className="t-numeral">{Math.round(num(pickedRecipe.kcalPerServing) * recipeServings)}</span> kcal
                  </span>
                </div>
                <LuxButton
                  className="w-full"
                  disabled={busyId === `recipe-${pickedRecipe.id}`}
                  onClick={() => void handleRecipeAdd((modal as { mealType: MealType }).mealType)}
                >
                  {busyId === `recipe-${pickedRecipe.id}` ? 'Adding…' : 'Add to diary'}
                </LuxButton>
              </div>
            )}
          </div>
        )}

        {modal?.kind === 'add' && tab === 'favorites' && (
          <div role="tabpanel" className="space-y-3">
            {favorites === null ? (
              <Skeleton className="h-16 w-full" />
            ) : favorites.length === 0 ? (
              <EmptyStateLux
                title="No favorites yet"
                message="Favorite a recipe or save a meal to find it here."
              />
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {favorites.map((f) => {
                  const servings = Math.max(0.25, num(favServings[f.key], 1));
                  return (
                    <li
                      key={f.key}
                      className="rounded-xl border p-3"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
                    >
                      <p className="t-body font-medium">{f.name}</p>
                      <p className="t-meta">
                        {f.detail} · <span className="t-numeral">{Math.round(f.nutrients.kcal)}</span> kcal/serving
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          type="number"
                          min={0.25}
                          step={0.25}
                          aria-label={`Servings of ${f.name}`}
                          value={String(servings)}
                          onChange={(e) => setFavServings((s) => ({ ...s, [f.key]: num(e.target.value, 1) }))}
                          className="min-h-[44px] w-20"
                        />
                        <span className="t-meta">servings</span>
                        <LuxButton
                          className="ml-auto"
                          disabled={busyId === `fav-${f.key}`}
                          onClick={() => void handleFavoriteAdd(f, (modal as { mealType: MealType }).mealType)}
                          aria-label={`Add ${f.name} to diary`}
                        >
                          {busyId === `fav-${f.key}` ? 'Adding…' : 'Add'}
                        </LuxButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Modal>

      {/* ------- copy-day modal ------- */}
      <Modal open={modal?.kind === 'copy'} onClose={() => setModal(null)} title="Copy from another day">
        <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
          Copy every logged food from a previous day into {formatDayLabel(date)}.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="date"
            aria-label="Day to copy from"
            value={copyFrom}
            max={todayYMD()}
            onChange={(e) => e.target.value && setCopyFrom(e.target.value)}
            className="min-h-[44px]"
          />
          <LuxButton
            disabled={copyBusy}
            onClick={() => void handleCopyDay()}
          >
            {copyBusy ? 'Copying…' : 'Copy day'}
          </LuxButton>
        </div>
      </Modal>

      {/* ------- estimates honesty note ------- */}
      <p className="t-meta flex items-start gap-1.5">
        <Info size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
        Nutrition values from the food database and recipes are estimates, not lab measurements —
        use them as guidance, not exact accounting.
      </p>
    </div>
  );
}
