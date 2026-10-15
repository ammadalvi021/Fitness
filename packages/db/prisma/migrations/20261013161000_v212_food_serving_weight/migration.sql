-- V21.2 (Worker A — nutrition correctness): canonical gram-per-serving on Food.
-- Forward-only, additive: adds a nullable column and backfills DOCUMENTED
-- serving weights. No existing row's meaning changes; the column is NULL
-- where the weight is genuinely unknown (never guessed).
ALTER TABLE "Food" ADD COLUMN "servingWeightG" DOUBLE PRECISION;

-- Backfill basis (all values also live in packages/db/prisma/seed.ts):
--  * "(NNg)" values come from the row's own servingUnit annotation.
--  * Whole Milk: 250 ml x 1.03 g/ml (USDA whole-milk density ~1.03 g/ml).
--  * Olive Oil: servingUnit is already grams ('g (1 tbsp)').
UPDATE "Food" SET "servingWeightG" = 30    WHERE name = 'Chapati (Whole Wheat Roti)';
UPDATE "Food" SET "servingWeightG" = 90    WHERE name = 'Naan';
UPDATE "Food" SET "servingWeightG" = 60    WHERE name = 'Paratha (whole wheat)';
UPDATE "Food" SET "servingWeightG" = 100   WHERE name = 'Boiled Eggs';
UPDATE "Food" SET "servingWeightG" = 30    WHERE name = 'Whole Wheat Bread';
UPDATE "Food" SET "servingWeightG" = 120   WHERE name = 'Banana';
UPDATE "Food" SET "servingWeightG" = 180   WHERE name = 'Apple';
UPDATE "Food" SET "servingWeightG" = 140   WHERE name = 'Orange';
UPDATE "Food" SET "servingWeightG" = 72    WHERE name = 'Dates (Medjool)';
UPDATE "Food" SET "servingWeightG" = 14    WHERE name = 'Olive Oil';
UPDATE "Food" SET "servingWeightG" = 257.5 WHERE name = 'Whole Milk';
