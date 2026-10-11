'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import {
  ArrowLeftRight,
  CalendarDays,
  Check,
  Info,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  UtensilsCrossed,
} from 'lucide-react';
import { Input, Select, Skeleton } from '@/components/ui';
import {
  EmptyStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
  MetricCard,
} from '@/components/luxury';
import {
  scaleNutrients,
  sumNutrients,
  roundNutrients,
  swapMealsBetweenDays,
  consolidateShoppingList,
} from '@fitfusion/core';
import type { MealType, Nutrients, PlannedMeal, ShoppingItem } from '@fitfusion/core';
import {
  addDaysYMD,
  allergenHits,
  formatDayLabel,
  formatWeekdayLong,
  mealLabel,
  num,
  parseYMD,
  round1,
  toYMD,
  unwrapList,
  unwrapObject,
  type ProfileLike,
} from '../_shared';

/* ---------- shapes ---------- */

interface PlanIngredient {
  name: string;
  quantity: string;
  grams?: number;
}

interface PlannedMealView {
  id: string;
  name: string;
  mealType: MealType | string;
  ingredients: PlanIngredient[];
  nutrients: Nutrients;
  prepMin: number;
  cookMin: number;
  instructions: string[];
  tags: string[];
  cuisine?: string;
  dietCategory: string;
  labels: string[];
  servings: number;
  scaledNutrients: Nutrients;
  imageUrl?: string;
  substitutions?: string[] | Record<string, string> | null;
  addedByYou?: boolean;
}

interface DayPlanView {
  dayIndex: number;
  meals: PlannedMealView[];
  totals: Nutrients;
}

interface MealPlanView {
  id: string;
  weekStart: string;
  days: DayPlanView[];
  calorieTarget: number;
  generatedBy: 'template' | 'ai';
  status: string;
  createdAt?: string;
}

function normalizeMeal(m: Record<string, unknown>, fallbackId: string): PlannedMealView {
  // Contract: PlannedMeal.nutrients is per 1 serving; scaledNutrients matches servings.
  const nutrients: Nutrients = {
    kcal: num(m.kcal ?? (m.nutrients as Record<string, unknown> | undefined)?.kcal),
    proteinG: num(m.proteinG ?? (m.nutrients as Record<string, unknown> | undefined)?.proteinG),
    carbsG: num(m.carbsG ?? (m.nutrients as Record<string, unknown> | undefined)?.carbsG),
    fatG: num(m.fatG ?? (m.nutrients as Record<string, unknown> | undefined)?.fatG),
    fiberG: num(m.fiberG ?? (m.nutrients as Record<string, unknown> | undefined)?.fiberG),
  };
  const servings = num(m.servings, 1) || 1;
  const serverScaled = m.scaledNutrients as Record<string, unknown> | undefined;
  const scaledNutrients: Nutrients =
    serverScaled && Number.isFinite(num(serverScaled.kcal))
      ? {
          kcal: num(serverScaled.kcal),
          proteinG: num(serverScaled.proteinG),
          carbsG: num(serverScaled.carbsG),
          fatG: num(serverScaled.fatG),
          fiberG: num(serverScaled.fiberG),
        }
      : scaleNutrients(nutrients, 1, servings);
  const rawIngredients = Array.isArray(m.ingredients) ? (m.ingredients as unknown[]) : [];
  const ingredients: PlanIngredient[] = rawIngredients.map((i) => {
    if (typeof i === 'string') return { name: i, quantity: '' };
    const o = i as Record<string, unknown>;
    return {
      name: String(o.name ?? ''),
      quantity: String(o.quantity ?? ''),
      grams: o.grams != null ? num(o.grams) : undefined,
    };
  });
  return {
    id: String(m.id ?? fallbackId),
    name: String(m.name ?? 'Meal'),
    mealType: String(m.mealType ?? 'extra'),
    ingredients,
    nutrients,
    prepMin: num(m.prepMin),
    cookMin: num(m.cookMin),
    instructions: Array.isArray(m.instructions) ? (m.instructions as unknown[]).map(String) : [],
    tags: Array.isArray(m.tags) ? (m.tags as unknown[]).map(String) : [],
    cuisine: typeof m.cuisine === 'string' ? m.cuisine : undefined,
    dietCategory: String(m.dietCategory ?? ''),
    labels: Array.isArray(m.labels) ? (m.labels as unknown[]).map(String) : [],
    servings,
    scaledNutrients,
    imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl : undefined,
    substitutions: (m.substitutions as PlannedMealView['substitutions']) ?? null,
  };
}

function normalizePlan(p: Record<string, unknown>): MealPlanView {
  let daysRaw: unknown = p.days;
  if (typeof daysRaw === 'string') {
    try {
      daysRaw = JSON.parse(daysRaw);
    } catch {
      daysRaw = [];
    }
  }
  const days: DayPlanView[] = (Array.isArray(daysRaw) ? daysRaw : []).map((d, di) => {
    const day = d as Record<string, unknown>;
    const meals = (Array.isArray(day.meals) ? day.meals : []).map((m, mi) =>
      normalizeMeal(m as Record<string, unknown>, `${di}-${mi}`),
    );
    return {
      dayIndex: num(day.dayIndex, di),
      meals,
      totals: roundNutrients(sumNutrients(meals.map((m) => m.scaledNutrients))),
    };
  });
  return {
    id: String(p.id ?? ''),
    weekStart: typeof p.weekStart === 'string' ? p.weekStart.slice(0, 10) : toYMD(new Date()),
    days,
    calorieTarget: num(p.calorieTarget),
    generatedBy: p.generatedBy === 'ai' ? 'ai' : 'template',
    status: String(p.status ?? 'active'),
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : undefined,
  };
}

function mondayOfWeek(ymd: string): string {
  const d = parseYMD(ymd);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return toYMD(d);
}

function dayDate(weekStart: string, dayIndex: number): string {
  return addDaysYMD(weekStart, dayIndex);
}

const ADDITIONS_KEY = (planId: string) => `fitfusion.planAdditions.${planId}`;
const ADHERENCE_KEY = 'fitfusion.adherence';

interface PlanAddition {
  dayIndex: number;
  meal: Record<string, unknown>;
}

function readAdditions(planId: string): PlanAddition[] {
  try {
    const raw = localStorage.getItem(ADDITIONS_KEY(planId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PlanAddition[]) : [];
  } catch {
    return [];
  }
}

function readAdherence(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ADHERENCE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export default function MealPlansPage() {
  const [plans, setPlans] = useState<MealPlanView[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [view, setView] = useState<'plan' | 'shopping'>('plan');
  const [error, setError] = useState<string | null>(null);

  const [weekStart, setWeekStart] = useState(mondayOfWeek(toYMD(new Date())));
  const [useAI, setUseAI] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiChecked, setAiChecked] = useState(false);
  const [aiChatConfigured, setAiChatConfigured] = useState(false);

  const [shoppingGroups, setShoppingGroups] = useState<Record<string, ShoppingItem[]> | null>(null);
  const [shoppingLoading, setShoppingLoading] = useState(false);

  const [allergies, setAllergies] = useState<string[]>([]);
  const [swapMode, setSwapMode] = useState(false);
  const [swapPick, setSwapPick] = useState<{ day: number; index: number } | null>(null);
  const [adherence, setAdherence] = useState<Record<string, boolean>>({});
  const [additions, setAdditions] = useState<PlanAddition[]>([]);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  /* ---------------- load ---------------- */

  const loadPlans = useCallback(async () => {
    setPlans(null);
    setError(null);
    try {
      const data = await api<unknown>('/api/meals/plans');
      const list = unwrapList<Record<string, unknown>>(data, 'plans').map(normalizePlan);
      // Some implementations may return a single {plan}
      const single = unwrapObject<Record<string, unknown>>(data, 'plan');
      const all = single && single.id ? [normalizePlan(single), ...list.filter((p) => p.id !== String(single.id))] : list;
      setPlans(all);
      if (all.length > 0 && !planId) {
        setPlanId(all[0].id);
        setAdditions(readAdditions(all[0].id));
      }
    } catch (e) {
      setPlans([]);
      setError(e instanceof ApiError ? e.message : 'Could not load meal plans.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAi = useCallback(async () => {
    try {
      const cfg = await api<unknown>('/api/config');
      const ai = unwrapObject<Record<string, unknown>>(cfg, 'ai') ?? (cfg as Record<string, unknown>)?.ai;
      const chat = (ai as Record<string, unknown> | undefined)?.chat;
      setAiChatConfigured(
        chat != null && typeof chat === 'object' ? Boolean((chat as Record<string, unknown>).configured) : Boolean(chat),
      );
    } catch {
      setAiChatConfigured(false);
    } finally {
      setAiChecked(true);
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

  useEffect(() => {
    void loadPlans();
    void checkAi();
    void loadAllergies();
    setAdherence(readAdherence());
  }, [loadPlans, checkAi, loadAllergies]);

  const plan = useMemo(() => plans?.find((p) => p.id === planId) ?? null, [plans, planId]);

  /* merge recipe-page additions (stored on this device) */
  const daysWithAdditions = useMemo(() => {
    if (!plan) return [];
    return plan.days.map((d) => {
      const extra = additions
        .filter((a) => a.dayIndex === d.dayIndex)
        .map((a, i) => ({ ...normalizeMeal(a.meal, `added-${d.dayIndex}-${i}`), addedByYou: true }));
      const meals = [...d.meals, ...extra];
      return { ...d, meals, totals: roundNutrients(sumNutrients(meals.map((m) => m.scaledNutrients))) };
    });
  }, [plan, additions]);

  const activeDayPlan =
    daysWithAdditions.find((d) => d.dayIndex === activeDay) ?? daysWithAdditions[0] ?? null;
  const rawActiveDay = plan?.days.find((d) => d.dayIndex === activeDayPlan?.dayIndex) ?? null;
  const isAi = plan?.generatedBy === 'ai';

  /* ---------------- actions ---------------- */

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const data = await api<unknown>('/api/meals/plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { weekStart, useAI },
      });
      const created =
        unwrapObject<Record<string, unknown>>(data, 'plan') ??
        (data as Record<string, unknown>);
      const normalized = normalizePlan(created.id ? created : (created as Record<string, unknown>));
      setPlans((prev) => [normalized, ...(prev ?? []).filter((p) => p.id !== normalized.id)]);
      setPlanId(normalized.id);
      setActiveDay(0);
      setView('plan');
      setAdditions(readAdditions(normalized.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not generate a meal plan.');
    } finally {
      setGenerating(false);
    }
  }

  function patchPlan(mutator: (p: MealPlanView) => MealPlanView) {
    setPlans((prev) => (prev ?? []).map((p) => (p.id === planId ? mutator(p) : p)));
  }

  function handleServings(dayIndex: number, mealId: string, servings: number) {
    const s = Math.min(8, Math.max(0.25, servings));
    patchPlan((p) => ({
      ...p,
      days: p.days.map((d) => {
        if (d.dayIndex !== dayIndex) return d;
        const meals = d.meals.map((m) =>
          m.id === mealId ? { ...m, servings: s, scaledNutrients: scaleNutrients(m.nutrients, 1, s) } : m,
        );
        return {
          ...d,
          meals,
          totals: roundNutrients(sumNutrients(meals.map((m) => m.scaledNutrients))),
        };
      }),
    }));
  }

  async function handleRegenerateMeal(dayIndex: number, mealType: string) {
    if (!plan) return;
    const key = `${dayIndex}:${mealType}`;
    setRegenerating(key);
    setError(null);
    try {
      const data = await api<unknown>(`/api/meals/plans/${plan.id}/regenerate-meal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { dayIndex, mealType },
      });
      const updated = unwrapObject<Record<string, unknown>>(data, 'plan');
      const updatedDay = unwrapObject<Record<string, unknown>>(data, 'day');
      if (updated && updated.id) {
        const normalized = normalizePlan(updated);
        setPlans((prev) => (prev ?? []).map((p) => (p.id === plan.id ? normalized : p)));
      } else if (updatedDay) {
        const meals = (Array.isArray(updatedDay.meals) ? updatedDay.meals : []).map((m, mi) =>
          normalizeMeal(m as Record<string, unknown>, `${dayIndex}-${mi}`),
        );
        patchPlan((p) => ({
          ...p,
          days: p.days.map((d) =>
            d.dayIndex === dayIndex
              ? { ...d, meals, totals: roundNutrients(sumNutrients(meals.map((m) => m.scaledNutrients))) }
              : d,
          ),
        }));
      } else {
        await loadPlans();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not regenerate that meal.');
    } finally {
      setRegenerating(null);
    }
  }

  function handleSwapPick(dayIndex: number, mealPos: number) {
    if (!swapPick) {
      setSwapPick({ day: dayIndex, index: mealPos });
      return;
    }
    if (swapPick.day === dayIndex && swapPick.index === mealPos) {
      setSwapPick(null);
      return;
    }
    try {
      patchPlan((p) => {
        const posOf = (di: number) => p.days.findIndex((d) => d.dayIndex === di);
        const a = posOf(swapPick.day);
        const b = posOf(dayIndex);
        if (a < 0 || b < 0) return p;
        // Core swap works on array positions; meals keep their identity via spread clone.
        const coreDays = p.days.map((d) => ({
          dayIndex: d.dayIndex,
          targetKcal: p.calorieTarget,
          meals: d.meals as unknown as PlannedMeal[],
          totals: d.totals,
        }));
        const swapped = swapMealsBetweenDays(coreDays, a, swapPick.index, b, mealPos);
        const byId = new Map<string, PlannedMealView>();
        p.days.forEach((d) => d.meals.forEach((m) => byId.set(m.id, m)));
        const days = p.days.map((d, di) => {
          const order = (swapped[di]?.meals ?? []).map((sm) => (sm as unknown as { id: string }).id);
          const meals = order
            .map((id) => byId.get(id))
            .filter((m): m is PlannedMealView => Boolean(m));
          const finalMeals = meals.length === d.meals.length ? meals : d.meals;
          return {
            ...d,
            meals: finalMeals,
            totals: roundNutrients(sumNutrients(finalMeals.map((m) => m.scaledNutrients))),
          };
        });
        return { ...p, days };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not swap those meals.');
    }
    setSwapPick(null);
  }

  async function loadShopping() {
    if (!plan) return;
    setShoppingLoading(true);
    setShoppingGroups(null);
    try {
      const data = await api<unknown>(`/api/meals/shopping-list?planId=${encodeURIComponent(plan.id)}`);
      const asRecord = unwrapObject<Record<string, ShoppingItem[]>>(data, 'groups');
      if (asRecord && !Array.isArray(asRecord) && Object.keys(asRecord).length > 0) {
        // Heuristic: a grouped record maps category -> items[]
        const looksGrouped = Object.values(asRecord).every((v) => Array.isArray(v));
        if (looksGrouped) {
          setShoppingGroups(asRecord as Record<string, ShoppingItem[]>);
          return;
        }
      }
      const items = unwrapList<ShoppingItem>(data, 'items');
      setShoppingGroups(consolidateShoppingList(items));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the shopping list.');
      setShoppingGroups({});
    } finally {
      setShoppingLoading(false);
    }
  }

  useEffect(() => {
    if (view === 'shopping' && plan) void loadShopping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, planId]);

  function toggleAdherence(dayIndex: number, mealId: string) {
    if (!plan) return;
    const key = `${plan.id}:${dayIndex}:${mealId}`;
    setAdherence((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(ADHERENCE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }

  const adherenceForDay = (dayIndex: number, meals: PlannedMealView[]) => {
    if (!plan) return { done: 0, total: meals.length };
    const done = meals.filter((m) => adherence[`${plan.id}:${dayIndex}:${m.id}`]).length;
    return { done, total: meals.length };
  };

  /* ---------------- render ---------------- */

  return (
    <div className="anim-page-enter mx-auto max-w-4xl space-y-6 p-4 pb-24">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">Meal plans</h1>
          <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
            A week of eating, planned around your targets
          </p>
        </div>
        {plans && plans.length > 1 ? (
          <Select
            aria-label="Choose meal plan"
            value={planId ?? ''}
            onChange={(e) => {
              setPlanId(e.target.value);
              setActiveDay(0);
              setView('plan');
              setAdditions(readAdditions(e.target.value));
            }}
            className="min-h-[44px]"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                Week of {formatDayLabel(p.weekStart)} ({p.generatedBy})
              </option>
            ))}
          </Select>
        ) : undefined}
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

      {/* ------- generate card ------- */}
      <GlassPanel className="p-6">
        <h2 className="t-card-heading flex items-center gap-2">
          <CalendarDays size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
          Generate a 7-day plan
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="weekStart" className="t-body block font-medium">
              Week starting
            </label>
            <Input
              id="weekStart"
              type="date"
              value={weekStart}
              onChange={(e) => e.target.value && setWeekStart(mondayOfWeek(e.target.value))}
              className="min-h-[44px]"
            />
            <p className="t-meta">Snaps to Monday.</p>
          </div>
          <div role="radiogroup" aria-label="Plan type" className="flex gap-2">
            <LuxButton
              role="radio"
              aria-checked={!useAI}
              variant={!useAI ? 'primary' : 'secondary'}
              onClick={() => setUseAI(false)}
            >
              {!useAI && <Check size={16} aria-hidden="true" />}
              Template
            </LuxButton>
            <LuxButton
              role="radio"
              aria-checked={useAI}
              variant={useAI ? 'primary' : 'secondary'}
              onClick={() => setUseAI(true)}
            >
              <Sparkles size={16} aria-hidden="true" />
              AI
              {useAI && <Check size={16} aria-hidden="true" />}
            </LuxButton>
          </div>
          <LuxButton
            disabled={generating || (useAI && aiChecked && !aiChatConfigured)}
            onClick={() => void handleGenerate()}
          >
            {generating ? 'Generating…' : 'Generate plan'}
          </LuxButton>
        </div>

        {useAI && aiChecked && !aiChatConfigured && (
          <div
            role="status"
            className="mt-4 rounded-xl border p-4"
            style={{
              borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
            }}
          >
            <p className="t-body font-semibold">AI meal plans aren&apos;t set up yet</p>
            <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
              Template plans work right now with no setup. To enable AI-generated plans, add your AI
              provider key — see the project README (&ldquo;AI setup&rdquo;) for instructions, then
              come back here.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <LuxButton variant="secondary" onClick={() => setUseAI(false)}>
                Use template instead
              </LuxButton>
            </div>
          </div>
        )}
        {useAI && aiChecked && aiChatConfigured && (
          <p className="t-meta mt-3 flex items-center gap-1.5">
            <Info size={13} aria-hidden="true" />
            AI-generated nutrition values are estimates, not exact measurements.
          </p>
        )}
      </GlassPanel>

      {plans === null ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : !plan ? (
        <EmptyStateLux
          icon={<UtensilsCrossed size={22} aria-hidden="true" />}
          title="No meal plan yet"
          message="Generate your first 7-day plan above — template plans respect your diet preference and allergies."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Plan views">
            <LuxButton
              role="tab"
              aria-selected={view === 'plan'}
              variant={view === 'plan' ? 'primary' : 'secondary'}
              onClick={() => setView('plan')}
            >
              Week plan
            </LuxButton>
            <LuxButton
              role="tab"
              aria-selected={view === 'shopping'}
              variant={view === 'shopping' ? 'primary' : 'secondary'}
              onClick={() => setView('shopping')}
            >
              <ShoppingCart size={16} aria-hidden="true" />
              Shopping list
            </LuxButton>
            <div className="ml-auto flex items-center gap-2">
              <LuxBadge tone={isAi ? 'accent' : 'success'}>{isAi ? 'AI-generated' : 'Template'}</LuxBadge>
              {plan.calorieTarget > 0 && (
                <span className="t-meta">
                  Daily target: <span className="t-numeral">{plan.calorieTarget}</span> kcal
                </span>
              )}
            </div>
          </div>

          {view === 'shopping' ? (
            <GlassPanel className="p-6" role="tabpanel">
              <h2 className="t-card-heading">Shopping list</h2>
              <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
                Quantities are estimates based on the planned servings.
              </p>
              {shoppingLoading || shoppingGroups === null ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-6 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : Object.keys(shoppingGroups).length === 0 ? (
                <EmptyStateLux title="Nothing to buy" message="This plan has no listed ingredients." />
              ) : (
                <div className="mt-4 space-y-4">
                  {Object.entries(shoppingGroups).map(([category, items]) => (
                    <div key={category}>
                      <h3 className="t-meta uppercase">{category}</h3>
                      <ul className="mt-1 divide-y" style={{ borderColor: 'var(--border)' }}>
                        {items.map((it, i) => (
                          <li key={`${it.name}-${i}`} className="flex justify-between gap-2 py-1.5 text-sm">
                            <span className="t-body">{it.name}</span>
                            <span className="t-body" style={{ color: 'var(--text-secondary)' }}>{it.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>
          ) : (
            <div role="tabpanel" className="space-y-4">
              {/* day tabs */}
              <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Days">
                {daysWithAdditions.map((d) => {
                  const dd = dayDate(plan.weekStart, d.dayIndex);
                  const { done, total } = adherenceForDay(d.dayIndex, d.meals);
                  const selected = (activeDayPlan?.dayIndex ?? 0) === d.dayIndex;
                  return (
                    <LuxButton
                      key={d.dayIndex}
                      role="tab"
                      aria-selected={selected}
                      variant={selected ? 'primary' : 'secondary'}
                      className="min-w-[44px] flex-col px-3"
                      onClick={() => setActiveDay(d.dayIndex)}
                      aria-label={`${formatWeekdayLong(dd)}, ${formatDayLabel(dd)}, ${done} of ${total} meals done`}
                    >
                      <span className="text-xs">{formatWeekdayLong(dd).slice(0, 3)}</span>
                      <span className="t-meta">
                        <span className="t-numeral">{done}</span>/<span className="t-numeral">{total}</span>
                      </span>
                    </LuxButton>
                  );
                })}
              </div>

              {swapMode && (
                <div
                  role="status"
                  className="rounded-xl border p-3 text-sm"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                    color: 'var(--text)',
                  }}
                >
                  Rearrange mode: tap one meal, then another (any day), to swap them. This preview is
                  kept on this device and isn&apos;t saved to the server.
                  {swapPick && <span className="font-semibold"> First meal selected — pick the second.</span>}
                </div>
              )}

              {activeDayPlan && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="t-page-title text-xl">
                      {formatWeekdayLong(dayDate(plan.weekStart, activeDayPlan.dayIndex))}{' '}
                      <span className="t-body font-normal" style={{ color: 'var(--text-secondary)' }}>
                        {formatDayLabel(dayDate(plan.weekStart, activeDayPlan.dayIndex))}
                      </span>
                    </h2>
                    <LuxButton
                      variant="secondary"
                      aria-pressed={swapMode}
                      onClick={() => {
                        setSwapMode((s) => !s);
                        setSwapPick(null);
                      }}
                    >
                      <ArrowLeftRight size={16} aria-hidden="true" />
                      {swapMode ? 'Done rearranging' : 'Rearrange meals'}
                    </LuxButton>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricCard label="Day total" value={<span className="t-numeral">{Math.round(activeDayPlan.totals.kcal)} kcal</span>} subtext={isAi ? 'estimate' : undefined} />
                    <MetricCard label="Protein" value={<span className="t-numeral">{Math.round(activeDayPlan.totals.proteinG)} g</span>} subtext={isAi ? 'estimate' : undefined} />
                    <MetricCard label="Target" value={<span className="t-numeral">{plan.calorieTarget} kcal</span>} />
                  </div>

                  {activeDayPlan.meals.map((m) => {
                    const hits = allergenHits(m.ingredients.map((i) => i.name), allergies);
                    const checked = adherence[`${plan.id}:${activeDayPlan.dayIndex}:${m.id}`] ?? false;
                    // Swap positions refer to the stored plan days (recipe additions are
                    // device-local and can't be swapped server-side).
                    const rawIndex = rawActiveDay
                      ? rawActiveDay.meals.findIndex((rm) => rm.id === m.id)
                      : -1;
                    const picked =
                      swapPick?.day === activeDayPlan.dayIndex && swapPick?.index === rawIndex;
                    return (
                      <GlassPanel
                        key={m.id}
                        className="p-5"
                        style={picked ? { border: '1px solid var(--accent)' } : undefined}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="t-meta uppercase">{mealLabel(String(m.mealType))}</p>
                            <h3 className="t-card-heading mt-1">{m.name}</h3>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {m.dietCategory === 'vegetarian' && <LuxBadge tone="success">Vegetarian</LuxBadge>}
                              {m.cuisine && <LuxBadge>{m.cuisine}</LuxBadge>}
                              {m.labels.slice(0, 4).map((l) => (
                                <LuxBadge key={l}>{l}</LuxBadge>
                              ))}
                              {isAi && <LuxBadge tone="accent">AI estimate</LuxBadge>}
                              {m.addedByYou && <LuxBadge tone="accent">Added by you</LuxBadge>}
                            </div>
                            {hits.length > 0 && (
                              <div
                                role="alert"
                                className="mt-2 rounded-xl border p-2 text-xs"
                                style={{
                                  borderColor: 'color-mix(in srgb, var(--error) 45%, transparent)',
                                  backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
                                  color: 'var(--text)',
                                }}
                              >
                                Contains your allergen{hits.length > 1 ? 's' : ''}: {hits.join(', ')}.
                                Nothing is substituted — skip or replace this meal if it isn&apos;t safe for you.
                              </div>
                            )}
                          </div>
                          {m.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.imageUrl} alt="" className="h-20 w-20 rounded-lg object-cover" />
                          )}
                        </div>

                        <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                          <span className="t-body">
                            <strong className="t-numeral">{Math.round(m.scaledNutrients.kcal)} kcal</strong>
                            {isAi && <span className="t-meta"> (estimate)</span>}
                          </span>
                          <span className="t-body" style={{ color: 'var(--text-secondary)' }}>
                            P <span className="t-numeral">{round1(m.scaledNutrients.proteinG)}</span>g · C{' '}
                            <span className="t-numeral">{round1(m.scaledNutrients.carbsG)}</span>g · F{' '}
                            <span className="t-numeral">{round1(m.scaledNutrients.fatG)}</span>g · Fiber{' '}
                            <span className="t-numeral">{round1(m.scaledNutrients.fiberG)}</span>g
                          </span>
                          <span className="t-body" style={{ color: 'var(--text-secondary)' }}>
                            Prep <span className="t-numeral">{m.prepMin}</span> min · Cook{' '}
                            <span className="t-numeral">{m.cookMin}</span> min
                          </span>
                          <span className="flex items-center gap-2">
                            <label htmlFor={`srv-${m.id}`} className="t-body" style={{ color: 'var(--text-secondary)' }}>
                              Servings
                            </label>
                            <Input
                              id={`srv-${m.id}`}
                              type="number"
                              min={0.25}
                              max={8}
                              step={0.25}
                              value={String(m.servings)}
                              onChange={(e) => handleServings(activeDayPlan.dayIndex, m.id, num(e.target.value, 1))}
                              className="min-h-[44px] w-20"
                            />
                          </span>
                        </div>

                        {m.ingredients.length > 0 && (
                          <div className="mt-3">
                            <h4 className="t-body font-semibold">Ingredients</h4>
                            <ul className="t-body mt-1 list-disc space-y-0.5 pl-5">
                              {m.ingredients.map((ing, i) => (
                                <li key={i}>
                                  {ing.name}
                                  {ing.quantity ? <span style={{ color: 'var(--text-secondary)' }}> — {ing.quantity}</span> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {m.instructions.length > 0 && (
                          <div className="mt-3">
                            <h4 className="t-body font-semibold">Instructions</h4>
                            <ol className="t-body mt-1 list-decimal space-y-1 pl-5">
                              {m.instructions.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {m.substitutions && (
                          <div className="mt-3">
                            <h4 className="t-body font-semibold">Substitutions</h4>
                            {Array.isArray(m.substitutions) ? (
                              <ul className="t-body mt-1 list-disc pl-5">
                                {m.substitutions.map((s, i) => (
                                  <li key={i}>{String(s)}</li>
                                ))}
                              </ul>
                            ) : (
                              <ul className="t-body mt-1 list-disc pl-5">
                                {Object.entries(m.substitutions).map(([k, v]) => (
                                  <li key={k}>
                                    Instead of {k}: {String(v)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                          <label className="t-body flex min-h-[44px] cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-5 w-5"
                              checked={checked}
                              onChange={() => toggleAdherence(activeDayPlan.dayIndex, m.id)}
                              aria-label={`Mark ${m.name} as eaten`}
                            />
                            {checked && <Check size={15} aria-hidden="true" style={{ color: 'var(--accent)' }} />}
                            Ate this
                          </label>
                          <LuxButton
                            variant="secondary"
                            disabled={regenerating === `${activeDayPlan.dayIndex}:${m.mealType}`}
                            onClick={() => void handleRegenerateMeal(activeDayPlan.dayIndex, String(m.mealType))}
                            aria-label={`Regenerate ${mealLabel(String(m.mealType)).toLowerCase()} for this day`}
                          >
                            <RefreshCw size={15} aria-hidden="true" />
                            {regenerating === `${activeDayPlan.dayIndex}:${m.mealType}` ? 'Regenerating…' : 'Regenerate'}
                          </LuxButton>
                          {swapMode && rawIndex >= 0 && (
                            <LuxButton
                              variant="secondary"
                              aria-pressed={picked}
                              onClick={() => handleSwapPick(activeDayPlan.dayIndex, rawIndex)}
                            >
                              {picked ? 'Selected' : 'Select to swap'}
                            </LuxButton>
                          )}
                        </div>
                      </GlassPanel>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
