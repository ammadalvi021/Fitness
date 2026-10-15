-- v21.3: recipe review/verification evidence storage (additive only —
-- new nullable columns, no DROPs, no column changes, no backfill).
--
-- JSON shapes (canonical policy: packages/core/src/recipe-claims.ts):
--
-- verificationEvidence (JSONB, nullable) — VerificationEvidence:
--   { "checkedBy": string (admin identity, server-set from session),
--     "checkedAt": string (ISO-8601 date),
--     "method": string (e.g. "independent recomputation"),
--     "allergenAndDietRechecked": boolean (must be true) }
--
-- reviewEvidence (JSONB, nullable) — ReviewRecord:
--   { "reviewer": string (admin identity, server-set from session),
--     "reviewedAt": string (ISO-8601 date),
--     "method": string ("independent recomputation" | "label cross-check" |
--                        "lab analysis" | "other"),
--     "reference": string (reference/evidence used, e.g. "USDA SR Legacy #170923"),
--     "dietaryRechecked": boolean (must be true),
--     "allergenRechecked": boolean (must be true) }
--
-- Rows seeded before this migration (all 270 seed recipes) have NULL in both
-- columns and therefore tier as 'calculated-estimate' — the honest default.
-- Evidence is written ONLY by the admin review API
-- (POST /api/admin/recipes/[slug]/review), which validates every field
-- server-side via meetsVerifiedStandard()/meetsReviewedStandard().

ALTER TABLE "Recipe" ADD COLUMN "verificationEvidence" JSONB;

ALTER TABLE "Recipe" ADD COLUMN "reviewEvidence" JSONB;
