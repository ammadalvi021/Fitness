/**
 * v21.8 PRIORITY 7 — upload ownership and retention.
 *
 * Pure unit tests for apps/web/lib/uploads.ts: mocked DB delegate,
 * temp-dir file storage. No database involved — runs everywhere,
 * including this VM.
 *
 * Covered:
 * - Another authenticated user cannot fetch a different user's upload
 *   with a known key (decision + resolution layers).
 * - Owner can fetch their own upload.
 * - Purpose/uploader recorded at upload time (saveOwnedUpload).
 * - Retention: temp-file cleanup logic (purgeExpiredUploads,
 *   markUploadTemporary), transient marking after failed analysis.
 * - Admin override: allowed only via ADMIN_EMAILS, and audit-logged
 *   without file contents.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditUploadAccess,
  decideUploadAccess,
  isUploadPurpose,
  markUploadTemporary,
  purgeExpiredUploads,
  recordUpload,
  resolveUploadOwner,
  saveOwnedUpload,
  tempRetentionMs,
  uploadUrlFor,
  type UploadAccessAudit,
  type UploadDb,
} from '@/lib/uploads';
import { getUploadPath } from '@/lib/storage';

interface ScanRow {
  userId: string;
  imageUrl: string;
}
interface ExportRow {
  userId: string;
  fileUrl: string;
}

function mockDb() {
  const rows = new Map<string, any>();
  const scans: ScanRow[] = [];
  const exports: ExportRow[] = [];
  const db: UploadDb = {
    upload: {
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, createdAt: new Date() };
        rows.set(data.key, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.key) ?? null),
      findMany: vi.fn(async ({ where }: any) =>
        [...rows.values()]
          .filter((r) => r.expiresAt && r.expiresAt <= where.expiresAt.lte)
          .map((r) => ({ key: r.key, expiresAt: r.expiresAt })),
      ),
      delete: vi.fn(async ({ where }: any) => {
        rows.delete(where.key);
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const r = rows.get(where.key);
        if (r) Object.assign(r, data);
      }),
    },
    foodScan: {
      findFirst: vi.fn(
        async ({ where }: any) =>
          scans.find(
            (s) => s.userId === where.userId && s.imageUrl === where.imageUrl,
          ) ?? null,
      ),
    },
    dataExport: {
      findFirst: vi.fn(
        async ({ where }: any) =>
          exports.find(
            (e) => e.userId === where.userId && e.fileUrl === where.fileUrl,
          ) ?? null,
      ),
    },
  };
  return { db, rows, scans, exports };
}

let storageDir = '';
const OLD_ENV = { ...process.env };

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'ff-upload-test-'));
  process.env.STORAGE_LOCAL_DIR = storageDir;
  delete process.env.ADMIN_EMAILS;
  delete process.env.UPLOAD_TEMP_RETENTION_HOURS;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

const OWNER = 'user-owner-1';
const STRANGER = 'user-stranger-2';
const ADMIN = 'admin@example.com';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // not a real PNG, storage layer doesn't sniff

describe('decideUploadAccess', () => {
  it('owner is allowed via owner', () => {
    expect(
      decideUploadAccess({ requesterId: OWNER, ownerId: OWNER }),
    ).toEqual({ allowed: true, via: 'owner' });
  });

  it('another authenticated user is denied even with a known key', () => {
    expect(
      decideUploadAccess({ requesterId: STRANGER, ownerId: OWNER }),
    ).toEqual({ allowed: false, via: null });
  });

  it('admin allowlist member is allowed via admin', () => {
    process.env.ADMIN_EMAILS = ADMIN;
    expect(
      decideUploadAccess({
        requesterId: STRANGER,
        requesterEmail: ADMIN,
        ownerId: OWNER,
      }),
    ).toEqual({ allowed: true, via: 'admin' });
  });

  it('admin check is case-insensitive', () => {
    process.env.ADMIN_EMAILS = 'Admin@Example.com';
    expect(
      decideUploadAccess({
        requesterId: STRANGER,
        requesterEmail: 'admin@example.com',
        ownerId: OWNER,
      }),
    ).toEqual({ allowed: true, via: 'admin' });
  });

  it('empty admin list means NO ONE gets admin access (fail closed)', () => {
    process.env.ADMIN_EMAILS = '';
    expect(
      decideUploadAccess({
        requesterId: STRANGER,
        requesterEmail: ADMIN,
        ownerId: OWNER,
      }),
    ).toEqual({ allowed: false, via: null });
  });

  it('missing email cannot claim admin access', () => {
    process.env.ADMIN_EMAILS = ADMIN;
    expect(
      decideUploadAccess({
        requesterId: STRANGER,
        requesterEmail: null,
        ownerId: OWNER,
      }),
    ).toEqual({ allowed: false, via: null });
  });

  it('ownership requires exact id match', () => {
    expect(
      decideUploadAccess({ requesterId: `${OWNER}-x`, ownerId: OWNER }),
    ).toEqual({ allowed: false, via: null });
  });
});

describe('tempRetentionMs', () => {
  it('defaults to 24h', () => {
    expect(tempRetentionMs()).toBe(24 * 3600 * 1000);
  });

  it('honors UPLOAD_TEMP_RETENTION_HOURS', () => {
    process.env.UPLOAD_TEMP_RETENTION_HOURS = '1';
    expect(tempRetentionMs()).toBe(3600 * 1000);
  });

  it('falls back to default on invalid values', () => {
    for (const v of ['0', '-5', 'nope', '']) {
      process.env.UPLOAD_TEMP_RETENTION_HOURS = v;
      expect(tempRetentionMs()).toBe(24 * 3600 * 1000);
    }
  });
});

describe('isUploadPurpose', () => {
  it('accepts the known purposes only', () => {
    expect(isUploadPurpose('scan')).toBe(true);
    expect(isUploadPurpose('menu_extract')).toBe(true);
    expect(isUploadPurpose('data_export')).toBe(true);
    expect(isUploadPurpose('avatar')).toBe(false);
    expect(isUploadPurpose('')).toBe(false);
  });
});

describe('saveOwnedUpload', () => {
  it('records uploader + purpose at upload time and persists the file', async () => {
    const { db, rows } = mockDb();
    const saved = await saveOwnedUpload(db, OWNER, PNG, {
      mime: 'image/png',
      prefix: 'scans',
      purpose: 'scan',
    });
    expect(saved.url).toBe(uploadUrlFor(saved.key));
    expect(existsSync(getUploadPath(saved.key))).toBe(true);

    const row = rows.get(saved.key);
    expect(row).toBeDefined();
    expect(row.userId).toBe(OWNER);
    expect(row.purpose).toBe('scan');
    expect(row.mime).toBe('image/png');
    expect(row.byteSize).toBe(PNG.byteLength);
    expect(row.expiresAt).toBeNull();
    expect(db.upload.create).toHaveBeenCalledTimes(1);
  });

  it('sets expiresAt when ttlMs is given (transient upload)', async () => {
    const { db, rows } = mockDb();
    const now = Date.now();
    const saved = await saveOwnedUpload(db, OWNER, PNG, {
      mime: 'image/png',
      prefix: 'menus',
      purpose: 'menu_extract',
      ttlMs: 3600 * 1000,
      now,
    });
    const row = rows.get(saved.key);
    expect(row.expiresAt).toEqual(new Date(now + 3600 * 1000));
    expect(saved.expiresAt).toEqual(new Date(now + 3600 * 1000));
  });

  it('rejects an unknown purpose before writing anything', async () => {
    const { db } = mockDb();
    await expect(
      saveOwnedUpload(db, OWNER, PNG, {
        mime: 'image/png',
        purpose: 'avatar' as any,
      }),
    ).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    expect(db.upload.create).not.toHaveBeenCalled();
  });

  it('removes the file when the registry write fails (no orphan uploads)', async () => {
    const { db } = mockDb();
    (db.upload.create as any).mockRejectedValueOnce(new Error('db down'));
    let key = '';
    // Capture the key by spying on the storage write indirectly: recompute
    // from the create call's absence is impossible, so catch the key from
    // the error path via a second mock that records then throws.
    const failingDb: UploadDb = {
      ...db,
      upload: {
        ...db.upload,
        create: vi.fn(async ({ data }: any) => {
          key = data.key;
          throw new Error('db down');
        }),
      },
    };
    await expect(
      saveOwnedUpload(failingDb, OWNER, PNG, {
        mime: 'image/png',
        purpose: 'scan',
      }),
    ).rejects.toThrow('db down');
    expect(key).not.toBe('');
    expect(existsSync(getUploadPath(key))).toBe(false);
  });
});

describe('resolveUploadOwner', () => {
  it('registry row: returns the recorded owner', async () => {
    const { db } = mockDb();
    await recordUpload(db, {
      userId: OWNER,
      key: 'scans-abc123.png',
      purpose: 'scan',
      mime: 'image/png',
      byteSize: 4,
    });
    const res = await resolveUploadOwner(db, 'scans-abc123.png', OWNER);
    expect(res).toEqual({
      ownerId: OWNER,
      purpose: 'scan',
      key: 'scans-abc123.png',
    });
  });

  it('registry row owned by someone else resolves to THEM (decision layer denies)', async () => {
    const { db } = mockDb();
    await recordUpload(db, {
      userId: OWNER,
      key: 'scans-abc123.png',
      purpose: 'scan',
      mime: 'image/png',
      byteSize: 4,
    });
    const res = await resolveUploadOwner(db, 'scans-abc123.png', STRANGER);
    expect(res?.ownerId).toBe(OWNER);
    expect(
      decideUploadAccess({ requesterId: STRANGER, ownerId: res!.ownerId }),
    ).toEqual({ allowed: false, via: null });
  });

  it('unknown key resolves to null (deny)', async () => {
    const { db } = mockDb();
    expect(await resolveUploadOwner(db, 'nope.png', OWNER)).toBeNull();
  });

  it('legacy scan URL on the requester’s own FoodScan resolves + self-heals', async () => {
    const { db, rows, scans } = mockDb();
    scans.push({ userId: OWNER, imageUrl: '/api/uploads/scans-legacy.png' });
    const res = await resolveUploadOwner(db, 'scans-legacy.png', OWNER);
    expect(res).toEqual({
      ownerId: OWNER,
      purpose: 'scan',
      key: 'scans-legacy.png',
    });
    // Self-healed registry row for next time.
    const healed = rows.get('scans-legacy.png');
    expect(healed).toBeDefined();
    expect(healed.userId).toBe(OWNER);
    expect(healed.purpose).toBe('scan');
    expect(healed.expiresAt).toBeNull();
  });

  it('another user’s scan record never resolves for the requester', async () => {
    const { db, scans } = mockDb();
    scans.push({ userId: OWNER, imageUrl: '/api/uploads/scans-legacy.png' });
    expect(await resolveUploadOwner(db, 'scans-legacy.png', STRANGER)).toBeNull();
  });

  it('legacy data-export URL on the requester’s own DataExport resolves + self-heals', async () => {
    const { db, rows, exports } = mockDb();
    exports.push({ userId: OWNER, fileUrl: '/api/uploads/exports-legacy.json' });
    const res = await resolveUploadOwner(db, 'exports-legacy.json', OWNER);
    expect(res?.ownerId).toBe(OWNER);
    expect(res?.purpose).toBe('data_export');
    expect(rows.get('exports-legacy.json')?.purpose).toBe('data_export');
  });
});

describe('markUploadTemporary', () => {
  it('sets expiresAt to now + ttl (failed-analysis path)', async () => {
    const { db, rows } = mockDb();
    await recordUpload(db, {
      userId: OWNER,
      key: 'scans-failed.png',
      purpose: 'scan',
      mime: 'image/png',
      byteSize: 4,
    });
    const now = Date.now();
    await markUploadTemporary(db, 'scans-failed.png', 3600 * 1000, now);
    expect(rows.get('scans-failed.png').expiresAt).toEqual(
      new Date(now + 3600 * 1000),
    );
  });
});

describe('purgeExpiredUploads', () => {
  it('deletes only expired files + rows; keeps record-associated uploads', async () => {
    const { db, rows } = mockDb();
    const now = new Date('2026-10-16T12:00:00Z');

    const expired = await saveOwnedUpload(db, OWNER, PNG, {
      mime: 'image/png',
      prefix: 'menus',
      purpose: 'menu_extract',
      ttlMs: 1000,
      now: now.getTime() - 2000,
    });
    const fresh = await saveOwnedUpload(db, OWNER, PNG, {
      mime: 'image/png',
      prefix: 'menus',
      purpose: 'menu_extract',
      ttlMs: 24 * 3600 * 1000,
      now: now.getTime(),
    });
    const kept = await saveOwnedUpload(db, OWNER, PNG, {
      mime: 'image/png',
      prefix: 'scans',
      purpose: 'scan',
    });

    const result = await purgeExpiredUploads(db, { now });
    expect(result).toEqual({ scanned: 1, expired: 1, deleted: 1, failed: 0 });

    expect(existsSync(getUploadPath(expired.key))).toBe(false);
    expect(rows.has(expired.key)).toBe(false);

    expect(existsSync(getUploadPath(fresh.key))).toBe(true);
    expect(rows.has(fresh.key)).toBe(true);

    expect(existsSync(getUploadPath(kept.key))).toBe(true);
    expect(rows.has(kept.key)).toBe(true);
  });

  it('a failing delete is counted, not fatal', async () => {
    const { db, rows } = mockDb();
    const now = new Date();
    const bad = await saveOwnedUpload(db, OWNER, PNG, {
      mime: 'image/png',
      purpose: 'scan',
      ttlMs: 1,
      now: now.getTime() - 1000,
    });
    const result = await purgeExpiredUploads(db, {
      now,
      deleteFile: async () => {
        throw new Error('disk gone');
      },
    });
    expect(result).toEqual({ scanned: 1, expired: 1, deleted: 0, failed: 1 });
    expect(rows.has(bad.key)).toBe(true);
  });

  it('no expired uploads -> no-op', async () => {
    const { db } = mockDb();
    await saveOwnedUpload(db, OWNER, PNG, {
      mime: 'image/png',
      purpose: 'scan',
    });
    expect(await purgeExpiredUploads(db, { now: new Date() })).toEqual({
      scanned: 0,
      expired: 0,
      deleted: 0,
      failed: 0,
    });
  });
});

describe('auditUploadAccess', () => {
  it('logs key + metadata only — never file contents or secrets', () => {
    const seen: UploadAccessAudit[] = [];
    auditUploadAccess(
      (e) => {
        seen.push(e);
      },
      {
        requesterId: STRANGER,
        uploadKey: 'scans-abc123.png',
        purpose: 'scan',
        via: 'admin',
      },
    );
    expect(seen).toHaveLength(1);
    const entry = seen[0];
    expect(entry.event).toBe('upload_access');
    expect(entry.requesterId).toBe(STRANGER);
    expect(entry.uploadKey).toBe('scans-abc123.png');
    expect(entry.purpose).toBe('scan');
    expect(entry.via).toBe('admin');
    expect(typeof entry.at).toBe('string');
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('89,80,78,71');
    expect(Object.keys(entry).sort()).toEqual(
      ['at', 'event', 'purpose', 'requesterId', 'uploadKey', 'via'].sort(),
    );
  });
});
