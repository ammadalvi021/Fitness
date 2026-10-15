/**
 * Single place where the "who may see this recipe" decision is made.
 *
 * Rules:
 * - Public recipes (isPrivate=false): visible to everyone, anonymous included.
 * - Private recipes: visible ONLY to the owning user. A private recipe with
 *   no owner (userId null) is visible to nobody.
 *
 * Callers respond 404 (not 403/401) on denial so that a private recipe's
 * existence is not leaked to non-owners.
 */
export interface RecipeVisibility {
  isPrivate: boolean;
  userId: string | null;
}

export interface RecipeViewer {
  id: string;
}

export function canViewRecipe(
  recipe: RecipeVisibility,
  viewer: RecipeViewer | null,
): boolean {
  if (!recipe.isPrivate) return true;
  if (viewer === null) return false;
  if (recipe.userId === null) return false;
  return recipe.userId === viewer.id;
}
