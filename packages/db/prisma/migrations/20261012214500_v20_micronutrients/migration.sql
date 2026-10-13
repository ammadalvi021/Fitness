-- V20 — Micronutrients (Cronometer-style %DV tracking).
-- Forward-only, additive, non-destructive: two nullable JSONB columns.
-- Typed, closed-schema objects (see packages/core/src/micronutrients.ts):
-- absent key = "not tracked", never 0. Existing rows are untouched (NULL).
-- Prisma column order matches schema.prisma (micros before createdAt/updatedAt).

-- AlterTable: Food — micro snapshot per serving
ALTER TABLE "Food" ADD COLUMN "micros" JSONB;

-- AlterTable: DiaryEntry — micro snapshot at log time
ALTER TABLE "DiaryEntry" ADD COLUMN "micros" JSONB;
