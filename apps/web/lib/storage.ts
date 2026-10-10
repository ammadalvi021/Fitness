/**
 * Upload storage adapter.
 *
 * - `STORAGE_DRIVER=local` (default): writes files under STORAGE_LOCAL_DIR
 *   (default `./uploads`, resolved against the web app working directory)
 *   and serves them from `/api/uploads/<key>`.
 * - `STORAGE_DRIVER=s3`: honest stub — throws a `not_configured` UploadError
 *   because no S3 credentials/transport are wired in this build.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

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
  const mb = Number(process.env.UPLOAD_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 8) * 1024 * 1024;
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
 * file_too_large, invalid_key.
 */
export async function saveUpload(
  data: Buffer,
  opts: SaveUploadOptions,
): Promise<SavedUpload> {
  const driver = storageDriver();
  if (driver === 's3') {
    throw new UploadError(
      'not_configured',
      'S3 storage driver is selected but not configured in this build',
      501,
    );
  }
  if (driver !== 'local') {
    throw new UploadError(
      'not_configured',
      `Unknown storage driver: ${driver}`,
      501,
    );
  }

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

  const safePrefix = (opts.prefix ?? '')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 24);
  const key = `${safePrefix ? `${safePrefix}-` : ''}${crypto
    .randomBytes(16)
    .toString('hex')}${extForMime(opts.mime)}`;

  const filePath = getUploadPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  return { url: `/api/uploads/${key}`, key };
}

/** Best-effort delete; never throws. */
export async function deleteUpload(key: string): Promise<void> {
  try {
    await fs.unlink(getUploadPath(key));
  } catch {
    /* best effort */
  }
}

/** Read an upload's bytes; throws UploadError('not_found') when missing. */
export async function readUpload(key: string): Promise<Buffer> {
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
