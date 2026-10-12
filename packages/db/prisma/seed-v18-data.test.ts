/**
 * V18 seed-data shape tests — PURE (no database).
 * The data module must be side-effect free: importing it never touches the DB.
 * Covers: catalogue size, raw-vs-cooked separation, portion gram
 * conversions, alias language coverage, and idempotency invariants.
 */
import { describe, expect, it } from 'vitest';
import {
  V18_CATEGORIES,
  V18_EXISTING_FOOD_EXTENSIONS,
  V18_FOODS,
} from './seed-v18-data.js';

describe('V18 catalogue size', () => {
  it('has 16 categories with Urdu names and unique sort orders', () => {
    expect(V18_CATEGORIES).toHaveLength(16);
    for (const c of V18_CATEGORIES) {
      expect(c.nameUrdu.trim().length).toBeGreaterThan(0);
    }
    const orders = V18_CATEGORIES.map((c) => c.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('has 80–120 Pakistani home foods', () => {
    expect(V18_FOODS.length).toBeGreaterThanOrEqual(80);
    expect(V18_FOODS.length).toBeLessThanOrEqual(120);
  });

  it('has unique food names', () => {
    const names = V18_FOODS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every food references a known category and carries an honest basis', () => {
    const cats = new Set(V18_CATEGORIES.map((c) => c.name));
    for (const f of V18_FOODS) {
      expect(cats.has(f.category), `${f.name}: unknown category`).toBe(true);
      expect(f.basis.trim().length, `${f.name}: missing basis`).toBeGreaterThan(0);
      expect(f.servingSize).toBeGreaterThan(0);
    }
  });
});

describe('raw vs cooked separation', () => {
  it('keeps dry/uncooked records distinct from cooked ones', () => {
    const names = V18_FOODS.map((f) => f.name);
    expect(names).toContain('Basmati Rice (dry, uncooked)');
    expect(names).toContain('Atta (whole wheat flour, dry)');
    expect(names).toContain('Besan (chickpea flour, dry)');
    // Cooked counterparts are separate records with different names.
    expect(names).not.toContain('Basmati Rice (cooked)');
  });

  it('dry and cooked records never share a name', () => {
    const lower = V18_FOODS.map((f) => f.name.toLowerCase());
    // Match the parenthetical qualifier, not the substring ("uncooked"
    // contains "cooked").
    const dry = lower.filter((n) => n.includes('(dry'));
    const cooked = lower.filter((n) => n.includes('(cooked)'));
    expect(dry.length).toBeGreaterThan(0);
    expect(cooked.length).toBeGreaterThan(0);
    for (const d of dry) {
      expect(cooked).not.toContain(d);
    }
    // And no base name appears as both a dry and a cooked record.
    const base = (n: string) => n.replace(/\s*\((dry|cooked)[^)]*\)/g, '').trim();
    const dryBases = new Set(dry.map(base));
    for (const c of cooked.map(base)) {
      expect(dryBases.has(c), `base "${c}" has both dry and cooked records`).toBe(false);
    }
  });
});

describe('household portion gram conversions', () => {
  it('every portion has a positive gram or ml equivalent', () => {
    for (const f of V18_FOODS) {
      expect(f.portions.length, `${f.name}: no portions`).toBeGreaterThan(0);
      for (const p of f.portions) {
        const ok = (p.grams ?? 0) > 0 || (p.ml ?? 0) > 0;
        expect(ok, `${f.name} / ${p.label}: no gram/ml equivalent`).toBe(true);
      }
    }
  });

  it('drinks use ml portions, solids use gram portions', () => {
    const lassi = V18_FOODS.find((f) => f.name === 'Sweet Lassi')!;
    expect(lassi.portions[0].ml).toBe(250);
    const paratha = V18_FOODS.find((f) => f.name === 'Aloo Paratha')!;
    expect(paratha.portions[0].grams).toBe(100);
  });
});

describe('alias language coverage (en / ur / roman-ur)', () => {
  it('every food has 2–8 aliases', () => {
    for (const f of V18_FOODS) {
      expect(
        f.aliases.length >= 2 && f.aliases.length <= 8,
        `${f.name}: ${f.aliases.length} aliases`,
      ).toBe(true);
    }
  });

  it('all three languages are represented across the catalogue', () => {
    const langs = new Set(V18_FOODS.flatMap((f) => f.aliases.map((a) => a[1])));
    expect(langs).toEqual(new Set(['en', 'ur', 'roman-ur']));
  });

  it('every food has at least one Urdu-script or Roman-Urdu alias', () => {
    for (const f of V18_FOODS) {
      const hasLocal = f.aliases.some((a) => a[1] === 'ur' || a[1] === 'roman-ur');
      expect(hasLocal, `${f.name}: no local-language alias`).toBe(true);
    }
  });

  it('roti lookup works in all three scripts (spot check)', () => {
    const chapati = V18_EXISTING_FOOD_EXTENSIONS.find(
      (e) => e.name === 'Chapati (Whole Wheat Roti)',
    )!;
    const byLang = (lang: string) =>
      chapati.aliases.filter((a) => a[1] === lang).map((a) => a[0]);
    expect(byLang('ur')).toContain('روٹی');
    expect(byLang('roman-ur')).toContain('roti');
    expect(byLang('roman-ur')).toContain('phulka');
    expect(byLang('en')).toContain('roti');
  });
});

describe('existing starter-food extensions', () => {
  it('covers every starter food exactly once', () => {
    expect(V18_EXISTING_FOOD_EXTENSIONS).toHaveLength(40);
    const names = V18_EXISTING_FOOD_EXTENSIONS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every extension adds aliases and portions without touching nutrition', () => {
    for (const e of V18_EXISTING_FOOD_EXTENSIONS) {
      expect(e.aliases.length, `${e.name}: no aliases`).toBeGreaterThan(0);
      expect(e.portions.length, `${e.name}: no portions`).toBeGreaterThan(0);
      // Extensions carry no nutrient fields at all — nutrition is never rewritten.
      expect('kcal' in e).toBe(false);
    }
  });
});
