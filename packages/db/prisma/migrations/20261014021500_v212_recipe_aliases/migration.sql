-- v21.2: recipe alias storage (additive only — new table, no DROPs, no column changes)
CREATE TABLE "RecipeAlias" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeAlias_pkey" PRIMARY KEY ("id")
);

-- One row per (recipe, normalized alias): the idempotency key for the seed upsert.
CREATE UNIQUE INDEX "RecipeAlias_recipeId_normalizedAlias_key" ON "RecipeAlias"("recipeId", "normalizedAlias");

-- Search index: GET /api/recipes?q= matches normalizedAlias via substring.
CREATE INDEX "RecipeAlias_normalizedAlias_idx" ON "RecipeAlias"("normalizedAlias");

ALTER TABLE "RecipeAlias" ADD CONSTRAINT "RecipeAlias_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
