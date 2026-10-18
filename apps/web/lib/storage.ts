/**
 * Upload storage adapter.
 *
 * - `STORAGE_DRIVER=local` (default): writes files under STORAGE_LOCAL_DIR
 *   (default `./uploads`, resolved against the web app working directory)
 *   and serves them from `/api/uploads/<key>`. DEV-ONLY: Render's local
 *   filesystem is ephemeral, so uploads disappear on redeploy/restart.
 * - `STORAGE_DRIVER=s3`: real S3-compatible transport (see lib/storage-s3.ts)
 *   — SigV4-signed HTTPS REST, node:crypto + fetch, no AWS SDK.
 *   Config is validated at use time; missing vars throw
 *   UploadError('not_configured') naming the missing var NAMES.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { S3Client } from './storage-s3';

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Documented default cap for a single uploaded file's bytes.
 *
 * Matches the pre-existing convention: `UPLOAD_MAX_MB` env override,
 * default 8 MB. The effective cap is read via `maxUploadBytes()` so tests
 * and routes share one value. Routes check it BEFORE allocating the full
 * buffer (Content-Length up front, then a capped stream read) so an
 * oversized upload is rejected with 413 without ever buffering it.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Effective per-file upload cap in bytes (`UPLOAD_MAX_MB` override, default 8 MB). */
export function maxUploadBytes(): number {
  const mb = Number(process.env.UPLOAD_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 8) * 1024 * 1024;
}

export class UploadError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.status = status;
  }
}

export function storageDriver(): string {
  return (process.env.STORAGE_DRIVER || 'local').toLowerCase();
}

/** Absolute directory uploads are written to (local driver). */
export function getStorageDir(): string {
  const dir = process.env.STORAGE_LOCAL_DIR || './uploads';
  return path.resolve(process.cwd(), dir);
}

/**
 * Resolve a storage key to an absolute path inside the storage dir.
 * Throws UploadError on path traversal attempts.
 */
export function getUploadPath(key: string): string {
  const clean = String(key).replace(/^\/+/, '');
  const base = getStorageDir();
  const resolved = path.resolve(base, clean);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new UploadError('invalid_key', 'Invalid upload key', 400);
  }
  return resolved;
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'application/json':
      return '.json';
    default:
      return '';
  }
}

function uploadMaxBytes(): number {
  return maxUploadBytes();
}

/** Human-readable size for limit messages (MB, or KB when sub-megabyte). */
function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${Math.round((n / 1024 / 1024) * 10) / 10} MB`
    : `${Math.round(n / 1024)} KB`;
}

/**
 * Up-front request-size guard: reject with UploadError 413 when the
 * request's Content-Length already exceeds the cap, BEFORE the body is
 * parsed or buffered. A missing Content-Length is not a pass — the
 * streamed read (`readCappedFile`) still enforces the cap.
 */
export function assertContentLengthOk(req: Request, maxBytes?: number): void {
  const cap = maxBytes ?? maxUploadBytes();
  const raw = req.headers.get('content-length');
  if (raw == null) return;
  const n = Number(raw);
  if (Number.isFinite(n) && n > cap) {
    throw new UploadError(
      'file_too_large',
      `Request body exceeds the ${formatBytes(cap)} upload limit`,
      413,
    );
  }
}

/**
 * Read a multipart File's bytes with a hard cap enforced WHILE streaming,
 * so an oversized upload is aborted with 413 instead of being fully
 * buffered. The multipart `size` metadata is client-supplied; this is the
 * real enforcement.
 */
export async function readCappedFile(
  file: File,
  maxBytes?: number,
): Promise<Buffer> {
  const cap = maxBytes ?? maxUploadBytes();
  const stream = file.stream();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        throw new UploadError(
          'file_too_large',
          `File exceeds the ${formatBytes(cap)} upload limit`,
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await stream.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

/**
 * Build a validated S3 client. Throws UploadError('not_configured') naming
 * the missing env var NAMES (never secret values) when config is absent.
 * Dynamically imported so the local driver never pays for the S3 module.
 */
async function s3Client(): Promise<S3Client> {
  const { readS3Config, S3Client: Impl } = await import('./storage-s3');
  return new Impl(readS3Config());
}

/** Opaque single-segment storage key (shared by both drivers). */
function makeUploadKey(mime: string, prefix?: string): string {
  const safePrefix = (prefix ?? '')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 24);
  return `${safePrefix ? `${safePrefix}-` : ''}${crypto
    .randomBytes(16)
    .toString('hex')}${extForMime(mime)}`;
}

/** Shared payload validation: mime allow-list + size cap. */
function validateUploadPayload(data: Buffer, opts: SaveUploadOptions): void {
  const allowed = opts.allowedMimes ?? IMAGE_MIMES;
  if (!allowed.includes(opts.mime)) {
    throw new UploadError(
      'unsupported_media_type',
      `Unsupported media type: ${opts.mime}`,
      415,
    );
  }
  const maxBytes = uploadMaxBytes();
  if (data.byteLength > maxBytes) {
    throw new UploadError(
      'file_too_large',
      `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`,
      413,
    );
  }
}

export interface SaveUploadOptions {
  mime: string;
  /** Key namespace prefix, e.g. "scans". Kept single-segment (no "/"). */
  prefix?: string;
  /** Override the accepted mime list (default: images only). */
  allowedMimes?: string[];
}

export interface SavedUpload {
  /** Public URL served by GET /api/uploads/[key]. */
  url: string;
  /** Opaque single-segment storage key. */
  key: string;
}

/**
 * Validate and persist an upload buffer. Returns its public URL + key.
 * Throws UploadError with codes: not_configured, unsupported_media_type,
 * file_too_large, invalid_key, s3_error.
 */
export async function saveUpload(
  data: Buffer,
  opts: SaveUploadOptions,
): Promise<SavedUpload> {
  validateUploadPayload(data, opts);
  const driver = storageDriver();

  if (driver === 's3') {
    // Config validation happens here: missing S3_* vars throw
    // not_configured naming the missing var names.
    const client = await s3Client();
    const key = makeUploadKey(opts.mime, opts.prefix);
    await client.putObject(key, data, opts.mime);
    return { url: `/api/uploads/${key}`, key };
  }
  if (driver !== 'local') {
    throw new UploadError(
      'not_configured',
      `Unknown storage driver: ${driver}`,
      501,
    );
  }

  const key = makeUploadKey(opts.mime, opts.prefix);
  const filePath = getUploadPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  return { url: `/api/uploads/${key}`, key };
}

/**
 * Delete an upload's bytes.
 *
 * - Already-missing file (ENOENT / S3 404 NoSuchKey) = SUCCESS (idempotent).
 * - Genuine failure (permissions, network, 5xx, ...) THROWS.
 *
 * Callers that must never delete state on failure (purge sweep) rely on the
 * throw; callers that are best-effort (account teardown rollback) must catch.
 */
export async function deleteUpload(key: string): Promise<void> {
  const driver = storageDriver();
  if (driver === 's3') {
    await (await s3Client()).deleteObject(key);
    return;
  }
  if (driver !== 'local') {
    throw new UploadError(
      'not_configured',
      `Unknown storage driver: ${driver}`,
      501,
    );
  }
  try {
    await fs.unlink(getUploadPath(key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw new UploadError('storage_error', 'Failed to delete upload', 500);
  }
}

/** Read an upload's bytes; throws UploadError('not_found') when missing. */
export async function readUpload(key: string): Promise<Buffer> {
  const driver = storageDriver();
  if (driver === 's3') {
    return (await (await s3Client()).getObject(key)).data;
  }
  if (driver !== 'local') {
    throw new UploadError(
      'not_configured',
      `Unknown storage driver: ${driver}`,
      501,
    );
  }
  try {
    return await fs.readFile(getUploadPath(key));
  } catch {
    throw new UploadError('not_found', 'Upload not found', 404);
  }
}

export function contentTypeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}
