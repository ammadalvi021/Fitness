-- V18 — Location-aware food database: taxonomy, aliases, household portions,
-- packaged-product cache, restaurants & menus. All changes are additive and
-- non-destructive. Existing rows get safe defaults ('PK', 'estimate', etc.).

-- AlterTable: Profile — location & localization
ALTER TABLE "Profile" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'PK',
ADD COLUMN     "cityRegion" TEXT,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "unitSystem" TEXT NOT NULL DEFAULT 'metric',
ADD COLUMN     "ramadanMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Food — taxonomy, verification, barcode, provenance
ALTER TABLE "Food" ADD COLUMN     "verification" TEXT NOT NULL DEFAULT 'estimate',
ADD COLUMN     "basis" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "countryCodes" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);

-- AlterTable: Recipe — user-owned private home recipes
ALTER TABLE "Recipe" ADD COLUMN     "userId" TEXT,
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "yieldGrams" DOUBLE PRECISION;

-- CreateTable: FoodCategory
CREATE TABLE "FoodCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameUrdu" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FoodCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable: FoodAlias
CREATE TABLE "FoodAlias" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',

    CONSTRAINT "FoodAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable: HouseholdPortion
CREATE TABLE "HouseholdPortion" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelUrdu" TEXT,
    "grams" DOUBLE PRECISION,
    "ml" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HouseholdPortion_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CachedProduct (Open Food Facts cache, barcode = id)
CREATE TABLE "CachedProduct" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openfoodfacts',
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CachedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Restaurant
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPlaceId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION,
    "priceLevel" INTEGER,
    "website" TEXT,
    "menuUrl" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RestaurantMenuItem
CREATE TABLE "RestaurantMenuItem" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "portion" TEXT,
    "kcal" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "fiberG" DOUBLE PRECISION,
    "nutritionStatus" TEXT NOT NULL DEFAULT 'unavailable',
    "assumptions" JSONB,
    "source" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantMenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MenuCorrection
CREATE TABLE "MenuCorrection" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FoodCategory_name_key" ON "FoodCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Food_barcode_key" ON "Food"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_providerPlaceId_key" ON "Restaurant"("providerPlaceId");

-- CreateIndex
CREATE INDEX "FoodAlias_alias_idx" ON "FoodAlias"("alias");

-- CreateIndex
CREATE INDEX "FoodAlias_foodId_idx" ON "FoodAlias"("foodId");

-- CreateIndex
CREATE INDEX "HouseholdPortion_foodId_idx" ON "HouseholdPortion"("foodId");

-- CreateIndex
CREATE INDEX "CachedProduct_fetchedAt_idx" ON "CachedProduct"("fetchedAt");

-- CreateIndex
CREATE INDEX "Restaurant_city_idx" ON "Restaurant"("city");

-- CreateIndex
CREATE INDEX "RestaurantMenuItem_restaurantId_idx" ON "RestaurantMenuItem"("restaurantId");

-- CreateIndex
CREATE INDEX "MenuCorrection_menuItemId_idx" ON "MenuCorrection"("menuItemId");

-- CreateIndex
CREATE INDEX "Recipe_userId_idx" ON "Recipe"("userId");

-- AddForeignKey
ALTER TABLE "Food" ADD CONSTRAINT "Food_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FoodCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodAlias" ADD CONSTRAINT "FoodAlias_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdPortion" ADD CONSTRAINT "HouseholdPortion_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantMenuItem" ADD CONSTRAINT "RestaurantMenuItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCorrection" ADD CONSTRAINT "MenuCorrection_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "RestaurantMenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCorrection" ADD CONSTRAINT "MenuCorrection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
