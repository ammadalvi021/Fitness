'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Clock,
  Copy,
  Download,
  Heart,
  ShoppingCart,
  Star,
} from 'lucide-react';
import { Input, Modal, Select, Skeleton } from '@/components/ui';
import {
  EmptyStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
  MetricCard,
} from '@/components/luxury';
import {
  allergenHits,
  formatDayLabel,
  mealLabel,
  newIdempotencyKey,
  num,
  round1,
  todayYMD,
  unwrapList,
  unwrapObject,
  type MealType,
  type Nutrients,
  type ProfileLike,
} from '../../nutrition/_shared';

/* ---------- shapes ---------- */

interface RecipeIngredient {
  name: string;
  quantity: string;
  grams?: number;
  substitutions?: string[] | null;
}

interface RecipeDetail {
  id: string;
  slug: string;
  title: string;
  cuisine?: string | null;
  dietCategory?: string | null;
  tags: string[];
  servings: number;
  prepMin: number;
  cookMin: number;
  difficulty?: string | null;
  ingredients: RecipeIngredient[];
  instructions: string[];
  perServing: Nutrients;
  imageUrl?: string | null;
  source?: string | null;
  verified: boolean;
  allergens: string[];
  substitutions?: string[] | Record<string, string> | null;
  storage?: string | null;
  reheating?: string | null;
}

function normalizeRecipe(r: Record<string, unknown>): RecipeDetail {
  const perServing: Nutrients = {
    kcal: num(r.kcalPerServing),
    proteinG: num(r.proteinPerServing),
    carbsG: num(r.carbsPerServing),
    fatG: num(r.fatPerServing),
    fiberG: num(r.fiberPerServing),
  };
  const rawIngredients = Array.isArray(r.ingredients) ? (r.ingredients as unknown[]) : [];
  const ingredients: RecipeIngredient[] = rawIngredients.map((i) => {
    if (typeof i === 'string') return { name: i, quantity: '' };
    const o = i as Record<string, unknown>;
    return {
      name: String(o.name ?? ''),
      quantity: String(o.quantity ?? ''),
      grams: o.grams != null && Number.isFinite(num(o.grams)) ? num(o.grams) : undefined,
      substitutions: Array.isArray(o.substitutions)
        ? (o.substitutions as unknown[]).map(String)
        : null,
    };
  });
  const rawSteps = Array.isArray(r.instructions) ? (r.instructions as unknown[]) : [];
  const instructions = rawSteps.map((s) => {
    if (typeof s === 'string') return s;
    if (s && typeof s === 'object') {
      const o = s as Record<string, unknown>;
      return String(o.text ?? o.step ?? o.instruction ?? '');
    }
    return '';
  }).filter((s) => s.length > 0);
  return {
    id: String(r.id ?? ''),
    slug: String(r.slug ?? ''),
    title: String(r.title ?? 'Recipe'),
    cuisine:
      typeof r.cuisine === 'string'
        ? r.cuisine
        : typeof (r.cuisine as Record<string, unknown> | null)?.name === 'string'
          ? String((r.cuisine as Record<string, unknown>).name)
          : null,
    dietCategory: typeof r.dietCategory === 'string' ? r.dietCategory : null,
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
    servings: num(r.servings, 1) || 1,
    prepMin: num(r.prepMin),
    cookMin: num(r.cookMin),
    difficulty: typeof r.difficulty === 'string' ? r.difficulty : null,
    ingredients,
    instructions,
    perServing,
    imageUrl: typeof r.imageUrl === 'string' ? r.imageUrl : null,
    source: typeof r.source === 'string' ? r.source : null,
    verified: Boolean(r.verified),
    allergens: Array.isArray(r.allergens) ? (r.allergens as unknown[]).map(String) : [],
    substitutions: (r.substitutions as RecipeDetail['substitutions']) ?? null,
    storage: typeof r.storage === 'string' ? r.storage : null,
    reheating: typeof r.reheating === 'string' ? r.reheating : null,
  };
}

interface PlanOption {
  id: string;
  label: string;
}

const MEAL_OPTIONS: MealType[] = [
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'extra',
];

export default function RecipeDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug ?? '');

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [servings, setServings] = useState(1);
  const [favorited, setFavorited] = useState(false);
  const [favBusy, setFavBusy] = useState(false);

  const [logOpen, setLogOpen] = useState(false);
  const [logDate, setLogDate] = useState(todayYMD());
  const [logMeal, setLogMeal] = useState<MealType>('dinner');
  const [logBusy, setLogBusy] = useState(false);
  const [logDone, setLogDone] = useState(false);

  const [shopOpen, setShopOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [planOpen, setPlanOpen] = useState(false);
  const [planOptions, setPlanOptions] = useState<PlanOption[] | null>(null);
  const [planChoice, setPlanChoice] = useState('');
  const [planDay, setPlanDay] = useState(0);
  const [planMealType, setPlanMealType] = useState<MealType>('dinner');
  const [planDone, setPlanDone] = useState(false);

  const [error, setError] = useState<string | null>(null);

  /* ---------------- load ---------------- */

  useEffect(() => {
    (async () => {
      try {
        const data = await api<unknown>(`/api/recipes/${encodeURIComponent(slug)}`);
        const raw = unwrapObject<Record<string, unknown>>(data, 'recipe') ?? (data as Record<string, unknown>);
        const normalized = normalizeRecipe(raw);
        setRecipe(normalized);
        setServings(normalized.servings);
      } catch (e) {
        setLoadError(e instanceof ApiError ? e.message : 'Could not load this recipe.');
      }
    })();
  }, [slug]);

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  /* initial favorite state (best effort) */
  useEffect(() => {
    if (!recipe) return;
    (async () => {
      try {
        const data = await api<unknown>('/api/favorites');
        const list = unwrapList<Record<string, unknown>>(data, 'favorites');
        setFavorited(
          list.some((f) => String(f.id ?? f.slug ?? '') === recipe.id || String(f.slug ?? '') === recipe.slug),
        );
      } catch {
        /* leave as not favorited */
      }
    })();
  }, [recipe]);

  const factor = useMemo(
    () => (recipe ? Math.max(0.25, servings) / Math.max(0.25, recipe.servings) : 1),
    [recipe, servings],
  );
  const scaled: Nutrients | null = useMemo(
    () =>
      recipe
        ? {
            kcal: recipe.perServing.kcal * factor,
            proteinG: recipe.perServing.proteinG * factor,
            carbsG: recipe.perServing.carbsG * factor,
            fatG: recipe.perServing.fatG * factor,
            fiberG: recipe.perServing.fiberG * factor,
          }
        : null,
    [recipe, factor],
  );

  const allergenHitsAll = useMemo(() => {
    if (!recipe || allergies.length === 0) return [];
    const fromList = recipe.allergens.filter((a) =>
      allergies.some((u) => u.toLowerCase() === a.toLowerCase()),
    );
    const fromIngredients = allergenHits(
      recipe.ingredients.map((i) => i.name),
      allergies,
    );
    return Array.from(new Set([...fromList, ...fromIngredients]));
  }, [recipe, allergies]);

  const isAi = recipe?.source === 'ai';

  /* ---------------- actions ---------------- */

  async function toggleFavorite() {
    if (!recipe) return;
    setFavBusy(true);
    setError(null);
    try {
      const data = await api<unknown>(`/api/recipes/${recipe.id}/favorite`, { method: 'POST' });
      const obj = unwrapObject<{ favorited?: boolean; favorite?: boolean }>(data, 'data');
      const next =
        typeof obj?.favorited === 'boolean'
          ? obj.favorited
          : typeof obj?.favorite === 'boolean'
            ? obj.favorite
            : !favorited;
      setFavorited(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update favorites.');
    } finally {
      setFavBusy(false);
    }
  }

  async function handleLog() {
    if (!recipe || !scaled) return;
    setLogBusy(true);
    setError(null);
    try {
      const s = Math.max(0.25, servings);
      await api('/api/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey() },
        body: {
          date: logDate,
          mealType: logMeal,
          recipeId: recipe.id,
          customName: recipe.title,
          servings: s,
          nutrients: {
            kcal: round1(scaled.kcal),
            proteinG: round1(scaled.proteinG),
            carbsG: round1(scaled.carbsG),
            fatG: round1(scaled.fatG),
            fiberG: round1(scaled.fiberG),
          },
          source: 'recipe',
        },
      });
      setLogDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not log this recipe.');
    } finally {
      setLogBusy(false);
    }
  }

  const shoppingText = useMemo(() => {
    if (!recipe) return '';
    const lines = recipe.ingredients.map((i) => {
      const qty = i.quantity ? ` — ${i.quantity}` : '';
      const grams = i.grams != null ? ` (≈${Math.round(i.grams * factor)} g for ${round1(Math.max(0.25, servings))} servings)` : '';
      return `• ${i.name}${qty}${grams}`;
    });
    return `${recipe.title} — ingredients for ${round1(Math.max(0.25, servings))} servings\n\n${lines.join('\n')}`;
  }, [recipe, factor, servings]);

  async function copyShopping() {
    try {
      await navigator.clipboard.writeText(shoppingText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — select the text manually.');
    }
  }

  function downloadShopping() {
    const blob = new Blob([shoppingText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recipe?.slug ?? 'recipe'}-shopping-list.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const openPlanPicker = useCallback(async () => {
    setPlanOpen(true);
    setPlanDone(false);
    setPlanOptions(null);
    try {
      const data = await api<unknown>('/api/meals/plans');
      const list = unwrapList<Record<string, unknown>>(data, 'plans');
      const opts: PlanOption[] = list.map((p) => ({
        id: String(p.id ?? ''),
        label: `Week of ${typeof p.weekStart === 'string' ? formatDayLabel(p.weekStart.slice(0, 10)) : ''} (${p.generatedBy === 'ai' ? 'AI' : 'template'})`,
      }));
      setPlanOptions(opts);
      if (opts.length > 0) setPlanChoice(opts[0].id);
    } catch {
      setPlanOptions([]);
    }
  }, []);

  function addToPlan() {
    if (!recipe || !planChoice) return;
    const s = Math.max(0.25, servings);
    const meal = {
      id: `recipe-${recipe.id}`,
      name: recipe.title,
      mealType: planMealType,
      ingredients: recipe.ingredients.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        grams: i.grams,
      })),
      nutrients: recipe.perServing, // per 1 serving (contract)
      servings: s,
      scaledNutrients: {
        kcal: round1(recipe.perServing.kcal * (s / recipe.servings)),
        proteinG: round1(recipe.perServing.proteinG * (s / recipe.servings)),
        carbsG: round1(recipe.perServing.carbsG * (s / recipe.servings)),
        fatG: round1(recipe.perServing.fatG * (s / recipe.servings)),
        fiberG: round1(recipe.perServing.fiberG * (s / recipe.servings)),
      },
      prepMin: recipe.prepMin,
      cookMin: recipe.cookMin,
      instructions: recipe.instructions,
      tags: recipe.tags,
      cuisine: recipe.cuisine,
      dietCategory: recipe.dietCategory,
      labels: recipe.tags,
      imageUrl: recipe.imageUrl,
    };
    try {
      const key = `fitfusion.planAdditions.${planChoice}`;
      const raw = localStorage.getItem(key);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(arr) ? arr : [];
      list.push({ dayIndex: planDay, meal });
      localStorage.setItem(key, JSON.stringify(list));
      setPlanDone(true);
    } catch {
      setError('Could not save to the meal plan on this device.');
    }
  }

  /* ---------------- render ---------------- */

  if (loadError) {
    return (
      <div className="anim-page-enter mx-auto max-w-3xl p-4 pb-24">
        <EmptyStateLux
          icon={<BookOpen size={22} aria-hidden="true" />}
          title="Recipe not found"
          message={loadError}
        />
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  return (
    <div className="anim-page-enter mx-auto max-w-3xl space-y-6 p-4 pb-24">
      <div className="mb-2">
        <h1 className="t-page-title">{recipe.title}</h1>
        {recipe.cuisine && (
          <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
            {recipe.cuisine}
          </p>
        )}
      </div>

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

      {/* allergy check FIRST — before any food is presented */}
      {allergenHitsAll.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border p-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--error) 60%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
            color: 'var(--text)',
          }}
        >
          <p className="t-body flex items-center gap-2 font-bold">
            <AlertTriangle size={18} aria-hidden="true" style={{ color: 'var(--error)' }} />
            Contains your allergen{allergenHitsAll.length > 1 ? 's' : ''}: {allergenHitsAll.join(', ')}
          </p>
          <p className="t-body mt-1">
            This recipe is shown as-is — nothing has been substituted. Please choose a different
            recipe if this isn&apos;t safe for you.
          </p>
        </div>
      )}

      <GlassPanel className="p-6">
        <div className="flex flex-wrap gap-1">
          {recipe.verified ? (
            <LuxBadge tone="success">Verified</LuxBadge>
          ) : recipe.source === 'curated' ? (
            <LuxBadge>Curated</LuxBadge>
          ) : null}
          {isAi && <LuxBadge tone="accent">AI-generated</LuxBadge>}
          {recipe.dietCategory === 'vegetarian' && <LuxBadge tone="success">Vegetarian</LuxBadge>}
          {recipe.dietCategory === 'non_vegetarian' && <LuxBadge>Non-vegetarian</LuxBadge>}
          {recipe.difficulty && <LuxBadge>{recipe.difficulty}</LuxBadge>}
        </div>

        {recipe.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="mt-3 max-h-72 w-full rounded-2xl object-cover"
            style={{ border: '1px solid var(--border)' }}
          />
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Per serving" value={<span className="t-numeral">{Math.round(recipe.perServing.kcal)} kcal</span>} subtext={isAi ? 'estimate' : undefined} />
          <MetricCard label="Prep" value={<span className="t-numeral">{recipe.prepMin} min</span>} />
          <MetricCard label="Cook" value={<span className="t-numeral">{recipe.cookMin} min</span>} />
          <GlassPanel className="p-5">
            <p className="t-meta">Servings</p>
            <Input
              id="servings"
              type="number"
              min={0.25}
              step={0.25}
              aria-label="Servings"
              value={String(servings)}
              onChange={(e) => setServings(Math.max(0.25, num(e.target.value, 1)))}
              className="mt-2 min-h-[44px] w-24"
            />
          </GlassPanel>
        </div>

        {scaled && (
          <div
            className="mt-4 rounded-xl border p-4"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="t-body font-semibold">
              Nutrition for <span className="t-numeral">{round1(Math.max(0.25, servings))}</span> serving{servings === 1 ? '' : 's'}
              {isAi && <span className="t-meta"> — AI estimates</span>}
            </p>
            <p className="t-body mt-1">
              <span className="t-numeral">{Math.round(scaled.kcal)}</span> kcal · Protein{' '}
              <span className="t-numeral">{round1(scaled.proteinG)}</span> g · Carbs{' '}
              <span className="t-numeral">{round1(scaled.carbsG)}</span> g · Fat{' '}
              <span className="t-numeral">{round1(scaled.fatG)}</span> g · Fiber{' '}
              <span className="t-numeral">{round1(scaled.fiberG)}</span> g
            </p>
          </div>
        )}

        {recipe.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {recipe.tags.map((t) => (
              <LuxBadge key={t}>{t}</LuxBadge>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <LuxButton
            variant="secondary"
            disabled={favBusy}
            onClick={() => void toggleFavorite()}
            aria-pressed={favorited}
            aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
          >
            {favBusy ? (
              '…'
            ) : favorited ? (
              <>
                <Star size={16} aria-hidden="true" style={{ color: 'var(--accent)', fill: 'var(--accent)' }} />
                Favorited
              </>
            ) : (
              <>
                <Heart size={16} aria-hidden="true" />
                Favorite
              </>
            )}
          </LuxButton>
          <LuxButton onClick={() => { setLogDone(false); setLogOpen(true); }}>
            Log to diary
          </LuxButton>
          <LuxButton variant="secondary" onClick={() => setShopOpen(true)}>
            <ShoppingCart size={16} aria-hidden="true" />
            Shopping list
          </LuxButton>
          <LuxButton variant="secondary" onClick={() => void openPlanPicker()}>
            Add to meal plan
          </LuxButton>
        </div>
      </GlassPanel>

      {/* ------- ingredients ------- */}
      <GlassPanel className="p-6">
        <h2 className="t-card-heading">Ingredients</h2>
        {recipe.ingredients.length === 0 ? (
          <p className="t-body mt-2" style={{ color: 'var(--text-secondary)' }}>
            No ingredient list provided.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recipe.ingredients.map((ing, i) => {
              const hit = allergenHits([ing.name], allergies);
              return (
                <li key={i} className="t-body flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium">{ing.name}</span>
                    {ing.quantity && <span style={{ color: 'var(--text-secondary)' }}> — {ing.quantity}</span>}
                    {ing.grams != null && (
                      <span className="t-meta block">
                        ≈ <span className="t-numeral">{Math.round(ing.grams * factor)}</span> g for{' '}
                        <span className="t-numeral">{round1(Math.max(0.25, servings))}</span> servings
                      </span>
                    )}
                    {hit.length > 0 && (
                      <span className="mt-1 block">
                        <LuxBadge tone="error">Your allergen: {hit.join(', ')}</LuxBadge>
                      </span>
                    )}
                    {ing.substitutions && ing.substitutions.length > 0 && (
                      <span className="t-meta block">
                        Swap: {ing.substitutions.join('; ')}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </GlassPanel>

      {/* ------- instructions ------- */}
      <GlassPanel className="p-6">
        <h2 className="t-card-heading flex items-center gap-2">
          <BookOpen size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
          Instructions
        </h2>
        {recipe.instructions.length === 0 ? (
          <p className="t-body mt-2" style={{ color: 'var(--text-secondary)' }}>
            No instructions provided.
          </p>
        ) : (
          <ol className="t-body mt-2 list-decimal space-y-2 pl-5">
            {recipe.instructions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
      </GlassPanel>

      {/* ------- substitutions / storage (only when provided) ------- */}
      {recipe.substitutions && (
        <GlassPanel className="p-6">
          <h2 className="t-card-heading">Substitutions</h2>
          {Array.isArray(recipe.substitutions) ? (
            <ul className="t-body mt-2 list-disc pl-5">
              {recipe.substitutions.map((s, i) => (
                <li key={i}>{String(s)}</li>
              ))}
            </ul>
          ) : (
            <ul className="t-body mt-2 list-disc pl-5">
              {Object.entries(recipe.substitutions).map(([k, v]) => (
                <li key={k}>
                  Instead of {k}: {String(v)}
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      )}

      {(recipe.storage || recipe.reheating) && (
        <GlassPanel className="p-6">
          <h2 className="t-card-heading">Storage & reheating</h2>
          {recipe.storage && <p className="t-body mt-2"><strong>Storage:</strong> {recipe.storage}</p>}
          {recipe.reheating && <p className="t-body mt-1"><strong>Reheating:</strong> {recipe.reheating}</p>}
        </GlassPanel>
      )}

      {/* ------- log modal (existing Modal — focus behavior preserved) ------- */}
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title={`Log “${recipe.title}”`}>
        {logDone ? (
          <div role="status" className="space-y-3">
            <p className="t-body">
              Logged for {formatDayLabel(logDate)} · {mealLabel(logMeal)}.
            </p>
            <LuxButton onClick={() => setLogOpen(false)}>
              <Check size={16} aria-hidden="true" />
              Done
            </LuxButton>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
              <span className="t-numeral">{round1(Math.max(0.25, servings))}</span> serving{servings === 1 ? '' : 's'} ·{' '}
              <span className="t-numeral">{scaled ? Math.round(scaled.kcal) : 0}</span> kcal{isAi ? ' (estimate)' : ''}.
            </p>
            {allergenHitsAll.length > 0 && (
              <div
                role="alert"
                className="rounded-xl border p-2 text-xs"
                style={{
                  borderColor: 'color-mix(in srgb, var(--error) 45%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
                  color: 'var(--text)',
                }}
              >
                Contains your allergen{allergenHitsAll.length > 1 ? 's' : ''}: {allergenHitsAll.join(', ')}.
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="log-date" className="t-body block font-medium">
                  Date
                </label>
                <Input
                  id="log-date"
                  type="date"
                  value={logDate}
                  max={todayYMD()}
                  onChange={(e) => e.target.value && setLogDate(e.target.value)}
                  className="min-h-[44px]"
                />
              </div>
              <div>
                <label htmlFor="log-meal" className="t-body block font-medium">
                  Meal
                </label>
                <Select
                  id="log-meal"
                  value={logMeal}
                  onChange={(e) => setLogMeal(e.target.value as MealType)}
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
            <LuxButton
              className="w-full"
              disabled={logBusy}
              onClick={() => void handleLog()}
            >
              {logBusy ? 'Logging…' : 'Log to diary'}
            </LuxButton>
          </div>
        )}
      </Modal>

      {/* ------- shopping list modal ------- */}
      <Modal open={shopOpen} onClose={() => setShopOpen(false)} title="Shopping list">
        <p className="t-meta">
          Quantities follow your serving choice above. Merge this into your week&apos;s list on the
          meal-plan page.
        </p>
        <pre
          className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border p-3 text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text)' }}
        >
          {shoppingText}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <LuxButton variant="secondary" onClick={() => void copyShopping()}>
            <Copy size={16} aria-hidden="true" />
            {copied ? 'Copied' : 'Copy list'}
          </LuxButton>
          <LuxButton variant="secondary" onClick={downloadShopping}>
            <Download size={16} aria-hidden="true" />
            Download .txt
          </LuxButton>
        </div>
      </Modal>

      {/* ------- add-to-plan modal ------- */}
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title="Add to meal plan">
        {planDone ? (
          <div role="status" className="space-y-3">
            <p className="t-body">
              Added to your plan (saved on this device — see it on the meal-plan page).
            </p>
            <LuxButton onClick={() => setPlanOpen(false)}>
              <Check size={16} aria-hidden="true" />
              Done
            </LuxButton>
          </div>
        ) : planOptions === null ? (
          <Skeleton className="h-16 w-full" />
        ) : planOptions.length === 0 ? (
          <div className="space-y-3">
            <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
              You don&apos;t have a meal plan yet. Generate one first, then add this recipe to any day.
            </p>
            <LuxButton
              onClick={() => {
                window.location.href = '/nutrition/plans';
              }}
            >
              Go to meal plans
            </LuxButton>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="plan-choice" className="t-body block font-medium">
                Plan
              </label>
              <Select
                id="plan-choice"
                value={planChoice}
                onChange={(e) => setPlanChoice(e.target.value)}
                className="min-h-[44px]"
              >
                {planOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="plan-day" className="t-body block font-medium">
                  Day
                </label>
                <Select
                  id="plan-day"
                  value={String(planDay)}
                  onChange={(e) => setPlanDay(num(e.target.value, 0))}
                  className="min-h-[44px]"
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                    <option key={d} value={d}>
                      Day {d + 1}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="plan-meal" className="t-body block font-medium">
                  Meal slot
                </label>
                <Select
                  id="plan-meal"
                  value={planMealType}
                  onChange={(e) => setPlanMealType(e.target.value as MealType)}
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
            {allergenHitsAll.length > 0 && (
              <div
                role="alert"
                className="rounded-xl border p-2 text-xs"
                style={{
                  borderColor: 'color-mix(in srgb, var(--error) 45%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
                  color: 'var(--text)',
                }}
              >
                Contains your allergen{allergenHitsAll.length > 1 ? 's' : ''}: {allergenHitsAll.join(', ')}.
              </div>
            )}
            <LuxButton className="w-full" onClick={addToPlan}>
              Add to plan
            </LuxButton>
          </div>
        )}
      </Modal>

      <p className="t-meta flex items-center gap-1.5">
        <Clock size={13} aria-hidden="true" />
        Prep and cook times are as published by the recipe source.
      </p>
    </div>
  );
}
