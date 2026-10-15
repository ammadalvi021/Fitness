-- v21.4: durable partial-nutrition indicator on diary entries (additive only —
-- one new nullable column, no DROPs, no column changes, no backfill).
--
-- nutritionPartial (BOOLEAN, nullable): true when the entry was logged with
-- explicitly acknowledged incomplete recipe nutrition (Item 5 — the API now
-- requires nutritionAck: true for needsReview recipes and stores this flag
-- so partial totals are never presented as complete). NULL/false = the
-- entry's totals are complete (or predate this flag).
ALTER TABLE "DiaryEntry" ADD COLUMN "nutritionPartial" BOOLEAN;
