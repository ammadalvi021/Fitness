/**
 * FitFusion AI — v21.2 recipe alias normalization (PURE module).
 *
 * Shared by:
 *  - `packages/db/prisma/seed.ts`   (persists `normalizedAlias` per alias row)
 *  - `apps/web/app/api/recipes/route.ts` (normalizes the `q` query for matching)
 *
 * RULES (honest and conservative):
 *  - lowercase, trim, collapse internal whitespace to single spaces;
 *  - Unicode NFKD decomposition, then strip combining diacritical marks so
 *    e.g. "fırında" still matches regardless of precomposed vs decomposed input;
 *  - Urdu script (Arabic block incl. presentation forms) is passed through
 *    UNTOUCHED: no transliteration, no invented romanization mappings, and the
 *    Arabic-block vowel marks (harakat) are preserved, so Urdu text matches
 *    exactly as written.
 *
 * This module imports nothing — safe to import from seeds, tests and routes.
 */
import type { Prisma } from '@prisma/client';

/** Combining-mark ranges stripped after NFKD. Arabic-block vowel marks
 *  (U+064B–U+065F) are deliberately EXCLUDED so Urdu script passes through
 *  exactly as written. */
const COMBINING_MARK_RE =
  /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g;
/** Urdu/Arabic script detection (base block, supplements, presentation forms). */
const URDU_SCRIPT_RE = /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]/;

/**
 * Language hint for an alias. 'ur' when the alias contains Urdu/Arabic
 * script; 'roman-ur' when a Latin-script alias contains one of a short,
 * fixed list of Roman-Urdu function words (ka/ki/ke/ko/wali/wala/wale/
 * bina/se/hai/hain) — deliberately function words only, since dish content
 * words (biryani, karahi) are English loanwords. 'mein' is EXCLUDED: it
 * false-positives on "lo mein" (Chinese noodle dish). Otherwise 'en'.
 * This is a hint column only — search never depends on it.
 */
const ROMAN_URDU_FUNCTION_WORDS = new Set([
  'ka', 'ki', 'ke', 'ko',
  'wali', 'wala', 'wale', 'waali', 'waala', 'waale',
  'bina', 'se', 'hai', 'hain',
]);

export type AliasLanguage = 'en' | 'ur' | 'roman-ur';

export function detectAliasLanguage(alias: string): AliasLanguage {
  if (URDU_SCRIPT_RE.test(alias)) return 'ur';
  const tokens = alias.toLowerCase().split(/[^a-z]+/);
  if (tokens.some((t) => ROMAN_URDU_FUNCTION_WORDS.has(t))) return 'roman-ur';
  return 'en';
}

/**
 * Normalize free text for case/diacritic-insensitive matching.
 * Pure: no I/O, no locale dependence beyond String.prototype methods.
 */
export function normalizeAlias(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARK_RE, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface RecipeAliasRow {
  recipeId: string;
  /** Display/original alias text exactly as carried by the seed data. */
  alias: string;
  /** Matching key: normalized, unique per recipe (upsert key). */
  normalizedAlias: string;
  /** Language hint ('en' | 'ur' | 'roman-ur'). */
  language: AliasLanguage;
}

/**
 * Map a seed recipe's `aliases` array to RecipeAlias rows.
 * Pure and deterministic: drops blanks, collapses aliases that normalize
 * to the same string (one row per normalized alias per recipe), never
 * invents aliases, never merges identities across recipes.
 */
export function buildRecipeAliasRows(
  recipeId: string,
  aliases: readonly string[] | undefined,
): RecipeAliasRow[] {
  if (!aliases) return [];
  const rows: RecipeAliasRow[] = [];
  const seen = new Set<string>();
  for (const raw of aliases) {
    const alias = raw.trim();
    if (!alias) continue;
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias || seen.has(normalizedAlias)) continue;
    seen.add(normalizedAlias);
    rows.push({ recipeId, alias, normalizedAlias, language: detectAliasLanguage(alias) });
  }
  return rows;
}

/**
 * Build the Prisma where-clause for the recipe `q` search parameter.
 * Matches recipe TITLES (case-insensitive substring, unchanged legacy
 * behavior) OR persisted recipe ALIASES (normalized substring match).
 * Returns null when the query is blank so callers can skip the clause.
 *
 * CONTRACT (for Worker E's server-side search UI): `GET /api/recipes?q=X`
 * finds a recipe when X (normalized) appears in the title or in any of the
 * recipe's stored aliases. Alias rows are populated by `db:seed` from the
 * v21 batch modules; a recipe with no aliases behaves exactly as before.
 */
export function buildAliasSearchClause(q: string): Prisma.RecipeWhereInput | null {
  const query = q.trim();
  if (!query) return null;
  const normalized = normalizeAlias(query);
  const or: Prisma.RecipeWhereInput[] = [
    { title: { contains: query, mode: 'insensitive' } },
  ];
  if (normalized) {
    or.push({ aliases: { some: { normalizedAlias: { contains: normalized } } } });
  }
  return { OR: or };
}
