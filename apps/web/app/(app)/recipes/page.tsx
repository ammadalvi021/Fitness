'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Check, ChefHat, SearchX } from 'lucide-react';
import { Input, Select, Skeleton } from '@/components/ui';
import {
  EmptyStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
} from '@/components/luxury';
import { num, unwrapList } from '../nutrition/_shared';

/* ---------- shapes ---------- */

interface RecipeCard {
  id: string;
  slug: string;
  title: string;
  cuisine?: string | null;
  dietCategory?: string | null;
  tags: string[];
  kcalPerServing: number;
  prepMin: number;
  cookMin: number;
  source?: string | null;
  verified?: boolean;
}

const TAG_OPTIONS = [
  'vegan',
  'halal',
  'high-protein',
  'low-sodium',
  'dairy-free',
  'gluten-free',
  'high-fiber',
  'budget-friendly',
];

function normalizeRecipe(r: Record<string, unknown>): RecipeCard {
  return {
    id: String(r.id ?? r.slug ?? ''),
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
    kcalPerServing: num(r.kcalPerServing),
    prepMin: num(r.prepMin),
    cookMin: num(r.cookMin),
    source: typeof r.source === 'string' ? r.source : null,
    verified: Boolean(r.verified),
  };
}

function totalTime(r: RecipeCard): number {
  return r.prepMin + r.cookMin;
}

export default function RecipesPage() {
  const [q, setQ] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [diet, setDiet] = useState<'any' | 'vegetarian' | 'non_vegetarian'>('any');
  const [tags, setTags] = useState<string[]>([]);
  const [maxKcal, setMaxKcal] = useState('');
  const [maxTime, setMaxTime] = useState('');

  const [recipes, setRecipes] = useState<RecipeCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [cuisines, setCuisines] = useState<string[]>([]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRecipes = async (opts: {
    q: string;
    cuisine: string;
    diet: string;
    maxKcal: string;
  }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (opts.q.trim()) params.set('q', opts.q.trim());
      if (opts.cuisine) params.set('cuisine', opts.cuisine);
      if (opts.diet !== 'any') params.set('diet', opts.diet);
      if (opts.maxKcal) params.set('maxKcal', opts.maxKcal);
      const data = await api<unknown>(`/api/recipes?${params.toString()}`);
      setRecipes(unwrapList<Record<string, unknown>>(data, 'recipes').map(normalizeRecipe));
    } catch {
      setRecipes([]);
    } finally {
      setLoading(false);
    }
  };

  /* initial load: unfiltered, to collect cuisine options */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api<unknown>('/api/recipes');
        const list = unwrapList<Record<string, unknown>>(data, 'recipes').map(normalizeRecipe);
        setRecipes(list);
        setCuisines(Array.from(new Set(list.map((r) => r.cuisine).filter((c): c is string => Boolean(c)))).sort());
      } catch {
        setRecipes([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* debounced refetch on filter change (tags & maxTime applied client-side) */
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void fetchRecipes({ q, cuisine, diet, maxKcal });
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cuisine, diet, maxKcal]);

  const visible = useMemo(() => {
    const list = recipes ?? [];
    const maxK = maxKcal ? num(maxKcal) : null;
    const maxT = maxTime ? num(maxTime) : null;
    const wanted = tags.map((t) => t.toLowerCase());
    return list.filter((r) => {
      if (maxK != null && r.kcalPerServing > maxK) return false;
      if (maxT != null && totalTime(r) > maxT) return false;
      if (wanted.length > 0) {
        const have = r.tags.map((t) => t.toLowerCase());
        if (!wanted.every((t) => have.includes(t))) return false;
      }
      return true;
    });
  }, [recipes, tags, maxKcal, maxTime]);

  function toggleTag(t: string) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function clearFilters() {
    setQ('');
    setCuisine('');
    setDiet('any');
    setTags([]);
    setMaxKcal('');
    setMaxTime('');
  }

  const hasFilters =
    q.trim() !== '' || cuisine !== '' || diet !== 'any' || tags.length > 0 || maxKcal !== '' || maxTime !== '';

  return (
    <div className="anim-page-enter mx-auto max-w-5xl space-y-6 p-4 pb-24">
      <div className="mb-2">
        <h1 className="t-page-title flex items-center gap-3">
          <ChefHat size={26} aria-hidden="true" style={{ color: 'var(--accent)' }} />
          Recipes
        </h1>
        <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
          Find something good to cook
        </p>
      </div>

      {/* ------- filters ------- */}
      <GlassPanel className="p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="rq" className="t-body block font-medium">
              Search
            </label>
            <Input
              id="rq"
              type="search"
              placeholder="Dish, ingredient…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="rcuisine" className="t-body block font-medium">
              Cuisine
            </label>
            <Select
              id="rcuisine"
              value={cuisine}
              onChange={(e) => setCuisine(e.target.value)}
              className="min-h-[44px]"
            >
              <option value="">All cuisines</option>
              {cuisines.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="rdiet" className="t-body block font-medium">
              Diet
            </label>
            <Select
              id="rdiet"
              value={diet}
              onChange={(e) => setDiet(e.target.value as typeof diet)}
              className="min-h-[44px]"
            >
              <option value="any">Mixed collection</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="non_vegetarian">Non-vegetarian</option>
            </Select>
          </div>
          <div>
            <label htmlFor="rmaxkcal" className="t-body block font-medium">
              Max kcal / serving
            </label>
            <Input
              id="rmaxkcal"
              type="number"
              min={0}
              placeholder="e.g. 500"
              value={maxKcal}
              onChange={(e) => setMaxKcal(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="rmaxtime" className="t-body block font-medium">
              Max total time (min)
            </label>
            <Input
              id="rmaxtime"
              type="number"
              min={0}
              placeholder="e.g. 30"
              value={maxTime}
              onChange={(e) => setMaxTime(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
          <div className="flex items-end">
            <LuxButton
              variant="secondary"
              disabled={!hasFilters}
              onClick={clearFilters}
            >
              Clear filters
            </LuxButton>
          </div>
        </div>

        <div className="mt-4">
          <p className="t-body font-medium" id="tag-label">
            Tags
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="tag-label">
            {TAG_OPTIONS.map((t) => {
              const on = tags.includes(t);
              return (
                <LuxButton
                  key={t}
                  aria-pressed={on}
                  variant={on ? 'primary' : 'secondary'}
                  onClick={() => toggleTag(t)}
                >
                  {on && <Check size={15} aria-hidden="true" />}
                  {t}
                </LuxButton>
              );
            })}
          </div>
        </div>
      </GlassPanel>

      {/* ------- results ------- */}
      {loading && recipes === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <GlassPanel key={i} className="p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
              <Skeleton className="mt-2 h-4 w-full" />
            </GlassPanel>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyStateLux
          icon={<SearchX size={22} aria-hidden="true" />}
          title="No recipes match"
          message="Try widening your search or clearing some filters."
          action={
            hasFilters ? (
              <LuxButton variant="secondary" onClick={clearFilters}>
                Clear filters
              </LuxButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="t-body" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
            <span className="t-numeral">{visible.length}</span> recipe{visible.length === 1 ? '' : 's'}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((r) => {
              const isAi = r.source === 'ai';
              return (
                <Link
                  key={r.id}
                  href={`/recipes/${encodeURIComponent(r.slug)}`}
                  className="block min-h-[44px] rounded-2xl focus:outline-none focus-visible:ring-2"
                  style={{ ['--tw-ring-color' as string]: 'var(--accent)' }}
                  aria-label={`View recipe: ${r.title}`}
                >
                  <GlassPanel className="anim-hover-lift h-full p-5">
                    <div className="flex flex-wrap gap-1">
                      {r.verified ? (
                        <LuxBadge tone="success">Verified</LuxBadge>
                      ) : r.source === 'curated' ? (
                        <LuxBadge>Curated</LuxBadge>
                      ) : null}
                      {isAi && <LuxBadge tone="accent">AI-generated</LuxBadge>}
                      {r.dietCategory === 'vegetarian' && <LuxBadge tone="success">Vegetarian</LuxBadge>}
                    </div>
                    <h2 className="t-card-heading mt-2 leading-snug">{r.title}</h2>
                    <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
                      {r.cuisine ?? 'Various'} · <span className="t-numeral">{Math.round(r.kcalPerServing)}</span> kcal/serving
                      {isAi && ' (estimate)'}
                      {totalTime(r) > 0 ? (
                        <>
                          {' '}· <span className="t-numeral">{totalTime(r)}</span> min
                        </>
                      ) : ''}
                    </p>
                    {r.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.tags.slice(0, 4).map((t) => (
                          <LuxBadge key={t}>{t}</LuxBadge>
                        ))}
                      </div>
                    )}
                  </GlassPanel>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
