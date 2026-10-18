/**
 * FitFusion AI v21.8 — Priority 4: harden image handling.
 *
 * The food-scanner (POST /api/scans) and the restaurant-menu extractor
 * (POST /api/menus/extract) are the only routes that accept client images.
 * Prisma/auth/AI are mocked; the REAL storage, upload-registry, and
 * image-validation layers run against a temp dir. No database involved.
 *
 * Covered:
 * - Pure: magic-byte detection (JPEG/PNG/WEBP), manual dimension parsing
 *   (PNG IHDR, JPEG SOF markers, WEBP VP8/VP8L/VP8X), spoofed-MIME and
 *   truncated-byte rejection, Content-Length up-front guard, capped stream
 *   reads.
 * - Routes: oversized upload -> 413; text file claiming image/png -> 415;
 *   invalid image bytes -> 400; thrown AI error -> clean 502 + upload
 *   marked temporary (purge-eligible, file kept); failed DB write ->
 *   clean 500 + upload marked temporary; valid PNG/JPEG -> 200.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => {
  const uploadRows = new Map<string, any>();
  const upload = {
    create: vi.fn(async ({ data }: any) => {
      const row = { ...data, createdAt: new Date() };
      uploadRows.set(data.key, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = uploadRows.get(where.key);
      if (row) Object.assign(row, data);
      return row ?? null;
    }),
  };
  const foodScan = { create: vi.fn() };
  const analyzeFoodImage = vi.fn();
  return {
    mocks: {
      prisma: { upload, foodScan },
      upload,
      foodScan,
      uploadRows,
      analyzeFoodImage,
    },
  };
});

vi.mock('@fitfusion/db', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({
    user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    profile: null,
    subscription: null,
  })),
}));
vi.mock('@fitfusion/ai', () => ({
  analyzeFoodImage: mocks.analyzeFoodImage,
}));

import { POST as scansPOST } from '@/app/api/scans/route';
import { POST as extractPOST } from '@/app/api/menus/extract/route';
import {
  assertContentLengthOk,
  getUploadPath,
  maxUploadBytes,
  readCappedFile,
  UploadError,
} from '@/lib/storage';
import {
  detectImageType,
  parseImageDimensions,
  validateImageUpload,
} from '@/lib/image-validate';

/* ---------------- minimal valid image builders ---------------- */

function pngBytes(width: number, height: number, padTo = 0): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(4 + 4 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 2; // color type: truecolor
  const body = Buffer.concat([sig, ihdr]);
  return padTo > body.length
    ? Buffer.concat([body, Buffer.alloc(padTo - body.length)])
    : body;
}

function jpegBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(2 + 2 + 2 + 1 + 2 + 2 + 3 + 2);
  let o = 0;
  buf[o++] = 0xff;
  buf[o++] = 0xd8; // SOI
  buf[o++] = 0xff;
  buf[o++] = 0xc0; // SOF0
  buf.writeUInt16BE(11, o);
  o += 2; // segment length
  buf[o++] = 8; // precision
  buf.writeUInt16BE(height, o);
  o += 2;
  buf.writeUInt16BE(width, o);
  o += 2;
  buf[o++] = 1; // one component
  buf[o++] = 1;
  buf[o++] = 0x11;
  buf[o++] = 0;
  buf[o++] = 0xff;
  buf[o++] = 0xd9; // EOI
  return buf;
}

function webpVp8xBytes(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(8 + 10);
  chunk.write('VP8X', 0);
  chunk.writeUInt32LE(10, 4);
  chunk[8] = 0; // flags
  const w1 = width - 1;
  const h1 = height - 1;
  chunk[12] = w1 & 0xff;
  chunk[13] = (w1 >> 8) & 0xff;
  chunk[14] = (w1 >> 16) & 0xff;
  chunk[15] = h1 & 0xff;
  chunk[16] = (h1 >> 8) & 0xff;
  chunk[17] = (h1 >> 16) & 0xff;
  const head = Buffer.alloc(12);
  head.write('RIFF', 0);
  head.writeUInt32LE(4 + chunk.length, 4);
  head.write('WEBP', 8);
  return Buffer.concat([head, chunk]);
}

function webpVp8lBytes(width: number, height: number): Buffer {
  const w1 = width - 1;
  const h1 = height - 1;
  const payload = Buffer.from([
    0x2f,
    w1 & 0xff,
    ((w1 >> 8) & 0x3f) | ((h1 & 0x03) << 6),
    (h1 >> 2) & 0xff,
    (h1 >> 10) & 0x0f,
  ]);
  const chunk = Buffer.alloc(8 + payload.length);
  chunk.write('VP8L', 0);
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0);
  head.writeUInt32LE(4 + chunk.length, 4);
  head.write('WEBP', 8);
  return Buffer.concat([head, chunk]);
}

function webpVp8Bytes(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload.writeUInt16LE(width & 0x3fff, 6);
  payload.writeUInt16LE(height & 0x3fff, 8);
  const chunk = Buffer.alloc(8 + payload.length);
  chunk.write('VP8 ', 0);
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0);
  head.writeUInt32LE(4 + chunk.length, 4);
  head.write('WEBP', 8);
  return Buffer.concat([head, chunk]);
}

/* ---------------- test harness ---------------- */

let storageDir = '';
const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadRows.clear();
  mocks.foodScan.create.mockImplementation(async ({ data }: any) => ({
    id: 'scan-1',
    createdAt: new Date(),
    ...data,
  }));
  storageDir = mkdtempSync(join(tmpdir(), 'ff-img-harden-'));
  process.env.STORAGE_LOCAL_DIR = storageDir;
  delete process.env.UPLOAD_MAX_MB;
  delete process.env.UPLOAD_TEMP_RETENTION_HOURS;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

function imageRequest(
  url: string,
  bytes: Buffer,
  filename: string,
  mime: string,
): NextRequest {
  const fd = new FormData();
  fd.append('image', new File([bytes], filename, { type: mime }));
  return new NextRequest(url, { method: 'POST', body: fd });
}

const AI_OK_ITEM = {
  name: 'Apple',
  portion: '1 medium',
  kcalBest: 95,
  kcalLow: 80,
  kcalHigh: 110,
  proteinG: 0.5,
  carbsG: 25,
  fatG: 0.3,
  fiberG: 4.4,
  confidence: 'high',
  assumptions: [],
};
const AI_OK = {
  status: 'ok',
  items: [AI_OK_ITEM],
  overallConfidence: 'high',
  disclaimer: 'Estimates only.',
  model: 'vision-test',
};

function createdUploadKey(): string {
  return mocks.upload.create.mock.calls[0][0].data.key;
}

/* ---------------- pure: magic bytes + dimensions ---------------- */

describe('detectImageType', () => {
  it('sniffs JPEG / PNG / WEBP magic bytes', () => {
    expect(detectImageType(jpegBytes(32, 16))).toBe('jpeg');
    expect(detectImageType(pngBytes(32, 16))).toBe('png');
    expect(detectImageType(webpVp8xBytes(32, 16))).toBe('webp');
  });

  it('returns null for non-image bytes', () => {
    expect(
      detectImageType(Buffer.from('this is plain text, not an image', 'utf8')),
    ).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull(); // truncated magic
  });
});

describe('parseImageDimensions', () => {
  it('decodes PNG IHDR dimensions', () => {
    expect(parseImageDimensions(pngBytes(32, 16), 'png')).toEqual({
      width: 32,
      height: 16,
    });
  });

  it('decodes JPEG SOF0 dimensions', () => {
    expect(parseImageDimensions(jpegBytes(640, 480), 'jpeg')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('decodes WEBP VP8X / VP8L / VP8 dimensions', () => {
    expect(parseImageDimensions(webpVp8xBytes(100, 50), 'webp')).toEqual({
      width: 100,
      height: 50,
    });
    expect(parseImageDimensions(webpVp8lBytes(100, 50), 'webp')).toEqual({
      width: 100,
      height: 50,
    });
    expect(parseImageDimensions(webpVp8Bytes(100, 50), 'webp')).toEqual({
      width: 100,
      height: 50,
    });
  });

  it('returns null for truncated containers instead of throwing', () => {
    expect(parseImageDimensions(pngBytes(32, 16).subarray(0, 10), 'png')).toBeNull();
    expect(parseImageDimensions(Buffer.from([0xff, 0xd8, 0xff]), 'jpeg')).toBeNull();
  });
});

describe('validateImageUpload', () => {
  it('accepts a valid PNG with correct dimensions', () => {
    expect(validateImageUpload(pngBytes(32, 16), 'image/png')).toEqual({
      type: 'png',
      width: 32,
      height: 16,
    });
  });

  it('accepts a valid JPEG with correct dimensions', () => {
    expect(validateImageUpload(jpegBytes(640, 480), 'image/jpeg')).toEqual({
      type: 'jpeg',
      width: 640,
      height: 480,
    });
  });

  it('rejects a spoofed MIME type (text claiming image/png) with 415', () => {
    const text = Buffer.from('this is plain text, not an image', 'utf8');
    let err: unknown;
    try {
      validateImageUpload(text, 'image/png');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).status).toBe(415);
  });

  it('rejects mismatched magic vs declared type with 415 (JPEG bytes as image/png)', () => {
    let err: unknown;
    try {
      validateImageUpload(jpegBytes(32, 16), 'image/png');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).status).toBe(415);
  });

  it('rejects truncated image bytes with 400 invalid_image', () => {
    const truncatedPng = pngBytes(32, 16).subarray(0, 10); // magic ok, no IHDR
    let err: unknown;
    try {
      validateImageUpload(truncatedPng, 'image/png');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).code).toBe('invalid_image');
    expect((err as UploadError).status).toBe(400);
  });
});

describe('size guards', () => {
  it('maxUploadBytes defaults to 8 MB and honors UPLOAD_MAX_MB', () => {
    expect(maxUploadBytes()).toBe(8 * 1024 * 1024);
    process.env.UPLOAD_MAX_MB = '1';
    expect(maxUploadBytes()).toBe(1024 * 1024);
  });

  it('assertContentLengthOk throws 413 before any buffering when Content-Length exceeds the cap', () => {
    const req = new Request('http://x/api/scans', {
      method: 'POST',
      headers: { 'content-length': String(50 * 1024 * 1024) },
    });
    let err: unknown;
    try {
      assertContentLengthOk(req);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).code).toBe('file_too_large');
    expect((err as UploadError).status).toBe(413);
    // Under the cap: no throw.
    const ok = new Request('http://x/api/scans', {
      method: 'POST',
      headers: { 'content-length': '1024' },
    });
    expect(() => assertContentLengthOk(ok)).not.toThrow();
  });

  it('readCappedFile aborts the stream with 413 instead of buffering the whole file', async () => {
    const big = new File([Buffer.alloc(20 * 1024, 7)], 'big.png', {
      type: 'image/png',
    });
    await expect(readCappedFile(big, 1024)).rejects.toMatchObject({
      code: 'file_too_large',
      status: 413,
    });
    const small = new File([Buffer.from([1, 2, 3])], 'small.png', {
      type: 'image/png',
    });
    const out = await readCappedFile(small, 1024);
    expect(Buffer.from(out)).toEqual(Buffer.from([1, 2, 3]));
  });
});

/* ---------------- routes ---------------- */

describe('POST /api/scans — hardened upload preamble', () => {
  it('rejects an oversized upload with 413 before buffering', async () => {
    process.env.UPLOAD_MAX_MB = '0.01'; // ~10 KB cap for this test
    const png = pngBytes(32, 16, 20 * 1024); // valid PNG, ~20 KB
    const res = await scansPOST(
      imageRequest('http://x/api/scans', png, 'big.png', 'image/png'),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('file_too_large');
    // Nothing was persisted.
    expect(mocks.upload.create).not.toHaveBeenCalled();
  });

  it('rejects a spoofed MIME type (text file claiming image/png) with 415', async () => {
    const text = Buffer.from('this is plain text, not an image', 'utf8');
    const res = await scansPOST(
      imageRequest('http://x/api/scans', text, 'evil.png', 'image/png'),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe('unsupported_media_type');
    expect(mocks.upload.create).not.toHaveBeenCalled();
  });

  it('rejects invalid image bytes (truncated PNG) with 400', async () => {
    const truncated = pngBytes(32, 16).subarray(0, 10);
    const res = await scansPOST(
      imageRequest('http://x/api/scans', truncated, 'bad.png', 'image/png'),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_image');
    expect(mocks.upload.create).not.toHaveBeenCalled();
  });

  it('rejects a disallowed declared type with 415', async () => {
    const res = await scansPOST(
      imageRequest(
        'http://x/api/scans',
        Buffer.from('GIF89a', 'utf8'),
        'a.gif',
        'image/gif',
      ),
    );
    expect(res.status).toBe(415);
  });

  it('a thrown AI error becomes a clean 502 and the upload is marked temporary', async () => {
    mocks.analyzeFoodImage.mockRejectedValueOnce(new Error('provider exploded'));
    const res = await scansPOST(
      imageRequest(
        'http://x/api/scans',
        pngBytes(32, 16),
        'meal.png',
        'image/png',
      ),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('ai_error');

    // The upload was saved, then marked temporary (purge-eligible) — the
    // file itself is kept for the retention sweep, not deleted outright.
    const key = createdUploadKey();
    expect(mocks.upload.update).toHaveBeenCalledTimes(1);
    const updateArg = mocks.upload.update.mock.calls[0][0];
    expect(updateArg.where.key).toBe(key);
    const expiresAt: Date = updateArg.data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 24 * 3600 * 1000 + 60_000,
    );
    expect(existsSync(getUploadPath(key))).toBe(true);
    // No scan row was written.
    expect(mocks.foodScan.create).not.toHaveBeenCalled();
  });

  it('a failed DB write becomes a clean 500 and the upload is marked temporary', async () => {
    mocks.analyzeFoodImage.mockResolvedValueOnce(AI_OK);
    mocks.foodScan.create.mockRejectedValueOnce(new Error('db is down'));
    const res = await scansPOST(
      imageRequest(
        'http://x/api/scans',
        jpegBytes(640, 480),
        'meal.jpg',
        'image/jpeg',
      ),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('database_error');

    const key = createdUploadKey();
    expect(mocks.upload.update).toHaveBeenCalledTimes(1);
    expect(mocks.upload.update.mock.calls[0][0].where.key).toBe(key);
    expect(
      mocks.upload.update.mock.calls[0][0].data.expiresAt,
    ).toBeInstanceOf(Date);
  });

  it('a valid PNG passes with a permanent upload and a review scan', async () => {
    mocks.analyzeFoodImage.mockResolvedValueOnce(AI_OK);
    const res = await scansPOST(
      imageRequest(
        'http://x/api/scans',
        pngBytes(32, 16),
        'meal.png',
        'image/png',
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiConfigured).toBe(true);
    expect(body.scan.status).toBe('review');
    expect(body.scan.items).toHaveLength(1);
    expect(body.scan.items[0].name).toBe('Apple');
    // Successful analysis: the upload stays permanent (no temp marking).
    expect(mocks.upload.update).not.toHaveBeenCalled();
    const key = createdUploadKey();
    expect(existsSync(getUploadPath(key))).toBe(true);
  });

  it('a valid JPEG passes', async () => {
    mocks.analyzeFoodImage.mockResolvedValueOnce(AI_OK);
    const res = await scansPOST(
      imageRequest(
        'http://x/api/scans',
        jpegBytes(640, 480),
        'meal.jpg',
        'image/jpeg',
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).scan.status).toBe('review');
  });

  it('an AI error status still marks the upload temporary and returns 502', async () => {
    mocks.analyzeFoodImage.mockResolvedValueOnce({
      status: 'error',
      items: [],
      overallConfidence: null,
      disclaimer: 'Estimates only.',
      model: 'vision-test',
      error: 'Could not parse the AI response as JSON',
    });
    const res = await scansPOST(
      imageRequest(
        'http://x/api/scans',
        pngBytes(32, 16),
        'meal.png',
        'image/png',
      ),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('ai_error');
    expect(mocks.upload.update).toHaveBeenCalledTimes(1);
    // The failed scan row is still recorded for context.
    expect(mocks.foodScan.create).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/menus/extract — hardened upload preamble', () => {
  it('rejects a spoofed MIME type with 415 and persists nothing', async () => {
    const text = Buffer.from('not an image', 'utf8');
    const res = await extractPOST(
      imageRequest('http://x/api/menus/extract', text, 'menu.png', 'image/png'),
    );
    expect(res.status).toBe(415);
    expect(mocks.upload.create).not.toHaveBeenCalled();
  });

  it('a thrown AI error becomes a clean 502', async () => {
    mocks.analyzeFoodImage.mockRejectedValueOnce(new Error('boom'));
    const res = await extractPOST(
      imageRequest(
        'http://x/api/menus/extract',
        pngBytes(32, 16),
        'menu.png',
        'image/png',
      ),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('ai_error');
  });

  it('a valid PNG passes and returns extracted items', async () => {
    mocks.analyzeFoodImage.mockResolvedValueOnce({
      status: 'ok',
      items: [
        {
          name: 'Chicken Karahi',
          portion: '1 plate',
          confidence: 'high',
          assumptions: [],
          alternatives: [],
        },
      ],
      overallConfidence: 'high',
      disclaimer: 'Extraction reads the menu text only.',
      model: 'vision-test',
    });
    const res = await extractPOST(
      imageRequest(
        'http://x/api/menus/extract',
        pngBytes(32, 16),
        'menu.png',
        'image/png',
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiConfigured).toBe(true);
    expect(body.extracted).toHaveLength(1);
    expect(body.extracted[0].name).toBe('Chicken Karahi');
  });
});
