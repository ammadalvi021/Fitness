import { describe, expect, it } from 'vitest';
import { consolidateShoppingList } from './shopping.js';

describe('consolidateShoppingList', () => {
  it('merges same-name items within a category, joining quantities with " + "', () => {
    const out = consolidateShoppingList([
      { name: 'Chicken breast', quantity: '200 g', category: 'Protein' },
      { name: 'chicken breast', quantity: '150 g', category: 'Protein' },
      { name: 'Rice', quantity: '1 kg', category: 'Grains' },
    ]);
    expect(out['Protein']).toHaveLength(1);
    expect(out['Protein'][0].name).toBe('Chicken breast');
    expect(out['Protein'][0].quantity).toBe('200 g + 150 g');
    expect(out['Grains']).toHaveLength(1);
  });

  it('does not merge across categories', () => {
    const out = consolidateShoppingList([
      { name: 'Salt', quantity: '1 tsp', category: 'Spices' },
      { name: 'Salt', quantity: '500 g', category: 'Bulk' },
    ]);
    expect(out['Spices'][0].quantity).toBe('1 tsp');
    expect(out['Bulk'][0].quantity).toBe('500 g');
  });

  it('sorts categories and items deterministically', () => {
    const out = consolidateShoppingList([
      { name: 'Banana', quantity: '2', category: 'Produce' },
      { name: 'Apple', quantity: '3', category: 'Produce' },
      { name: 'Milk', quantity: '1 L', category: 'Dairy' },
    ]);
    expect(Object.keys(out)).toEqual(['Dairy', 'Produce']);
    expect(out['Produce'].map((i) => i.name)).toEqual(['Apple', 'Banana']);
  });

  it('handles an empty list', () => {
    expect(consolidateShoppingList([])).toEqual({});
  });
});
