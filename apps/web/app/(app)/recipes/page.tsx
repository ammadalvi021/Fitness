'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  AlertTriangle,
  Check,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  SearchX,
} from 'lucide-react';
import { Input, Select, Skeleton } from '@/components/ui';
import {
  EmptyStateLux,
  GlassPanel,
  LuxBadge,
  LuxButton,
} from '@/components/luxury';
import { num, unwrapList } from '../nutrition/_shared';
import {
  AWAITING_REVIEW_BADGE,
  recipeQualityTier,
  tierBadge,
} from '@/lib/recipe-tier';

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
  needsReview?: boolean;
  // v21.3: server-computed canonical tier + display summaries (the API is
  // the tier authority; the client never re-derives tiers from partial data).
  tier?: 'calculated-estimate' | 'reviewed' | 'verified' | null;
  reviewInfo?: { reviewer: string; reviewedAt: string } | null;
  verificationInfo?: { checkedBy: string; checkedAt: string; method: string } | null;
}

interface Meta {
  cuisines: { name: string; count: number }[];
  tags: { tag: string; count: number }[];
  mealTypes: string[];
  difficulties: string[];
  allergens: { allergen: string; count: number }[];
}

interface Filters {
  q: string;
  cuisine: string;
  diet: 'any' | 'vegetarian' | 'non_vegetarian';
  tags: string[];
  mealType: string;
  difficulty: string;
  minKcal: string;
  maxKcal: string;
  maxTime: string;
  excludeAllergens: string[];
}

const DEFAULT_FILTERS: Filters = {
  q: '',
  cuisine: '',
  diet: 'any',
  tags: [],
  mealType: '',
  difficulty: '',
  minKcal: '',
  maxKcal: '',
  maxTime: '',
  excludeAllergens: [],
};

const DEFAULT_PAGE_SIZE = 24;
const PAGE_SIZES = [12, 24, 48];
const DEBOUNCE_MS = 350;

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
    needsReview: Boolean(r.needsReview),
    tier: isTier(r.tier) ? r.tier : null,
    reviewInfo: asReviewInfo(r.reviewInfo),
    verificationInfo: asVerificationInfo(r.verificationInfo),
  };
}

function isTier(v: unknown): v is 'calculated-estimate' | 'reviewed' | 'verified' {
  return v === 'calculated-estimate' || v === 'reviewed' || v === 'verified';
}

/** Display-safe review summary shape (v21.3 evidence API contract). */
function asReviewInfo(v: unknown): { reviewer: string; reviewedAt: string } | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.reviewer !== 'string' || typeof o.reviewedAt !== 'string') return null;
  return { reviewer: o.reviewer, reviewedAt: o.reviewedAt };
}

function asVerificationInfo(
  v: unknown,
): { checkedBy: string; checkedAt: string; method: string } | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.checkedBy !== 'string' ||
    typeof o.checkedAt !== 'string' ||
    typeof o.method !== 'string'
  )
    return null;
  return { checkedBy: o.checkedBy, checkedAt: o.checkedAt, method: o.method };
}

function totalTime(r: RecipeCard): number {
  return r.prepMin + r.cookMin;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function RecipesPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaFailed, setMetaFailed] = useState(false);

  const [recipes, setRecipes] = useState<RecipeCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true); // initial only
  const [refreshing, setRefreshing] = useState(false); // background refetch
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchId = useRef(0);

  /* ---- filter vocabularies: full-table derived, loaded once ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<Meta>('/api/recipes/meta');
        if (!cancelled) setMeta(data);
      } catch {
        if (!cancelled) setMetaFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- debounced server-side fetch: every filter is an API param ---- */
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const id = ++fetchId.current;
      const firstLoad = recipes === null && error === null;
      if (firstLoad) setLoading(true);
      else setRefreshing(true);
      (async () => {
        try {
          const params = new URLSearchParams();
          params.set('page', String(page));
          params.set('pageSize', String(pageSize));
          const f = filters;
          if (f.q.trim()) params.set('q', f.q.trim());
          if (f.cuisine) params.set('cuisine', f.cuisine);
          if (f.diet !== 'any') params.set('diet', f.diet);
          for (const t of f.tags) params.append('tag', t);
          if (f.mealType) params.set('mealType', f.mealType);
          if (f.difficulty) params.set('difficulty', f.difficulty);
          if (f.minKcal) params.set('minKcal', f.minKcal);
          if (f.maxKcal) params.set('maxKcal', f.maxKcal);
          if (f.maxTime) params.set('maxTime', f.maxTime);
          if (f.excludeAllergens.length)
            params.set('excludeAllergen', f.excludeAllergens.join(','));
          const data = await api<unknown>(`/api/recipes?${params.toString()}`);
          if (fetchId.current !== id) return; // stale response
          const list = unwrapList<Record<string, unknown>>(data, 'recipes').map(normalizeRecipe);
          const obj = data as Record<string, unknown>;
          const t = num(obj.total);
          const pc = Math.max(1, num(obj.pageCount) || 1);
          setRecipes(list);
          setTotal(t);
          setPageCount(pc);
          // Server clamps the page; stay in sync if it drifted.
          const serverPage = num(obj.page);
          if (serverPage > 0 && serverPage !== page) setPage(serverPage);
          setError(null);
        } catch (e) {
          if (fetchId.current !== id) return;
          setError(e instanceof Error ? e.message : 'Failed to load recipes.');
        } finally {
          if (fetchId.current === id) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, pageSize, retryNonce]);

  function updateFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  function toggleTag(t: string) {
    setFilters((f) => ({
      ...f,
      tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t],
    }));
    setPage(1);
  }

  function toggleAllergen(a: string) {
    setFilters((f) => ({
      ...f,
      excludeAllergens: f.excludeAllergens.includes(a)
        ? f.excludeAllergens.filter((x) => x !== a)
        : [...f.excludeAllergens, a],
    }));
    setPage(1);
  }

  function clearAll() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    setPageSize(DEFAULT_PAGE_SIZE);
  }

  const f = filters;
  const hasFilters =
    f.q.trim() !== '' ||
    f.cuisine !== '' ||
    f.diet !== 'any' ||
    f.tags.length > 0 ||
    f.mealType !== '' ||
    f.difficulty !== '' ||
    f.minKcal !== '' ||
    f.maxKcal !== '' ||
    f.maxTime !== '' ||
    f.excludeAllergens.length > 0;

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Compact numbered pagination: current ± 2 plus first/last with ellipsis.
  const pageNumbers: (number | '…')[] = (() => {
    const out: (number | '…')[] = [];
    const lo = Math.max(1, page - 2);
    const hi = Math.min(pageCount, page + 2);
    if (lo > 1) {
      out.push(1);
      if (lo > 2) out.push('…');
    }
    for (let p = lo; p <= hi; p++) out.push(p);
    if (hi < pageCount) {
      if (hi < pageCount - 1) out.push('…');
      out.push(pageCount);
    }
    return out;
  })();

  return (
    <div className="anim-page-enter mx-auto max-w-5xl space-y-6 p-4 pb-24">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="t-page-title flex items-center gap-3">
            <ChefHat size={26} aria-hidden="true" style={{ color: 'var(--accent)' }} />
            Recipes
          </h1>
          <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
            Find something good to cook
          </p>
        </div>
        <Link
          href="/recipes/import"
          className="anim-press inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm text-[var(--text)]"
        >
          Import from URL
        </Link>
      </div>

      {/* ------- filters (all enforced server-side) ------- */}
      <GlassPanel className="p-5">
        {metaFailed && (
          <p className="t-body mb-3" style={{ color: 'var(--text-secondary)' }} role="note">
            Filter suggestions could not be loaded; search and numeric filters still work.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="rq" className="t-body block font-medium">
              Search
            </label>
            <Input
              id="rq"
              type="search"
              placeholder="Dish, ingredient…"
              value={f.q}
              onChange={(e) => updateFilters({ q: e.target.value })}
              className="min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="rcuisine" className="t-body block font-medium">
              Cuisine
            </label>
            <Select
              id="rcuisine"
              value={f.cuisine}
              onChange={(e) => updateFilters({ cuisine: e.target.value })}
              className="min-h-[44px]"
            >
              <option value="">All cuisines</option>
              {(meta?.cuisines ?? []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
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
              value={f.diet}
              onChange={(e) => updateFilters({ diet: e.target.value as Filters['diet'] })}
              className="min-h-[44px]"
            >
              <option value="any">Mixed collection</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="non_vegetarian">Non-vegetarian</option>
            </Select>
          </div>
          <div>
            <label htmlFor="rmealtype" className="t-body block font-medium">
              Meal type
            </label>
            <Select
              id="rmealtype"
              value={f.mealType}
              onChange={(e) => updateFilters({ mealType: e.target.value })}
              className="min-h-[44px]"
            >
              <option value="">Any meal type</option>
              {(meta?.mealTypes ?? []).map((m) => (
                <option key={m} value={m}>
                  {capitalize(m)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="rdifficulty" className="t-body block font-medium">
              Difficulty
            </label>
            <Select
              id="rdifficulty"
              value={f.difficulty}
              onChange={(e) => updateFilters({ difficulty: e.target.value })}
              className="min-h-[44px]"
            >
              <option value="">Any difficulty</option>
              {(meta?.difficulties ?? []).map((d) => (
                <option key={d} value={d}>
                  {capitalize(d)}
                </option>
              ))}
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
              value={f.maxKcal}
              onChange={(e) => updateFilters({ maxKcal: e.target.value })}
              className="min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="rminkcal" className="t-body block font-medium">
              Min kcal / serving
            </label>
            <Input
              id="rminkcal"
              type="number"
              min={0}
              placeholder="e.g. 200"
              value={f.minKcal}
              onChange={(e) => updateFilters({ minKcal: e.target.value })}
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
              value={f.maxTime}
              onChange={(e) => updateFilters({ maxTime: e.target.value })}
              className="min-h-[44px]"
            />
          </div>
          <div className="flex items-end">
            <LuxButton variant="secondary" disabled={!hasFilters} onClick={clearAll}>
              Clear all
            </LuxButton>
          </div>
        </div>

        <div className="mt-4">
          <p className="t-body font-medium" id="tag-label">
            Tags
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="tag-label">
            {(meta?.tags ?? []).map(({ tag, count }) => {
              const on = f.tags.includes(tag);
              return (
                <LuxButton
                  key={tag}
                  aria-pressed={on}
                  variant={on ? 'primary' : 'secondary'}
                  onClick={() => toggleTag(tag)}
                >
                  {on && <Check size={15} aria-hidden="true" />}
                  {tag} <span className="t-numeral opacity-70">({count})</span>
                </LuxButton>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <p className="t-body font-medium" id="allergen-label">
            Exclude allergens
          </p>
          {/* v21.8 (P3): the exclusion is conservative — recipes that were
              never allergen-screened are hidden too, and screening is
              name-based only (not an allergy-safety guarantee). */}
          <p className="t-meta mt-1" style={{ color: 'var(--text-secondary)' }}>
            Excluding an allergen also hides recipes that were never
            allergen-screened. Screening is name-based only — not an
            allergy-safety guarantee.
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="allergen-label">
            {(meta?.allergens ?? []).map(({ allergen, count }) => {
              const on = f.excludeAllergens.includes(allergen);
              return (
                <LuxButton
                  key={allergen}
                  aria-pressed={on}
                  variant={on ? 'primary' : 'secondary'}
                  onClick={() => toggleAllergen(allergen)}
                >
                  {on && <Check size={15} aria-hidden="true" />}
                  No {allergen} <span className="t-numeral opacity-70">({count})</span>
                </LuxButton>
              );
            })}
          </div>
        </div>
      </GlassPanel>

      {/* ------- result count / refreshing indicator ------- */}
      {recipes !== null && !error && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="t-body" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
            Showing <span className="t-numeral">{from}</span>–<span className="t-numeral">{to}</span> of{' '}
            <span className="t-numeral">{total}</span> recipe{total === 1 ? '' : 's'}
            {refreshing && <span className="ml-2 italic">Updating…</span>}
          </p>
          <label className="t-body flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            Per page
            <Select
              aria-label="Recipes per page"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="min-h-[40px]"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}

      {/* ------- results ------- */}
      {loading && recipes === null && error === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading recipes">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <GlassPanel key={i} className="p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
              <Skeleton className="mt-2 h-4 w-full" />
            </GlassPanel>
          ))}
        </div>
      ) : error !== null ? (
        <GlassPanel className="p-8 text-center">
          <AlertTriangle size={28} aria-hidden="true" className="mx-auto" style={{ color: 'var(--accent)' }} />
          <h2 className="t-card-heading mt-3">Couldn&apos;t load recipes</h2>
          <p className="t-body mt-1" style={{ color: 'var(--text-secondary)' }}>
            {error}
          </p>
          <LuxButton
            variant="primary"
            className="mt-4"
            onClick={() => {
              setError(null);
              setRecipes(null);
              setRetryNonce((n) => n + 1);
            }}
          >
            Retry
          </LuxButton>
        </GlassPanel>
      ) : (recipes ?? []).length === 0 ? (
        <EmptyStateLux
          icon={<SearchX size={22} aria-hidden="true" />}
          title="No recipes match"
          message="Try widening your search or clearing some filters."
          action={
            hasFilters ? (
              <LuxButton variant="secondary" onClick={clearAll}>
                Clear all filters
              </LuxButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(recipes ?? []).map((r) => {
              const isAi = r.source === 'ai';
              // Data-quality tier badge (v21.2 claims policy): every recipe
              // gets its tier; needsReview adds the "Awaiting review" marker.
              const tb = tierBadge(recipeQualityTier(r));
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
                      <LuxBadge tone={tb.tone}>{tb.label}</LuxBadge>
                      {r.needsReview && (
                        <LuxBadge tone={AWAITING_REVIEW_BADGE.tone}>
                          {AWAITING_REVIEW_BADGE.label}
                        </LuxBadge>
                      )}
                      {r.source === 'curated' && <LuxBadge>Curated</LuxBadge>}
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

          {/* ------- pagination ------- */}
          {pageCount > 1 && (
            <nav aria-label="Recipe pages" className="flex items-center justify-center gap-1 pt-2">
              <LuxButton
                variant="secondary"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </LuxButton>
              {pageNumbers.map((p, i) =>
                p === '…' ? (
                  <span key={`e${i}`} className="t-body px-1" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <LuxButton
                    key={p}
                    variant={p === page ? 'primary' : 'secondary'}
                    aria-label={`Page ${p}`}
                    aria-current={p === page ? 'page' : undefined}
                    onClick={() => setPage(p)}
                  >
                    <span className="t-numeral">{p}</span>
                  </LuxButton>
                ),
              )}
              <LuxButton
                variant="secondary"
                aria-label="Next page"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </LuxButton>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
