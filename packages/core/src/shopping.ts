/**
 * Shopping-list consolidation. Pure functions.
 */

export interface ShoppingItem {
  name: string;
  quantity: string;
  category: string;
}

/**
 * Group items by category and merge items with the same name (case-insensitive)
 * within a category, combining their quantity strings with " + ".
 * Categories and items are sorted for deterministic output.
 */
export function consolidateShoppingList(
  items: ShoppingItem[],
): Record<string, ShoppingItem[]> {
  const byCategory = new Map<string, Map<string, ShoppingItem>>();

  for (const item of items) {
    const category = item.category.trim() || 'Other';
    const key = item.name.trim().toLowerCase();
    let group = byCategory.get(category);
    if (!group) {
      group = new Map<string, ShoppingItem>();
      byCategory.set(category, group);
    }
    const existing = group.get(key);
    if (existing) {
      existing.quantity = `${existing.quantity} + ${item.quantity.trim()}`;
    } else {
      group.set(key, {
        name: item.name.trim(),
        quantity: item.quantity.trim(),
        category,
      });
    }
  }

  const out: Record<string, ShoppingItem[]> = {};
  for (const category of [...byCategory.keys()].sort()) {
    out[category] = [...(byCategory.get(category) as Map<string, ShoppingItem>).values()].sort(
      (a, b) => a.name.localeCompare(b.name),
    );
  }
  return out;
}
