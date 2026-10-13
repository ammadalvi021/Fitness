import RecipeImportClient from "@/components/recipe-import/RecipeImportClient";

export const metadata = {
  title: "Import recipe from URL · FitFusion",
};

/**
 * /recipes/import — paste a recipe-page URL, review the AI-parsed recipe
 * (all fields editable), then save via the existing custom-recipe path.
 */
export default function ImportRecipePage() {
  return <RecipeImportClient />;
}
