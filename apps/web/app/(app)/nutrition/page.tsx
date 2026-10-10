'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  ProgressRing,
  Select,
  Skeleton,
  Stat,
} from '@/components/ui';
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
  colorClass,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  colorClass: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-sm text-neutral-600 dark:text-neutral-400" aria-live="polite">
          {round1(value)} / {target} {unit}
        </span>
      </div>
      <div
        className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-label={`${label} ${round1(value)} of ${target} ${unit}`}
      >
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
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

  const [modal, setModal] = useState<null | { kind: 'add'; mealType: MealType } | { kind: 'copy' }>(null);
  const [tab, setTab] = useState<'search' | 'manual' | 'recipe' | 'favorites'>('search');

  const [foodQuery, setFoodQuery] = useState('');
  const [foodResults, setFoodResults] = useState<FoodResult[] | null>(null);
  const [foodSearching, setFoodSearching] = useState(false);
  const [foodServings, setFoodServings] = useState<Record<string, number>>({});

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
      body,
    });
    await refreshDiary();
  }

  async function handleAddFood(food: FoodResult, mealType: MealType) {
    const servings = Math.max(0.25, num(foodServings[food.id], 1));
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
        setFoodResults(unwrapList<FoodResult>(data, 'foods'));
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
    setModal({ kind: 'add', mealType });
  };

  const kcalTarget = targets?.kcal ?? 2000;
  const consumed = totals?.kcal ?? 0;
  const remaining = kcalTarget - consumed;
  const waterGoal = targets?.waterMl ?? 2000;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 pb-24">
      <PageHeader
        title="Food diary"
        subtitle={formatDayLabel(date)}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              aria-label="Previous day"
              className="min-h-[44px] min-w-[44px]"
              onClick={() => setDate((d) => addDaysYMD(d, -1))}
            >
              ‹
            </Button>
            <Input
              type="date"
              aria-label="Choose diary date"
              value={date}
              max={todayYMD()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="min-h-[44px]"
            />
            <Button
              type="button"
              aria-label="Next day"
              className="min-h-[44px] min-w-[44px]"
              disabled={date >= todayYMD()}
              onClick={() => setDate((d) => addDaysYMD(d, 1))}
            >
              ›
            </Button>
          </div>
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {targets?.professionalGuidance && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {targets.professionalGuidance}
        </div>
      )}

      {/* ------- daily summary ------- */}
      <Card className="p-4">
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
            <div className="flex justify-center">
              <ProgressRing
                value={Math.round(consumed)}
                max={kcalTarget}
                size={150}
                label={`${Math.round(consumed)}`}
                sublabel={
                  remaining >= 0
                    ? `${Math.round(remaining)} kcal remaining of ${kcalTarget} target`
                    : `${Math.round(-remaining)} kcal over target`
                }
              />
            </div>
            <div className="flex-1 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Target" value={`${kcalTarget} kcal`} />
                <Stat
                  label="Logged"
                  value={`${Math.round(consumed)} kcal`}
                  sub={`${MEAL_ORDER.reduce((n, m) => n + (entriesByMeal.get(m)?.length ?? 0), 0)} items`}
                />
              </div>
              <MacroBar label="Protein" value={totals.proteinG} target={targets.proteinG} unit="g" colorClass="bg-sky-500" />
              <MacroBar label="Carbs" value={totals.carbsG} target={targets.carbsG} unit="g" colorClass="bg-amber-500" />
              <MacroBar label="Fat" value={totals.fatG} target={targets.fatG} unit="g" colorClass="bg-rose-500" />
              <MacroBar label="Fiber" value={totals.fiberG} target={targets.fiberG} unit="g" colorClass="bg-emerald-500" />
              {targets.estimated && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Targets are estimates — complete your profile for personalized targets.
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ------- water ------- */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex justify-center">
            {waterMl == null ? (
              <Skeleton className="h-24 w-24 rounded-full" />
            ) : (
              <ProgressRing
                value={waterMl}
                max={waterGoal}
                size={110}
                label={`${waterMl} ml`}
                sublabel={`of ${waterGoal} ml goal`}
              />
            )}
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">Water</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Quick-add your intake for the day.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="min-h-[44px]"
                disabled={waterSaving || waterMl == null}
                onClick={() => void addWater(250)}
                aria-label="Add 250 milliliters of water"
              >
                +250 ml
              </Button>
              <Button
                type="button"
                className="min-h-[44px]"
                disabled={waterSaving || waterMl == null}
                onClick={() => void addWater(500)}
                aria-label="Add 500 milliliters of water"
              >
                +500 ml
              </Button>
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
              <Button
                type="button"
                className="min-h-[44px]"
                disabled={waterSaving || waterMl == null || !customWater}
                onClick={() => void addWater(num(customWater))}
              >
                Add
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* ------- meal sections ------- */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Meals</h2>
        <Button type="button" className="min-h-[44px]" onClick={() => setModal({ kind: 'copy' })}>
          Copy from another day
        </Button>
      </div>

      {entries === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-4 w-full" />
            </Card>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="No foods logged yet"
          message="Log what you ate and your calories, macros, and fiber will add up here."
          action={
            <Button type="button" className="min-h-[44px]" onClick={() => openAdd('breakfast')}>
              Log your first food
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {MEAL_ORDER.map((mt) => {
            const list = entriesByMeal.get(mt) ?? [];
            const mealKcal = Math.round(list.reduce((n, e) => n + num(e.kcal), 0));
            return (
              <Card key={mt} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{mealLabel(mt)}</h3>
                    {list.length > 0 ? (
                      <Badge tone="green">Logged</Badge>
                    ) : (
                      <Badge>Not logged</Badge>
                    )}
                  </div>
                  <span className="text-sm text-neutral-600 dark:text-neutral-400" aria-live="polite">
                    {mealKcal} kcal
                  </span>
                </div>

                {list.length > 0 && (
                  <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-700">
                    {list.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{entryName(e)}</p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {servingText(e)} · {Math.round(num(e.kcal))} kcal · P {round1(num(e.proteinG))}g
                          </p>
                          {allergies.length > 0 &&
                            allergenHits([e.customName], allergies).length > 0 && (
                              <Badge tone="red">Contains your allergen</Badge>
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
                            <Button
                              type="button"
                              className="min-h-[44px]"
                              disabled={busyId === e.id}
                              onClick={() => void saveEdit(e)}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              className="min-h-[44px]"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              className="min-h-[44px]"
                              aria-label={`Edit servings for ${entryName(e)}`}
                              onClick={() => startEdit(e)}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              className="min-h-[44px]"
                              aria-label={`Remove ${entryName(e)}`}
                              disabled={busyId === e.id}
                              onClick={() => void handleDelete(e.id)}
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-[44px]"
                    onClick={() => openAdd(mt)}
                    aria-label={`Add food to ${mealLabel(mt)}`}
                  >
                    + Add food
                  </Button>
                  <Button
                    type="button"
                    className="min-h-[44px]"
                    disabled={busyId === `dup-${mt}`}
                    onClick={() => void handleDuplicateMeal(mt)}
                    aria-label={`Repeat your last ${mealLabel(mt).toLowerCase()}`}
                  >
                    {busyId === `dup-${mt}` ? 'Copying…' : 'Repeat last'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ------- add-food modal ------- */}
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
            <Button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              variant={tab === v ? 'primary' : 'secondary'}
              className="min-h-[44px]"
              onClick={() => setTab(v)}
            >
              {label}
            </Button>
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
              <p className="text-sm text-neutral-500">No foods found. Try the Manual tab instead.</p>
            )}
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {(foodResults ?? []).map((f) => {
                const hits = allergenHits([f.name, f.brand], allergies);
                const servings = Math.max(0.25, num(foodServings[f.id], 1));
                return (
                  <li key={f.id} className="rounded-lg border p-3 dark:border-neutral-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {f.name}
                          {f.brand ? <span className="text-neutral-500"> · {f.brand}</span> : null}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {Math.round(num(f.kcal))} kcal /{' '}
                          {f.servingSize ? `${f.servingSize} ${f.servingUnit ?? ''}` : 'serving'}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {f.verified && <Badge tone="green">Verified</Badge>}
                          {hits.length > 0 && (
                            <Badge tone="red">Contains your allergen: {hits.join(', ')}</Badge>
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
                      <span className="text-xs text-neutral-500">servings</span>
                      <Button
                        type="button"
                        className="ml-auto min-h-[44px]"
                        disabled={busyId === `food-${f.id}`}
                        onClick={() => void handleAddFood(f, (modal as { mealType: MealType }).mealType)}
                        aria-label={`Add ${f.name} to ${mealLabel((modal as { mealType: MealType }).mealType)}`}
                      >
                        {busyId === `food-${f.id}` ? 'Adding…' : 'Add'}
                      </Button>
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
            <Button
              type="button"
              className="min-h-[44px] w-full"
              disabled={busyId === 'manual'}
              onClick={() => void handleManualAdd((modal as { mealType: MealType }).mealType)}
            >
              {busyId === 'manual' ? 'Adding…' : 'Add to diary'}
            </Button>
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
                        <Button
                          type="button"
                          className="min-h-[44px] w-full text-left"
                          onClick={() => {
                            setPickedRecipe(r);
                            setRecipeServings(num(r.servings, 1) || 1);
                          }}
                        >
                          <span className="block truncate text-sm font-medium">{r.title}</span>
                          <span className="block text-xs text-neutral-500">
                            {Math.round(num(r.kcalPerServing))} kcal/serving
                          </span>
                          {hits.length > 0 && <Badge tone="red">Allergen: {hits.join(', ')}</Badge>}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{pickedRecipe.title}</p>
                  <Button type="button" className="min-h-[44px]" onClick={() => setPickedRecipe(null)}>
                    Change
                  </Button>
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
                      className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                    >
                      This recipe may contain your allergen{hits.length > 1 ? 's' : ''}:{' '}
                      {hits.join(', ')}. Nothing will be substituted — add it only if you are
                      sure it is safe for you.
                    </div>
                  ) : null;
                })()}
                <div className="flex items-center gap-2">
                  <span className="text-sm">Servings</span>
                  <Input
                    type="number"
                    min={0.25}
                    step={0.25}
                    aria-label="Recipe servings"
                    value={String(recipeServings)}
                    onChange={(e) => setRecipeServings(Math.max(0.25, num(e.target.value, 1)))}
                    className="min-h-[44px] w-24"
                  />
                  <span className="text-sm text-neutral-500">
                    ≈ {Math.round(num(pickedRecipe.kcalPerServing) * recipeServings)} kcal
                  </span>
                </div>
                <Button
                  type="button"
                  className="min-h-[44px] w-full"
                  disabled={busyId === `recipe-${pickedRecipe.id}`}
                  onClick={() => void handleRecipeAdd((modal as { mealType: MealType }).mealType)}
                >
                  {busyId === `recipe-${pickedRecipe.id}` ? 'Adding…' : 'Add to diary'}
                </Button>
              </div>
            )}
          </div>
        )}

        {modal?.kind === 'add' && tab === 'favorites' && (
          <div role="tabpanel" className="space-y-3">
            {favorites === null ? (
              <Skeleton className="h-16 w-full" />
            ) : favorites.length === 0 ? (
              <EmptyState
                title="No favorites yet"
                message="Favorite a recipe or save a meal to find it here."
              />
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {favorites.map((f) => {
                  const servings = Math.max(0.25, num(favServings[f.key], 1));
                  return (
                    <li key={f.key} className="rounded-lg border p-3 dark:border-neutral-700">
                      <p className="text-sm font-medium">{f.name}</p>
                      <p className="text-xs text-neutral-500">
                        {f.detail} · {Math.round(f.nutrients.kcal)} kcal/serving
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
                        <span className="text-xs text-neutral-500">servings</span>
                        <Button
                          type="button"
                          className="ml-auto min-h-[44px]"
                          disabled={busyId === `fav-${f.key}`}
                          onClick={() => void handleFavoriteAdd(f, (modal as { mealType: MealType }).mealType)}
                          aria-label={`Add ${f.name} to diary`}
                        >
                          {busyId === `fav-${f.key}` ? 'Adding…' : 'Add'}
                        </Button>
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
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
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
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={copyBusy}
            onClick={() => void handleCopyDay()}
          >
            {copyBusy ? 'Copying…' : 'Copy day'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
