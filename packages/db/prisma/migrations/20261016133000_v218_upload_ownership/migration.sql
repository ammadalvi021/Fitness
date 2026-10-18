-- v21.8 PRIORITY 7: upload ownership and retention.
--
-- THE DEFECT: GET /api/uploads/[key] only checked that the requester was
-- authenticated — any authenticated user who knew or guessed a storage key
-- could fetch another user's upload (food-scan photos, menu screenshots,
-- full JSON data exports).
--
-- THE FIX: an `Upload` ownership registry. Every file written through
-- lib/storage is recorded here with its uploader (userId) and intended
-- purpose at upload time; the retrieval route authorizes by ownership
-- (owner, or an ADMIN_EMAILS admin with an audit log line — fail closed
-- when the allowlist is empty), and answers 404 for everyone else so key
-- existence is not oracle-able.
--
-- `expiresAt` implements the retention policy: transient uploads (menu
-- extraction, failed / not-configured analysis) expire after
-- UPLOAD_TEMP_RETENTION_HOURS (default 24h) and are purged — file deleted
-- then row deleted — by the admin-gated POST /api/uploads/purge. Uploads
-- tied to a user record (scan, data_export) have no expiry and live until
-- the record / account is deleted (cascade on user delete).
--
-- Additive only: one brand-new table. No existing tables, columns, or
-- indexes touched. No backfill: uploads saved before v21.8 resolve their
-- owner at read time from the requesting user's own FoodScan / DataExport
-- rows (see resolveUploadOwner in apps/web/lib/uploads.ts).
CREATE TABLE "Upload" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Upload_key_key" ON "Upload"("key");
CREATE INDEX "Upload_userId_idx" ON "Upload"("userId");
CREATE INDEX "Upload_expiresAt_idx" ON "Upload"("expiresAt");
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
