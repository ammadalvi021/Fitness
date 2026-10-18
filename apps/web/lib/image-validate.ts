/**
 * Image upload validation (v21.8 PRIORITY 4 — harden image handling).
 *
 * `File.type` is client-supplied and is NEVER trusted on its own: every
 * uploaded image is checked against its actual magic bytes, and its pixel
 * dimensions are decoded by parsing the container format manually —
 * PNG IHDR, JPEG SOF markers, WEBP VP8/VP8L/VP8X chunks. No native
 * dependencies; pure TypeScript over the byte buffer.
 *
 * Used by the food-scanner (`POST /api/scans`) and the restaurant-menu
 * extractor (`POST /api/menus/extract`) via `extractValidatedImage`, which
 * additionally enforces the size cap BEFORE the full buffer is allocated
 * (Content-Length up front, then a capped stream read → 413).
 */
import {
  IMAGE_MIMES,
  UploadError,
  assertContentLengthOk,
  maxUploadBytes,
  readCappedFile,
} from './storage';

export type DetectedImageType = 'jpeg' | 'png' | 'webp';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ValidatedImage extends ImageDimensions {
  type: DetectedImageType;
}

/** Magic-byte sniffing. Returns null when the bytes are not a known image. */
export function detectImageType(data: Uint8Array): DetectedImageType | null {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 && // R
    data[1] === 0x49 && // I
    data[2] === 0x46 && // F
    data[3] === 0x46 && // F
    data[8] === 0x57 && // W
    data[9] === 0x45 && // E
    data[10] === 0x42 && // B
    data[11] === 0x50 // P
  ) {
    return 'webp';
  }
  return null;
}

function u16be(d: Uint8Array, o: number): number {
  return (d[o] << 8) | d[o + 1];
}

function u16le(d: Uint8Array, o: number): number {
  return d[o] | (d[o + 1] << 8);
}

function u32be(d: Uint8Array, o: number): number {
  return d[o] * 0x1000000 + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
}

function u32le(d: Uint8Array, o: number): number {
  return (
    d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | d[o + 3] * 0x1000000
  );
}

/** PNG: width/height are big-endian uint32 at fixed offsets in IHDR. */
function pngDimensions(data: Uint8Array): ImageDimensions | null {
  // 8-byte signature + 4-byte length + 4-byte 'IHDR' + 13-byte IHDR payload
  if (data.length < 33) return null;
  if (
    data[12] !== 0x49 || // I
    data[13] !== 0x48 || // H
    data[14] !== 0x44 || // D
    data[15] !== 0x52 // R
  ) {
    return null;
  }
  const width = u32be(data, 16);
  const height = u32be(data, 20);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * JPEG: walk the marker segments until a Start-Of-Frame marker
 * (SOF0/SOF1/SOF2/SOF3 — baseline, extended, progressive, lossless).
 * Every read is bounds-checked; truncated input yields null, never a throw.
 */
function jpegDimensions(data: Uint8Array): ImageDimensions | null {
  let off = 2; // past SOI
  while (off + 4 <= data.length) {
    if (data[off] !== 0xff) return null;
    let marker = data[off + 1];
    // Skip fill bytes (0xFF padding between markers is legal).
    while (marker === 0xff && off + 3 <= data.length) {
      off += 1;
      marker = data[off + 1];
    }
    off += 2;
    // Standalone markers carry no length field.
    if (
      marker === 0xd8 || // SOI (defensive)
      marker === 0xd9 || // EOI
      marker === 0x01 || // TEM
      (marker >= 0xd0 && marker <= 0xd7) // RST0..RST7
    ) {
      continue;
    }
    if (off + 2 > data.length) return null;
    const len = u16be(data, off);
    if (len < 2 || off + len > data.length) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG
      marker !== 0xcc; // DAC
    if (isSof) {
      // SOF payload: precision(1) + height(2) + width(2) + components...
      if (len < 7 || off + 7 > data.length) return null;
      const height = u16be(data, off + 3);
      const width = u16be(data, off + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    off += len;
  }
  return null;
}

/**
 * WEBP: RIFF container; read chunks until a VP8/VP8L/VP8X image chunk gives
 * the canvas size. Chunk data is padded to even lengths.
 */
function webpDimensions(data: Uint8Array): ImageDimensions | null {
  let off = 12; // past 'RIFF' + size + 'WEBP'
  while (off + 8 <= data.length) {
    const fourcc =
      String.fromCharCode(data[off]) +
      String.fromCharCode(data[off + 1]) +
      String.fromCharCode(data[off + 2]) +
      String.fromCharCode(data[off + 3]);
    const size = u32le(data, off + 4);
    const start = off + 8;
    if (!Number.isSafeInteger(size) || start + size > data.length) return null;
    if (fourcc === 'VP8 ') {
      // Lossy bitstream: 3-byte frame tag, 0x9D 0x01 0x2A start code,
      // then width/height as 14-bit little-endian values.
      if (
        size >= 10 &&
        data[start + 3] === 0x9d &&
        data[start + 4] === 0x01 &&
        data[start + 5] === 0x2a
      ) {
        const width = u16le(data, start + 6) & 0x3fff;
        const height = u16le(data, start + 8) & 0x3fff;
        return width > 0 && height > 0 ? { width, height } : null;
      }
      return null;
    }
    if (fourcc === 'VP8L') {
      // Lossless: 0x2F signature, then width-1/height-1 packed in 4 bytes.
      if (size >= 5 && data[start] === 0x2f) {
        const b0 = data[start + 1];
        const b1 = data[start + 2];
        const b2 = data[start + 3];
        const b3 = data[start + 4];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + ((((b3 & 0x0f) << 10) | (b2 << 2)) | ((b1 >> 6) & 0x03));
        return { width, height };
      }
      return null;
    }
    if (fourcc === 'VP8X') {
      // Extended (incl. animated): canvas width-1 / height-1 as 24-bit LE
      // at data offsets 4 and 7.
      if (size >= 10) {
        const width =
          1 + (data[start + 4] | (data[start + 5] << 8) | (data[start + 6] << 16));
        const height =
          1 + (data[start + 7] | (data[start + 8] << 8) | (data[start + 9] << 16));
        return width > 0 && height > 0 ? { width, height } : null;
      }
      return null;
    }
    off = start + size + (size % 2);
  }
  return null;
}

/** Decode pixel dimensions for a magic-detected image type. */
export function parseImageDimensions(
  data: Uint8Array,
  type: DetectedImageType,
): ImageDimensions | null {
  switch (type) {
    case 'png':
      return pngDimensions(data);
    case 'jpeg':
      return jpegDimensions(data);
    case 'webp':
      return webpDimensions(data);
  }
}

const MIME_FOR_TYPE: Record<DetectedImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Validate an upload buffer against its declared MIME type.
 * - Unknown magic bytes            -> 415 unsupported_media_type
 * - Magic bytes disagree with the declared MIME (spoofed type) -> 415
 * - Magic matches but the container is truncated/corrupt so no
 *   dimensions can be decoded -> 400 invalid_image
 * Returns the detected type + pixel dimensions on success.
 */
export function validateImageUpload(
  data: Buffer,
  declaredMime: string,
): ValidatedImage {
  const type = detectImageType(data);
  if (!type) {
    throw new UploadError(
      'unsupported_media_type',
      'File is not a recognized image (expected JPEG, PNG, or WEBP)',
      415,
    );
  }
  const actualMime = MIME_FOR_TYPE[type];
  if (declaredMime !== actualMime) {
    throw new UploadError(
      'unsupported_media_type',
      `Declared image type ${declaredMime || 'unknown'} does not match the actual file contents (${actualMime})`,
      415,
    );
  }
  const dims = parseImageDimensions(data, type);
  if (!dims) {
    throw new UploadError(
      'invalid_image',
      'Image file is truncated or corrupt — dimensions could not be decoded',
      400,
    );
  }
  return { type, ...dims };
}

export interface ValidatedImageUpload extends ValidatedImage {
  buffer: Buffer;
  /** Declared MIME, verified to match the magic bytes. */
  mime: string;
}

/**
 * Full upload preamble for image-accepting routes (food scan, menu
 * extraction). Enforces, in order:
 * 1. Content-Length up-front check (413 before any buffering),
 * 2. multipart parse + declared-MIME allowlist (400/415),
 * 3. multipart `size` metadata check (413 before buffering),
 * 4. capped stream read (413 — the real enforcement),
 * 5. magic-byte + dimension validation (415/400 — `File.type` is not trusted).
 *
 * Throws UploadError on every failure; routes map it to the API error
 * envelope. The returned buffer is a verified image.
 */
export async function extractValidatedImage(
  req: Request,
  field = 'image',
): Promise<ValidatedImageUpload> {
  const maxBytes = maxUploadBytes();
  assertContentLengthOk(req, maxBytes);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new UploadError(
      'invalid_request',
      `Expected multipart form data with an "${field}" field`,
      400,
    );
  }
  const file = form.get(field);
  if (!(file instanceof File)) {
    throw new UploadError(
      'validation_error',
      `Missing "${field}" file in form data`,
      400,
    );
  }
  if (!IMAGE_MIMES.includes(file.type)) {
    throw new UploadError(
      'unsupported_media_type',
      `Unsupported image type: ${file.type || 'unknown'}`,
      415,
    );
  }
  if (file.size > maxBytes) {
    throw new UploadError(
      'file_too_large',
      `File exceeds the upload size limit (${Math.round((maxBytes / 1024 / 1024) * 10) / 10} MB)`,
      413,
    );
  }

  const buffer = await readCappedFile(file, maxBytes);
  const validated = validateImageUpload(buffer, file.type);
  return { buffer, mime: file.type, ...validated };
}
