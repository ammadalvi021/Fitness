/**
 * Pure unit tests for the recipe access-decision function.
 * No database involved — runs everywhere, including this VM.
 */
import { describe, expect, it } from 'vitest';
import { canViewRecipe } from '@/lib/recipe-access';

describe('canViewRecipe', () => {
  const owner = { id: 'user-owner-1' };
  const stranger = { id: 'user-stranger-2' };
  const anon = null;

  it('public recipe: anonymous viewers may read', () => {
    expect(
      canViewRecipe({ isPrivate: false, userId: null }, anon),
    ).toBe(true);
  });

  it('public recipe: any authenticated viewer may read', () => {
    expect(
      canViewRecipe({ isPrivate: false, userId: 'user-owner-1' }, stranger),
    ).toBe(true);
  });

  it('private recipe: anonymous viewer is denied', () => {
    expect(
      canViewRecipe({ isPrivate: true, userId: owner.id }, anon),
    ).toBe(false);
  });

  it('private recipe: owner is allowed', () => {
    expect(
      canViewRecipe({ isPrivate: true, userId: owner.id }, owner),
    ).toBe(true);
  });

  it('private recipe: authenticated non-owner is denied', () => {
    expect(
      canViewRecipe({ isPrivate: true, userId: owner.id }, stranger),
    ).toBe(false);
  });

  it('private recipe: ownership requires exact id match', () => {
    expect(
      canViewRecipe(
        { isPrivate: true, userId: owner.id },
        { id: `${owner.id}-suffix` },
      ),
    ).toBe(false);
    expect(
      canViewRecipe({ isPrivate: true, userId: owner.id }, { id: owner.id }),
    ).toBe(true);
  });

  it('private recipe with no owner is visible to nobody', () => {
    expect(
      canViewRecipe({ isPrivate: true, userId: null }, owner),
    ).toBe(false);
    expect(
      canViewRecipe({ isPrivate: true, userId: null }, anon),
    ).toBe(false);
  });
});
