/**
 * v21.8 P5 — menuPatchHasMaterialChange (pure unit tests, no DB required).
 *
 * Verifies the material-change detector used by PATCH /api/menu-items/[id]
 * to decide whether an edit invalidates a prior `lastVerifiedAt` stamp.
 */
import { describe, expect, it } from 'vitest';
import { menuPatchHasMaterialChange } from '@/lib/menu-api-schema';

const existing = {
  name: 'Chicken Biryani',
  portion: '1 plate',
  kcal: 720,
  proteinG: 32,
  carbsG: 80,
  fatG: 28,
  fiberG: 4,
  source: 'restaurant website',
  nutritionStatus: 'restaurant_published',
};

describe('menuPatchHasMaterialChange', () => {
  it('returns false for an empty patch', () => {
    expect(menuPatchHasMaterialChange(existing, {})).toBe(false);
  });

  it('returns false when patched values equal the stored values', () => {
    expect(
      menuPatchHasMaterialChange(existing, {
        name: 'Chicken Biryani',
        kcal: 720,
        nutritionStatus: 'restaurant_published',
      }),
    ).toBe(false);
  });

  it('detects a name change', () => {
    expect(menuPatchHasMaterialChange(existing, { name: 'Chicken Biryani (Large)' })).toBe(true);
  });

  it('detects a portion change', () => {
    expect(menuPatchHasMaterialChange(existing, { portion: '2 plates' })).toBe(true);
  });

  it('treats empty string and null as the same "no value" for text fields', () => {
    expect(menuPatchHasMaterialChange({ ...existing, portion: null }, { portion: '' })).toBe(false);
    expect(menuPatchHasMaterialChange({ ...existing, portion: '' }, { portion: null })).toBe(false);
    expect(menuPatchHasMaterialChange(existing, { portion: null })).toBe(true);
  });

  it('detects kcal and macro changes', () => {
    expect(menuPatchHasMaterialChange(existing, { kcal: 721 })).toBe(true);
    expect(menuPatchHasMaterialChange(existing, { proteinG: 33 })).toBe(true);
    expect(menuPatchHasMaterialChange(existing, { carbsG: 0 })).toBe(true);
    expect(menuPatchHasMaterialChange(existing, { fatG: null })).toBe(true);
    expect(menuPatchHasMaterialChange(existing, { fiberG: 4 })).toBe(false);
  });

  it('tolerates float round-trips between Postgres DOUBLE PRECISION and JS doubles', () => {
    const stored = { ...existing, kcal: 0.1 + 0.2 };
    expect(menuPatchHasMaterialChange(stored, { kcal: 0.3 })).toBe(false);
    expect(menuPatchHasMaterialChange(stored, { kcal: 0.31 })).toBe(true);
  });

  it('detects source and nutrition-status changes', () => {
    expect(menuPatchHasMaterialChange(existing, { source: 'menu photo' })).toBe(true);
    expect(menuPatchHasMaterialChange(existing, { nutritionStatus: 'calculated_estimate' })).toBe(
      true,
    );
  });

  it('ignores non-material fields like description and assumptions', () => {
    expect(
      menuPatchHasMaterialChange(existing, {
        description: 'New description',
        assumptions: ['new assumption'],
      } as never),
    ).toBe(false);
  });

  it('ignores fields explicitly set to undefined', () => {
    expect(menuPatchHasMaterialChange(existing, { kcal: undefined })).toBe(false);
  });
});
