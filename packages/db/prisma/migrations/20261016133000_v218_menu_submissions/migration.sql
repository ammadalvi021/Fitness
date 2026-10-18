-- v21.8 PRIORITY 2: separate customer menu submissions from public publication.
--
-- THE DEFECT: POST /api/menus/confirm let ANY authenticated user insert rows
-- directly into RestaurantMenuItem, which is exactly what the public
-- GET /api/restaurants/[id]/menu serves — so unreviewed customer uploads
-- went straight onto the shared restaurant menu.
--
-- THE FIX: confirm now writes to a new, private MenuSubmission table with
-- status 'pending', recording the submitting user (submittedBy), the source,
-- and the matched food record (matchedFoodId). Pending/rejected submissions
-- never appear in the public menu response. An admin approves a submission
-- via PATCH /api/menu-submissions/[id], which (in one transaction) publishes
-- a RestaurantMenuItem copy and stamps reviewedBy/reviewedAt/publishedItemId.
--
-- Additive only: one new table, three indexes, three foreign keys. No
-- existing table, column, or index is touched; no backfill needed because the
-- table starts empty. Existing RestaurantMenuItem rows (including any
-- previously published from confirm) keep their current visibility.
CREATE TABLE "MenuSubmission" (
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
    "matchedFoodId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "publishedItemId" TEXT,

    CONSTRAINT "MenuSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuSubmission_restaurantId_idx" ON "MenuSubmission"("restaurantId");
CREATE INDEX "MenuSubmission_status_idx" ON "MenuSubmission"("status");
CREATE INDEX "MenuSubmission_submittedBy_idx" ON "MenuSubmission"("submittedBy");

ALTER TABLE "MenuSubmission" ADD CONSTRAINT "MenuSubmission_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuSubmission" ADD CONSTRAINT "MenuSubmission_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuSubmission" ADD CONSTRAINT "MenuSubmission_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
