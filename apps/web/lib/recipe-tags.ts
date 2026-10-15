/**
 * FitFusion AI — v21.2 recipe tag vocabulary + pagination helpers (PURE).
 *
 * Shared by `apps/web/app/api/recipes/route.ts` (server-side tag filtering)
 * and the recipes browse UI. No DB I/O, no side effects — safe to unit test.
 *
 * TAG VOCABULARY (audited against seed data, 2026-10-13):
 * The seed corpus historically used two spellings for the same concept:
 * `halal` (v18 seed.ts recipes) and `halal-friendly` (older v21 drafts).
 * Under the v21.2 P8 claims policy no current seed recipe carries
 * `halal-friendly`, but both spellings are canonicalized to `halal` so the
 * filter keeps matching either spelling if data ever reintroduces it.
 * The browse UI offers the full tag vocabulary DERIVED FROM THE DATABASE
 * (`GET /api/recipes/meta`), never a hardcoded list — so a filter can
 * never match zero recipes by construction.
 */
import type { Prisma } from '@fitfusion/db';

/** Canonical tag -> all stored spellings that must match it. */
export const TAG_VARIANT_GROUPS: Record<string, readonly string[]> = {
  halal: ['halal', 'halal-friendly'],
};

const CANONICAL_BY_VARIANT = new Map<string, string>();
for (const [canonical, variants] of Object.entries(TAG_VARIANT_GROUPS)) {
  for (const v of variants) CANONICAL_BY_VARIANT.set(v, canonical);
}

/**
 * Canonicalize one raw tag value: lowercase, trim, resolve known aliases
 * (`halal-friendly` -> `halal`). Unknown tags pass through unchanged
 * (lowercased) — callers never invent matches.
 */
export function normalizeRecipeTag(tag: string): string {
  const t = tag.trim().toLowerCase();
  return CANONICAL_BY_VARIANT.get(t) ?? t;
}

/** All stored spellings a canonical tag must match (identity for most tags). */
export function expandRecipeTagVariants(canonical: string): string[] {
  const t = canonical.trim().toLowerCase();
  return [...(TAG_VARIANT_GROUPS[t] ?? [t])];
}

/**
 * Build the Prisma `where` for a multi-tag filter with AND semantics:
 * a recipe must carry at least one spelling of EVERY wanted tag.
 * Returns null when no tags were given (caller skips the clause).
 *
 * Example: ['halal', 'vegan'] ->
 *   { AND: [
 *       { OR: [{ tags: { has: 'halal' } }, { tags: { has: 'halal-friendly' } }] },
 *       { OR: [{ tags: { has: 'vegan' } }] },
 *     ] }
 */
export function buildRecipeTagWhere(rawTags: readonly string[]): Prisma.RecipeWhereInput | null {
  const wanted = [...new Set(rawTags.map(normalizeRecipeTag).filter(Boolean))];
  if (wanted.length === 0) return null;
  return {
    AND: wanted.map((canonical) => ({
      OR: expandRecipeTagVariants(canonical).map((v) => ({
        tags: { has: v },
      })),
    })),
  };
}

/**
 * Pure matcher expressing the SAME semantics as `buildRecipeTagWhere`,
 * for tests and documentation: recipe matches when its stored tags contain
 * at least one spelling of every wanted canonical tag.
 */
export function recipeMatchesTags(recipeTags: readonly string[], wanted: readonly string[]): boolean {
  const have = recipeTags.map((t) => t.trim().toLowerCase());
  return wanted
    .map(normalizeRecipeTag)
    .every((canonical) =>
      expandRecipeTagVariants(canonical).some((v) => have.includes(v)),
    );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 48;

export interface PageInfo {
  /** Page number as requested, clamped into [1, pageCount]. */
  page: number;
  pageCount: number;
  /** 0-based DB offset for the page. */
  skip: number;
  /** Number of rows to take (page size). */
  take: number;
  /** 1-based "showing X" (0 when total is 0). */
  from: number;
  /** 1-based "showing –Y" (0 when total is 0). */
  to: number;
}

/**
 * Pure pagination math shared by the API route and the UI.
 * pageCount is at least 1 so an empty result set still renders one
 * (empty) page rather than "page 0 of 0".
 */
export function paginate(total: number, page: number, pageSize: number): PageInfo {
  const size = Math.max(1, Math.floor(pageSize) || DEFAULT_PAGE_SIZE);
  const count = Math.max(0, Math.floor(total) || 0);
  const pageCount = Math.max(1, Math.ceil(count / size));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const skip = (safePage - 1) * size;
  return {
    page: safePage,
    pageCount,
    skip,
    take: size,
    from: count === 0 ? 0 : skip + 1,
    to: Math.min(skip + size, count),
  };
}
