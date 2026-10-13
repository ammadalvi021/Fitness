-- V20 Feature 5 — Intermittent fasting timer: cross-device persistence for the
-- active fast. One nullable JSON column on Profile (only one fast can be
-- active at a time, so no separate table is needed). All additive;
-- existing rows are untouched (column stays NULL until the user starts a fast).

-- AlterTable: Profile — active fasting session
ALTER TABLE "Profile" ADD COLUMN "fastingSession" JSONB;
