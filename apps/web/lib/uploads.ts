/**
 * Upload ownership registry, access authorization, and retention.
 *
 * DEFECT (v21.8 PRIORITY 7): GET /api/uploads/[key] only verified that the
 * requester was authenticated — any authenticated user who knew or guessed
 * a storage key could fetch another user's upload.
 *
 * FIX: every file written through lib/storage is recorded in the `Upload`
 * table with its uploader (`userId`) and intended purpose at upload time
 * (see `saveOwnedUpload`). Retrieval resolves the key to an owner
 * (`resolveUploadOwner`) and authorizes by ownership (`decideUploadAccess`):
 * the uploader, or an `ADMIN_EMAILS` admin whose access is audit-logged.
 * Anyone else gets 404 so key existence is not oracle-able.
 *
 * RETENTION POLICY (documented, enforced):
 * - purpose "scan" / "data_export": kept until the owning record (or the
 *   whole account) is deleted. `expiresAt` stays null.
 * - purpose "menu_extract", and scan uploads whose analysis failed or ran
 *   with no AI configured: transient. `expiresAt` is set to
 *   `UPLOAD_TEMP_RETENTION_HOURS` (default 24h) after upload; the
 *   admin-gated POST /api/uploads/purge deletes the file and then its
 *   registry row. Deployments should invoke the purge on a schedule.
 * - Expiry is ALSO enforced at serve time: GET /api/uploads/[key] returns
 *   404 for an expired registry row even if the purge job hasn't run yet
 *   (see `uploadIsExpired`).
 *
 * DELETION SEMANTICS (v21.8 PRIORITY 3):
 * - Storage delete is idempotent: an already-missing file (ENOENT /
 *   S3 NoSuchKey) counts as success.
 * - A GENUINE storage failure throws; the registry row is NEVER deleted
 *   when storage deletion fails (the row stays, the error surfaces in the
 *   purge counts and logs). The next purge retry re-attempts only keys
 *   whose rows still exist — retry-safe.
 *
 * PRIVACY: audit entries carry key + metadata only — never file contents,
 * never secrets.
 */
import { isAdminEmail } from './admin';
import {
  UploadError,
  deleteUpload,
  saveUpload,
  type SaveUploadOptions,
  type SavedUpload,
} from './storage';

/** Intended purposes recorded at upload time. */
export const UPLOAD_PURPOSES = ['scan', 'menu_extract', 'data_export'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export function isUploadPurpose(p: string): p is UploadPurpose {
  return (UPLOAD_PURPOSES as readonly string[]).includes(p);
}

/**
 * Transient-file retention window in ms.
 * `UPLOAD_TEMP_RETENTION_HOURS` env override, default 24h.
 */
export function tempRetentionMs(): number {
  const h = Number(process.env.UPLOAD_TEMP_RETENTION_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 3600 * 1000;
}

export interface UploadRecord {
  key: string;
  userId: string;
  purpose: string;
  mime: string;
  byteSize: number;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * Minimal database surface this module needs. The real Prisma client
 * satisfies it; tests inject a mock. Keeps this module free of a hard
 * `@fitfusion/db` import so the logic stays unit-testable.
 */
export interface UploadDb {
  upload: {
    create(args: {
      data: {
        key: string;
        userId: string;
        purpose: string;
        mime: string;
        byteSize: number;
        expiresAt?: Date | null;
      };
    }): Promise<unknown>;
    findUnique(args: { where: { key: string } }): Promise<UploadRecord | null>;
    findMany(args: {
      where: { expiresAt: { lte: Date } };
      select: { key: true; expiresAt?: true };
    }): Promise<Array<{ key: string; expiresAt: Date | null }>>;
    delete(args: { where: { key: string } }): Promise<unknown>;
    update(args: {
      where: { key: string };
      data: { expiresAt: Date | null };
    }): Promise<unknown>;
  };
  foodScan: {
    findFirst(args: {
      where: { userId: string; imageUrl: string };
      select: { imageUrl: true };
    }): Promise<{ imageUrl: string | null } | null>;
  };
  dataExport: {
    findFirst(args: {
      where: { userId: string; fileUrl: string };
      select: { fileUrl: true };
    }): Promise<{ fileUrl: string | null } | null>;
  };
}

/** Public URL served by GET /api/uploads/[key] for a storage key. */
export function uploadUrlFor(key: string): string {
  return `/api/uploads/${key}`;
}

export interface RecordUploadInput {
  userId: string;
  key: string;
  purpose: UploadPurpose;
  mime: string;
  byteSize: number;
  expiresAt?: Date | null;
}

/** Record the uploader + purpose for an already-saved file. */
export async function recordUpload(
  db: UploadDb,
  input: RecordUploadInput,
): Promise<void> {
  await db.upload.create({
    data: {
      key: input.key,
      userId: input.userId,
      purpose: input.purpose,
      mime: input.mime,
      byteSize: input.byteSize,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export interface SaveOwnedUploadOptions extends SaveUploadOptions {
  purpose: UploadPurpose;
  /** When set, the file is transient: eligible for purge after this many ms. */
  ttlMs?: number;
  /** Clock override (tests). */
  now?: number;
}

/**
 * Validate + persist an upload AND record its owner/purpose atomically
 * enough: if the registry write fails, the file is removed so no upload
 * ever exists without an owner record.
 */
export async function saveOwnedUpload(
  db: UploadDb,
  userId: string,
  data: Buffer,
  opts: SaveOwnedUploadOptions,
): Promise<SavedUpload & { expiresAt: Date | null }> {
  if (!isUploadPurpose(opts.purpose)) {
    throw new UploadError(
      'validation_error',
      `Unknown upload purpose: ${opts.purpose}`,
      400,
    );
  }
  const saved = await saveUpload(data, opts);
  const expiresAt =
    opts.ttlMs != null ? new Date((opts.now ?? Date.now()) + opts.ttlMs) : null;
  try {
    await recordUpload(db, {
      userId,
      key: saved.key,
      purpose: opts.purpose,
      mime: opts.mime,
      byteSize: data.byteLength,
      expiresAt,
    });
  } catch (e) {
    // Never orphan a file without an owner record. The rollback delete is
    // best-effort: it must not mask the registry failure that caused it.
    try {
      await deleteUpload(saved.key);
    } catch {
      /* original registry error below is what surfaces */
    }
    throw e;
  }
  return { ...saved, expiresAt };
}

/** Mark an existing upload transient (purge-eligible after `ttlMs`). */
export async function markUploadTemporary(
  db: UploadDb,
  key: string,
  ttlMs: number,
  now?: number,
): Promise<void> {
  await db.upload.update({
    where: { key },
    data: { expiresAt: new Date((now ?? Date.now()) + ttlMs) },
  });
}

export interface UploadResolution {
  ownerId: string;
  purpose: string;
  key: string;
}

/**
 * Resolve a storage key to its owner for the requesting user.
 *
 * 1. `Upload` registry row -> owner (the v21.8 path).
 * 2. Legacy fallback for pre-v21.8 files: ownership derived from the
 *    requester's OWN FoodScan / DataExport rows whose stored URL matches
 *    this key. On a match the registry row is self-healed so the next
 *    lookup takes path 1. The lookup is always scoped to the requester —
 *    another user's records can never resolve here.
 * 3. Otherwise null (unknown key -> deny).
 */
export async function resolveUploadOwner(
  db: UploadDb,
  key: string,
  requesterUserId: string,
): Promise<UploadResolution | null> {
  const row = await db.upload.findUnique({ where: { key } });
  if (row) {
    return { ownerId: row.userId, purpose: row.purpose, key };
  }
  const url = uploadUrlFor(key);
  const scan = await db.foodScan.findFirst({
    where: { userId: requesterUserId, imageUrl: url },
    select: { imageUrl: true },
  });
  if (scan) {
    await recordUpload(db, {
      userId: requesterUserId,
      key,
      purpose: 'scan',
      mime: 'unknown',
      byteSize: 0,
      expiresAt: null,
    });
    return { ownerId: requesterUserId, purpose: 'scan', key };
  }
  const exp = await db.dataExport.findFirst({
    where: { userId: requesterUserId, fileUrl: url },
    select: { fileUrl: true },
  });
  if (exp) {
    await recordUpload(db, {
      userId: requesterUserId,
      key,
      purpose: 'data_export',
      mime: 'unknown',
      byteSize: 0,
      expiresAt: null,
    });
    return { ownerId: requesterUserId, purpose: 'data_export', key };
  }
  return null;
}

export type UploadAccessVia = 'owner' | 'admin';

export interface UploadAccessDecision {
  allowed: boolean;
  via: UploadAccessVia | null;
}

/**
 * Pure access decision. The owner always wins; an ADMIN_EMAILS admin is
 * allowed (their access must be audit-logged by the caller); everyone else
 * is denied. Fail closed: empty admin list means no admin access.
 */
export function decideUploadAccess(input: {
  requesterId: string;
  requesterEmail?: string | null;
  ownerId: string;
}): UploadAccessDecision {
  if (input.requesterId === input.ownerId) {
    return { allowed: true, via: 'owner' };
  }
  if (isAdminEmail(input.requesterEmail)) {
    return { allowed: true, via: 'admin' };
  }
  return { allowed: false, via: null };
}

export interface UploadAccessAudit {
  event: 'upload_access';
  requesterId: string;
  uploadKey: string;
  purpose: string;
  via: UploadAccessVia;
  at: string;
}

export type UploadAuditLogFn = (entry: UploadAccessAudit) => void;

/**
 * Default audit sink: structured server log. Carries key + metadata ONLY —
 * never file contents, never secrets.
 */
export function defaultUploadAuditLog(entry: UploadAccessAudit): void {
  console.info(JSON.stringify({ service: 'fitfusion', ...entry }));
}

/** Audit-log an authorized upload access (used for admin overrides). */
export function auditUploadAccess(
  log: UploadAuditLogFn = defaultUploadAuditLog,
  input: {
    requesterId: string;
    uploadKey: string;
    purpose: string;
    via: UploadAccessVia;
  },
): void {
  log({
    event: 'upload_access',
    requesterId: input.requesterId,
    uploadKey: input.uploadKey,
    purpose: input.purpose,
    via: input.via,
    at: new Date().toISOString(),
  });
}

/**
 * Fetch the full registry row for a key (used by GET /api/uploads/[key] to
 * enforce expiry at serve time). Null when the key is unknown.
 */
export async function getUploadRecord(
  db: UploadDb,
  key: string,
): Promise<UploadRecord | null> {
  return db.upload.findUnique({ where: { key } });
}

/**
 * True when the upload is transient AND its expiry has passed.
 * GET /api/uploads/[key] must 404 on expired rows even if the purge job
 * hasn't run yet. Pure — takes a clock for tests.
 */
export function uploadIsExpired(
  record: Pick<UploadRecord, 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  return (
    record.expiresAt instanceof Date && record.expiresAt.getTime() <= now.getTime()
  );
}

/**
 * Retention sweep: delete every file whose `expiresAt` has passed, then
 * remove its registry row. Per-row best effort; returns full counts and
 * logs a structured summary (observable).
 *
 * Deletion semantics (idempotent + retry-safe):
 * - Already-missing file (ENOENT / S3 NoSuchKey) = success: the row is
 *   removed.
 * - GENUINE storage failure: the row is KEPT, the failure is counted and
 *   logged, and the sweep continues. Re-running the purge only touches
 *   rows that still exist, so retries converge without double-deletes.
 *
 * Uploads with null `expiresAt` (record-associated) are never touched.
 */
export async function purgeExpiredUploads(
  db: UploadDb,
  opts?: {
    now?: Date;
    deleteFile?: (key: string) => Promise<void>;
  },
): Promise<{ scanned: number; expired: number; deleted: number; failed: number }> {
  const now = opts?.now ?? new Date();
  const nowMs = now.getTime();
  const deleteFile = opts?.deleteFile ?? deleteUpload;
  const candidates = await db.upload.findMany({
    where: { expiresAt: { lte: now } },
    select: { key: true, expiresAt: true },
  });
  let scanned = 0;
  let expired = 0;
  let deleted = 0;
  let failed = 0;
  for (const { key, expiresAt } of candidates) {
    scanned += 1;
    // Re-verify per row: guards against clock skew between the DB query
    // and this process, so a row can never be swept early.
    if (!(expiresAt instanceof Date) || expiresAt.getTime() > nowMs) {
      continue;
    }
    expired += 1;
    try {
      await deleteFile(key);
      await db.upload.delete({ where: { key } });
      deleted += 1;
    } catch (e) {
      // Registry row is NEVER deleted on storage failure: it stays for
      // the next retry. The error surfaces via counts + the log below.
      failed += 1;
      console.warn(
        JSON.stringify({
          service: 'fitfusion',
          event: 'upload_purge_failed',
          uploadKey: key,
          error: e instanceof Error ? e.message : String(e),
          at: new Date().toISOString(),
        }),
      );
    }
  }
  console.info(
    JSON.stringify({
      service: 'fitfusion',
      event: 'upload_purge_sweep',
      scanned,
      expired,
      deleted,
      failed,
      at: new Date().toISOString(),
    }),
  );
  return { scanned, expired, deleted, failed };
}
