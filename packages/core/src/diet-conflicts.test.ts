/**
 * FitFusion AI v21.5 (P3) — vegetarian dietCategory conflict screening.
 * Pure logic, runs on this VM (vitest).
 *
 * Confirmed defect: `dietCategory` was REQUIRED at creation (v21.4) but
 * nothing checked the user's choice against the ingredients — a
 * "vegetarian" recipe could contain chicken.
 *
 * These tests pin the fix at the pure-logic level:
 *  - unambiguous meat/poultry/fish/seafood (chicken, beef mince, mutton,
 *    fish, prawn/jhinga, keema, offal) under a vegetarian declaration →
 *    conflicts (the routes 400 naming the ingredient);
 *  - trusted Food-category signal ('Chicken, Meat & Fish') → conflict;
 *  - dairy and eggs (paneer, dahi, ghee, anda) are NOT conflicts —
 *    lacto-ovo vegetarian is valid in this market (documented decision);
 *  - valid vegetarian (daal, paneer, vegetables) → clear;
 *  - non_vegetarian is never screened (no false positives);
 *  - ambiguous free text ("chef's special mix") → ambiguous, never a
 *    clean pass and never assumed vegetarian;
 *  - lookalikes don't false-positive (eggplant ≠ egg; papaya ≠ paya;
 *    coconut is not a conflict; "soya keema" is guarded; "meat masala"
 *    blends are ambiguous, not conflicts).
 *
 * Route-level behavior (400 codes, needsReview forcing) is covered by the
 * mocked POST/PATCH suite in
 * apps/web/tests/integration/v215-vegetarian-conflicts.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  screenVegetarianDiet,
  checkRecipeDiet,
  dietConflictMessage,
  dietAmbiguityWarning,
  type DietScreenRow,
} from './diet-conflicts.js';

const veg = (rows: DietScreenRow[]) => screenVegetarianDiet(rows);
const row = (name: string, extra: Partial<DietScreenRow> = {}): DietScreenRow => ({
  name,
  ...extra,
});

describe('screenVegetarianDiet — conflicts (v21.5 P3)', () => {
  it('flags unambiguous meat/poultry/fish by name', () => {
    expect(veg([row('Chicken breast')]).conflicts).toEqual(['Chicken breast']);
    expect(veg([row('beef mince')]).conflicts).toEqual(['beef mince']);
    expect(veg([row('Mutton karahi')]).conflicts).toEqual(['Mutton karahi']);
    expect(veg([row('Fish fry')]).conflicts).toEqual(['Fish fry']);
    expect(veg([row('Jhinga')]).conflicts).toEqual(['Jhinga']);
    expect(veg([row('Prawn curry')]).conflicts).toEqual(['Prawn curry']);
    expect(veg([row('Keema')]).conflicts).toEqual(['Keema']);
    expect(veg([row('Chicken Karahi')]).conflicts).toEqual(['Chicken Karahi']);
    expect(veg([row('kaleji')]).conflicts).toEqual(['kaleji']);
    expect(veg([row('paya')]).conflicts).toEqual(['paya']);
  });

  it('is plural-tolerant and case-insensitive', () => {
    expect(veg([row('CHICKENS')]).conflicts).toEqual(['CHICKENS']);
    expect(veg([row('prawns')]).conflicts).toEqual(['prawns']);
  });

  it('trusts the Food category signal for foodId rows', () => {
    const r = veg([
      row('Murghi', {
        canonicalName: 'Chicken',
        foodCategoryName: 'Chicken, Meat & Fish',
        catalogueMatch: true,
      }),
    ]);
    expect(r.conflicts).toEqual(['Murghi']);
  });

  it('screens canonicalName as well as the display name', () => {
    // A display rename must not hide the catalogue identity (P2 convention).
    const r = veg([row('nutty spread', { canonicalName: 'Chicken breast' })]);
    expect(r.conflicts).toEqual(['nutty spread']);
  });

  it('deduplicates repeated conflicts', () => {
    const r = veg([row('chicken'), row('Chicken'), row('CHICKEN')]);
    expect(r.conflicts).toEqual(['chicken', 'Chicken', 'CHICKEN']);
  });
});

describe('screenVegetarianDiet — dairy/egg decision (v21.5 P3)', () => {
  it('does NOT flag dairy or eggs as conflicts', () => {
    for (const name of [
      'Paneer',
      'Dahi',
      'Desi ghee',
      'Milk',
      'Cheddar cheese',
      'Anda curry',
      'Eggs',
    ]) {
      const r = veg([row(name)]);
      expect(r.conflicts).toEqual([]);
      expect(r.ambiguous).toEqual([]);
    }
  });

  it('does not treat the Dairy/Eggs food categories as conflicts', () => {
    const r = veg([
      row('Paneer', {
        canonicalName: 'Paneer',
        foodCategoryName: 'Dairy',
        catalogueMatch: true,
      }),
      row('Eggs', {
        canonicalName: 'Eggs',
        foodCategoryName: 'Eggs',
        catalogueMatch: true,
      }),
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });
});

describe('screenVegetarianDiet — clear vegetarian (v21.5 P3)', () => {
  it('accepts a valid vegetarian ingredient set', () => {
    const r = veg([
      row('Moong daal'),
      row('Paneer'),
      row('Mixed vegetables'),
      row('Basmati rice'),
      row('Atta'),
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });

  it('treats catalogue rows and known-zero rows as trusted', () => {
    const r = veg([
      row('Mystery veg mix 123', { catalogueMatch: true }),
      row('Salt', { knownZero: true }),
      row('Water', { knownZero: true }),
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });
});

describe('screenVegetarianDiet — ambiguity (v21.5 P3)', () => {
  it('flags unfamiliar free text as ambiguous, never a clean pass', () => {
    const r = veg([row("chef's special mix")]);
    expect(r.conflicts).toEqual([]);
    expect(r.ambiguous).toEqual(["chef's special mix"]);
  });

  it('does not assume unfamiliar = vegetarian even with declared nutrients', () => {
    // Declared nutrients say nothing about plant origin.
    const r = veg([row('Protein blend X7')]);
    expect(r.ambiguous).toEqual(['Protein blend X7']);
  });
});

describe('screenVegetarianDiet — no false positives (v21.5 P3)', () => {
  it('does not confuse lookalikes', () => {
    // eggplant contains "egg" (allowed anyway), papaya contains "paya"
    // as a substring but has no word boundary — neither is meat.
    for (const name of ['Eggplant', 'Baingan', 'Papaya', 'Coconut', 'Peanuts']) {
      expect(veg([row(name)]).conflicts).toEqual([]);
    }
  });

  it('guards vegetarian keema ("soya keema" is not a conflict)', () => {
    const r = veg([row('Soya keema')]);
    expect(r.conflicts).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });

  it('treats "X masala" blends as ambiguous, not conflicts', () => {
    // Spice mix vs meat dish — genuinely ambiguous.
    const r = veg([row('Meat masala')]);
    expect(r.conflicts).toEqual([]);
    expect(r.ambiguous).toEqual(['Meat masala']);
  });
});

describe('checkRecipeDiet — route verdict (v21.5 P3)', () => {
  it('only screens vegetarian declarations', () => {
    const rows = [row('Chicken breast')];
    expect(checkRecipeDiet(rows, 'non_vegetarian')).toEqual({
      ok: true,
      conflicts: [],
      ambiguous: [],
    });
    expect(checkRecipeDiet(rows, 'vegetarian').ok).toBe(false);
    expect(checkRecipeDiet(rows, 'vegetarian').conflicts).toEqual([
      'Chicken breast',
    ]);
  });

  it('passes a clean vegetarian recipe and surfaces ambiguity', () => {
    const clean = checkRecipeDiet(
      [row('Moong daal'), row('Paneer')],
      'vegetarian',
    );
    expect(clean).toEqual({ ok: true, conflicts: [], ambiguous: [] });

    const amb = checkRecipeDiet(
      [row('Moong daal'), row("chef's special mix")],
      'vegetarian',
    );
    expect(amb.ok).toBe(true);
    expect(amb.conflicts).toEqual([]);
    expect(amb.ambiguous).toEqual(["chef's special mix"]);
  });
});

describe('diet messages (v21.5 P3)', () => {
  it('names the offending ingredients and the remedy', () => {
    const msg = dietConflictMessage(['Chicken breast', 'beef mince'], 'vegetarian');
    expect(msg).toContain('"Chicken breast"');
    expect(msg).toContain('"beef mince"');
    expect(msg).toContain('vegetarian');
    expect(msg).toContain('non_vegetarian');
  });

  it('uses singular grammar for one conflict', () => {
    expect(dietConflictMessage(['Chicken'], 'vegetarian')).toContain('is meat');
  });

  it('ambiguity warning names ingredients and disclaims the claim', () => {
    const w = dietAmbiguityWarning(["chef's special mix"]);
    expect(w).toContain("\"chef's special mix\"");
    expect(w).toContain('Vegetarian is not claimed');
  });
});
