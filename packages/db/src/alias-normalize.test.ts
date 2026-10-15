/**
 * FitFusion AI — v21.2 recipe alias normalization: pure unit tests (no DB).
 */
import { describe, expect, it } from 'vitest';
import {
  buildAliasSearchClause,
  buildRecipeAliasRows,
  detectAliasLanguage,
  normalizeAlias,
} from './alias-normalize.js';

describe('normalizeAlias', () => {
  it('lowercases and trims', () => {
    expect(normalizeAlias('  Chicken Karahi  ')).toBe('chicken karahi');
  });

  it('collapses internal whitespace (spaces, tabs, newlines)', () => {
    expect(normalizeAlias('light  chicken\n\tstir   fry')).toBe('light chicken stir fry');
  });

  it('strips Latin diacritics (precomposed)', () => {
    expect(normalizeAlias('CAFÉ au lait')).toBe('cafe au lait');
    expect(normalizeAlias('crème brûlée')).toBe('creme brulee');
  });

  it('treats precomposed and decomposed diacritics identically', () => {
    expect(normalizeAlias('café')).toBe(normalizeAlias('café'));
  });

  it('keeps dotless ı and other non-decomposing letters as-is', () => {
    // From the real seed data: 'fırında levrek' (Turkish, seed-recipes-western).
    expect(normalizeAlias('Fırında Levrek')).toBe('fırında levrek');
  });

  it('passes Urdu/Arabic script through untouched (no transliteration)', () => {
    expect(normalizeAlias('مرغی بریانی')).toBe('مرغی بریانی');
    expect(normalizeAlias('  مرغی   بریانی ')).toBe('مرغی بریانی');
  });

  it('preserves Arabic-block vowel marks (harakat) inside Urdu text', () => {
    // U+064E FATHA is inside the Arabic block and must survive normalization.
    const withHarakat = 'مُرغی';
    expect(normalizeAlias(withHarakat)).toBe(withHarakat);
  });

  it('returns empty string for blank input', () => {
    expect(normalizeAlias('')).toBe('');
    expect(normalizeAlias('   \n\t ')).toBe('');
  });

  it('does not transliterate Roman Urdu', () => {
    expect(normalizeAlias('murghi ka salan')).toBe('murghi ka salan');
    expect(normalizeAlias('besan ki roti')).toBe('besan ki roti');
  });
});

describe('detectAliasLanguage', () => {
  it('detects Urdu script', () => {
    expect(detectAliasLanguage('مرغی بریانی')).toBe('ur');
    expect(detectAliasLanguage('chicken مرغی')).toBe('ur');
  });

  it('detects Roman Urdu via function words', () => {
    expect(detectAliasLanguage('murghi ka salan light')).toBe('roman-ur');
    expect(detectAliasLanguage('besan ki roti')).toBe('roman-ur');
    expect(detectAliasLanguage('chicken karahi ghee wali')).toBe('roman-ur');
  });

  it('labels plain English as en', () => {
    expect(detectAliasLanguage('chicken biryani')).toBe('en');
    expect(detectAliasLanguage('light sweet and sour chicken')).toBe('en');
  });

  it('does not mislabel "lo mein" as roman-ur', () => {
    expect(detectAliasLanguage('light vegetable lo mein')).toBe('en');
    expect(detectAliasLanguage('veg lo mein')).toBe('en');
  });
});

describe('buildRecipeAliasRows', () => {
  it('maps every alias to one row with normalized key and language', () => {
    const rows = buildRecipeAliasRows('r1', ['Peshawari Karahi', 'murghi ka salan']);
    expect(rows).toEqual([
      { recipeId: 'r1', alias: 'Peshawari Karahi', normalizedAlias: 'peshawari karahi', language: 'en' },
      { recipeId: 'r1', alias: 'murghi ka salan', normalizedAlias: 'murghi ka salan', language: 'roman-ur' },
    ]);
  });

  it('returns [] for undefined aliases', () => {
    expect(buildRecipeAliasRows('r1', undefined)).toEqual([]);
  });

  it('skips blank aliases', () => {
    const rows = buildRecipeAliasRows('r1', ['  ', 'real alias', '']);
    expect(rows.map((r) => r.alias)).toEqual(['real alias']);
  });

  it('collapses aliases that normalize to the same string (one row per normalized alias)', () => {
    const rows = buildRecipeAliasRows('r1', ['Chicken Karahi', 'chicken  karahi', 'CHICKEN KARAHI']);
    expect(rows).toHaveLength(1);
    expect(rows[0].normalizedAlias).toBe('chicken karahi');
  });

  it('keeps the original display text on the row', () => {
    const rows = buildRecipeAliasRows('r1', ['Fırında Levrek']);
    expect(rows[0].alias).toBe('Fırında Levrek');
    expect(rows[0].normalizedAlias).toBe('fırında levrek');
  });
});

describe('buildAliasSearchClause', () => {
  it('returns null for blank queries', () => {
    expect(buildAliasSearchClause('')).toBeNull();
    expect(buildAliasSearchClause('   ')).toBeNull();
  });

  it('matches titles (legacy, case-insensitive) OR aliases (normalized)', () => {
    const clause = buildAliasSearchClause('Karahi');
    expect(clause).toEqual({
      OR: [
        { title: { contains: 'Karahi', mode: 'insensitive' } },
        { aliases: { some: { normalizedAlias: { contains: 'karahi' } } } },
      ],
    });
  });

  it('normalizes the query before alias matching', () => {
    const clause = buildAliasSearchClause('  MURGHI   Ka  Salan ');
    expect(clause).toEqual({
      OR: [
        { title: { contains: 'MURGHI   Ka  Salan', mode: 'insensitive' } },
        { aliases: { some: { normalizedAlias: { contains: 'murghi ka salan' } } } },
      ],
    });
  });

  it('matches Urdu-script queries against aliases as-is', () => {
    const clause = buildAliasSearchClause('مرغی');
    expect(clause).toEqual({
      OR: [
        { title: { contains: 'مرغی', mode: 'insensitive' } },
        { aliases: { some: { normalizedAlias: { contains: 'مرغی' } } } },
      ],
    });
  });
});

/**
 * Alias search identity semantics (v21.3, Worker D).
 *
 * The persisted search clause is `aliases.some.normalizedAlias.contains`
 * (normalized substring). These tests simulate that matching over fixture
 * alias rows to pin what the clause MEANS end-to-end:
 *  - a Roman Urdu query with messy case/whitespace matches the right
 *    recipe's alias and NOT a different food's alias;
 *  - a genuinely different food's alias never normalizes into the same
 *    string (no invented-identity collision at the row level);
 *  - broad substring queries may match several recipes — that is honest
 *    substring behavior, and the rows keep their identities separate
 *    (recipeId stays on the key).
 */
describe('alias search identity (pure simulation of the persisted clause)', () => {
  /** Simulates `aliases: { some: { normalizedAlias: { contains: q } } }`. */
  function queryHitsAliases(
    recipeId: string,
    aliases: string[],
    query: string,
  ): boolean {
    const nq = normalizeAlias(query);
    if (nq.length === 0) return false;
    return buildRecipeAliasRows(recipeId, aliases).some((row) =>
      row.normalizedAlias.includes(nq),
    );
  }

  const KARAHI = { id: 'r-karahi', aliases: ['Peshawari Karahi', 'murghi ka salan'] };
  const PULAO = { id: 'r-pulao', aliases: ['Chicken Pulao', 'murghi pulao'] };

  it('a Roman Urdu query matches the right recipe only', () => {
    expect(queryHitsAliases(KARAHI.id, KARAHI.aliases, '  MURGHI   Ka  Salan ')).toBe(true);
    expect(queryHitsAliases(PULAO.id, PULAO.aliases, '  MURGHI   Ka  Salan ')).toBe(false);
  });

  it('a different food\'s alias never normalizes into the same string', () => {
    // 'murghi ka salan' (karahi) vs 'murghi pulao' (pulao) are close but
    // distinct — no collision, no invented identity.
    expect(normalizeAlias('murghi ka salan')).not.toBe(normalizeAlias('murghi pulao'));
    expect(normalizeAlias('chicken pulao')).not.toBe(normalizeAlias('peshawari karahi'));
  });

  it('broad substring queries may hit several recipes — identities stay separate', () => {
    expect(queryHitsAliases(KARAHI.id, KARAHI.aliases, 'murghi')).toBe(true);
    expect(queryHitsAliases(PULAO.id, PULAO.aliases, 'murghi')).toBe(true);
    // …but the underlying rows are still keyed per recipe, never merged.
    const karahiRows = buildRecipeAliasRows(KARAHI.id, KARAHI.aliases);
    const pulaoRows = buildRecipeAliasRows(PULAO.id, PULAO.aliases);
    expect(karahiRows.every((r) => r.recipeId === KARAHI.id)).toBe(true);
    expect(pulaoRows.every((r) => r.recipeId === PULAO.id)).toBe(true);
  });
});
