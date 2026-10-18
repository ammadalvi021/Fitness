/**
 * v21.8 PRIORITY 3 — expiry and deletion behavior.
 *
 * Route-level + service-level tests for GET /api/uploads/[key] and
 * purgeExpiredUploads. Prisma and the auth gate are mocked; the real
 * storage lib writes to a temp dir (local driver). No database required.
 *
 * Covered:
 * - GET: expired registry row -> 404 even if the purge job hasn't run
 *   (file still on disk); expiresAt exactly now -> 404; fresh row -> 200.
 * - GET serves bytes with Cache-Control: private, no-store.
 * - Owner authorization still enforced: non-owner -> 404, unknown key ->
 *   404, unauthenticated -> 401.
 * - Deletion error keeps the registry row (failed counted, row stays).
 * - Missing file -> successful delete (idempotent); purge removes the row.
 * - Retry purge is safe: re-running touches nothing already gone.
 * - Purge is observable: returns { scanned, expired, deleted, failed }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => {
  const rows = new Map<string, any>();
  const upload = {
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
  };
  return {
    mocks: {
      prisma: {
        upload,
        foodScan: { findFirst: vi.fn(async () => null) },
        dataExport: { findFirst: vi.fn(async () => null) },
      },
      upload,
      rows,
    },
  };
});

vi.mock('@fitfusion/db', () => ({ prisma: mocks.prisma }));

const OWNER_SESSION = {
  user: { id: 'user-owner', email: 'owner@example.com', name: 'Owner' },
  profile: null,
  subscription: null,
};
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => OWNER_SESSION),
}));

import { requireUser } from '@/lib/auth';
import { GET } from '@/app/api/uploads/[key]/route';
import { getUploadPath } from '@/lib/storage';
import {
  purgeExpiredUploads,
  saveOwnedUpload,
  uploadIsExpired,
  type UploadDb,
} from '@/lib/uploads';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OWNER = 'user-owner';
const STRANGER = 'user-stranger';

const OLD_ENV = { ...process.env };
let storageDir = '';

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'ff-expiry-test-'));
  process.env.STORAGE_LOCAL_DIR = storageDir;
  delete process.env.STORAGE_DRIVER;
  delete process.env.ADMIN_EMAILS;
  mocks.rows.clear();
  vi.mocked(requireUser).mockResolvedValue(OWNER_SESSION as any);
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

const db = mocks.prisma as unknown as UploadDb;

function getRequest(key: string): { req: NextRequest; params: { key: string } } {
  return {
    req: new NextRequest(`http://localhost/api/uploads/${key}`),
    params: { key },
  };
}

async function uploadOwned(
  userId: string,
  opts: { purpose?: 'scan' | 'menu_extract' | 'data_export'; ttlMs?: number; now?: number } = {},
) {
  return saveOwnedUpload(db, userId, PNG, {
    mime: 'image/png',
    prefix: 'scans',
    purpose: opts.purpose ?? 'scan',
    ttlMs: opts.ttlMs,
    now: opts.now,
  });
}

describe('uploadIsExpired', () => {
  it('null expiresAt never expires', () => {
    expect(uploadIsExpired({ expiresAt: null })).toBe(false);
  });
  it('past expiresAt is expired', () => {
    expect(
      uploadIsExpired(
        { expiresAt: new Date('2026-10-01T00:00:00Z') },
        new Date('2026-10-16T00:00:00Z'),
      ),
    ).toBe(true);
  });
  it('expiresAt exactly now is expired (boundary)', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(uploadIsExpired({ expiresAt: now }, now)).toBe(true);
  });
  it('future expiresAt is not expired', () => {
    expect(
      uploadIsExpired(
        { expiresAt: new Date('2026-10-17T00:00:00Z') },
        new Date('2026-10-16T00:00:00Z'),
      ),
    ).toBe(false);
  });
});

describe('GET /api/uploads/[key] expiry enforcement', () => {
  it('expired upload -> 404 even if the purge job has not run (file still on disk)', async () => {
    const saved = await uploadOwned(OWNER, {
      purpose: 'menu_extract',
      ttlMs: 1000,
      now: Date.now() - 60_000,
    });
    expect(existsSync(getUploadPath(saved.key))).toBe(true);
    expect(mocks.rows.has(saved.key)).toBe(true);

    const { req, params } = getRequest(saved.key);
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('not_found');

    // Nothing was swept: the row and the file are still there for the purge.
    expect(mocks.rows.has(saved.key)).toBe(true);
    expect(existsSync(getUploadPath(saved.key))).toBe(true);
  });

  it('fresh transient upload -> 200 with private, no-store caching', async () => {
    const saved = await uploadOwned(OWNER, {
      purpose: 'menu_extract',
      ttlMs: 24 * 3600 * 1000,
    });
    const { req, params } = getRequest(saved.key);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(PNG)).toBe(true);
  });

  it('record-associated upload (expiresAt null) -> 200', async () => {
    const saved = await uploadOwned(OWNER, { purpose: 'scan' });
    const { req, params } = getRequest(saved.key);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/uploads/[key] authorization (still enforced)', () => {
  it('non-owner -> 404 (key existence not oracle-able)', async () => {
    const saved = await uploadOwned(OWNER);
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: STRANGER, email: 'stranger@example.com', name: 'Stranger' },
      profile: null,
      subscription: null,
    } as any);
    const { req, params } = getRequest(saved.key);
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  it('unknown key -> 404', async () => {
    const { req, params } = getRequest('nope-1234.png');
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  it('unauthenticated -> 401', async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json(
        { error: { code: 'unauthorized', message: 'Authentication required' } },
        { status: 401 },
      ) as any,
    );
    const { req, params } = getRequest('anything.png');
    const res = await GET(req, { params });
    expect(res.status).toBe(401);
  });
});

describe('purgeExpiredUploads deletion semantics', () => {
  it('deletion error keeps the registry row; failure is counted and surfaced', async () => {
    const saved = await uploadOwned(OWNER, {
      purpose: 'menu_extract',
      ttlMs: 1000,
      now: Date.now() - 60_000,
    });
    const result = await purgeExpiredUploads(db, {
      now: new Date(),
      deleteFile: async () => {
        throw new Error('disk gone');
      },
    });
    expect(result).toEqual({ scanned: 1, expired: 1, deleted: 0, failed: 1 });
    // NEVER delete the registry entry when storage deletion genuinely fails.
    expect(mocks.rows.has(saved.key)).toBe(true);
    expect(existsSync(getUploadPath(saved.key))).toBe(true);
  });

  it('already-missing file -> successful delete: the row is removed', async () => {
    const saved = await uploadOwned(OWNER, {
      purpose: 'menu_extract',
      ttlMs: 1000,
      now: Date.now() - 60_000,
    });
    // File vanished out of band (e.g. ephemeral disk wiped); storage delete
    // must treat ENOENT as success.
    rmSync(getUploadPath(saved.key), { force: true });
    const result = await purgeExpiredUploads(db, { now: new Date() });
    expect(result).toEqual({ scanned: 1, expired: 1, deleted: 1, failed: 0 });
    expect(mocks.rows.has(saved.key)).toBe(false);
  });

  it('retry purge is safe: re-running touches nothing already gone', async () => {
    const saved = await uploadOwned(OWNER, {
      purpose: 'menu_extract',
      ttlMs: 1000,
      now: Date.now() - 60_000,
    });
    let deleteCalls = 0;
    const deleteFile = async (key: string) => {
      deleteCalls += 1;
      const { deleteUpload } = await import('@/lib/storage');
      await deleteUpload(key);
    };
    const first = await purgeExpiredUploads(db, {
      now: new Date(),
      deleteFile,
    });
    expect(first.deleted).toBe(1);
    expect(deleteCalls).toBe(1);

    const second = await purgeExpiredUploads(db, {
      now: new Date(),
      deleteFile,
    });
    expect(second).toEqual({ scanned: 0, expired: 0, deleted: 0, failed: 0 });
    expect(deleteCalls).toBe(1); // no second attempt on the gone key
    expect(mocks.rows.has(saved.key)).toBe(false);
  });

  it('a failed row is retried (and can succeed) on the next purge', async () => {
    const saved = await uploadOwned(OWNER, {
      purpose: 'menu_extract',
      ttlMs: 1000,
      now: Date.now() - 60_000,
    });
    let fail = true;
    const deleteFile = async (key: string) => {
      if (fail) throw new Error('transient outage');
      const { deleteUpload } = await import('@/lib/storage');
      await deleteUpload(key);
    };
    const first = await purgeExpiredUploads(db, {
      now: new Date(),
      deleteFile,
    });
    expect(first).toEqual({ scanned: 1, expired: 1, deleted: 0, failed: 1 });
    expect(mocks.rows.has(saved.key)).toBe(true);

    fail = false;
    const second = await purgeExpiredUploads(db, {
      now: new Date(),
      deleteFile,
    });
    expect(second).toEqual({ scanned: 1, expired: 1, deleted: 1, failed: 0 });
    expect(mocks.rows.has(saved.key)).toBe(false);
    expect(existsSync(getUploadPath(saved.key))).toBe(false);
  });

  it('purge counts are observable and per-row independent', async () => {
    const good = await uploadOwned(OWNER, {
      purpose: 'menu_extract',
      ttlMs: 1000,
      now: Date.now() - 60_000,
    });
    const bad = await uploadOwned(OWNER, {
      purpose: 'menu_extract',
      ttlMs: 1000,
      now: Date.now() - 60_000,
    });
    const result = await purgeExpiredUploads(db, {
      now: new Date(),
      deleteFile: async (key: string) => {
        if (key === bad.key) throw new Error('disk gone');
      },
    });
    expect(result).toEqual({ scanned: 2, expired: 2, deleted: 1, failed: 1 });
    expect(mocks.rows.has(good.key)).toBe(false);
    expect(mocks.rows.has(bad.key)).toBe(true);
  });
});
