-- V21 recipe library expansion: meal type + nutrition review flag (additive only)
ALTER TABLE "Recipe" ADD COLUMN "mealType" TEXT;
ALTER TABLE "Recipe" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
