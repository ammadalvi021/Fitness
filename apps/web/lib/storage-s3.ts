/**
 * S3-compatible storage transport for uploads (v21.8 PRIORITY 2).
 *
 * SigV4-signed HTTPS REST against S3, MinIO, or any S3-compatible endpoint
 * (Cloudflare R2, etc.). No AWS SDK — `node:crypto` + `globalThis.fetch`
 * only, so the whole adapter is unit-testable with a mocked fetch.
 *
 * Transport ONLY: owner authorization stays in lib/uploads.ts (service
 * layer). All objects are written private; the service layer serves bytes
 * through GET /api/uploads/[key] after the ownership check.
 *
 * Env (see docs/storage.md + .env.example):
 *   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   (required); S3_REGION (default us-east-1); S3_FORCE_PATH_STYLE
 *   (default true — MinIO/R2-compat; set "false" for virtual-hosted style).
 *
 * PRIVACY: secret values are NEVER included in error messages or logs —
 * validation errors name the missing VAR NAMES only.
 */
import crypto from 'node:crypto';
import { UploadError } from './storage';

export const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  pathStyle: boolean;
}

const REQUIRED_VARS = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

/**
 * Validate S3 env at startup/use. Throws UploadError('not_configured')
 * naming exactly which vars are missing — never echoing secret VALUES.
 */
export function readS3Config(
  env: NodeJS.ProcessEnv = process.env,
): S3Config {
  const missing = REQUIRED_VARS.filter((v) => {
    const val = env[v];
    return !val || !val.trim();
  });
  if (missing.length > 0) {
    throw new UploadError(
      'not_configured',
      `S3 storage driver selected but required env var(s) missing: ${missing.join(', ')}`,
      501,
    );
  }
  const endpoint = env.S3_ENDPOINT!.trim();
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('bad protocol');
    }
  } catch {
    throw new UploadError(
      'not_configured',
      'S3 storage driver selected but S3_ENDPOINT is not a valid http(s) URL',
      501,
    );
  }
  const region = (env.S3_REGION || 'us-east-1').trim() || 'us-east-1';
  const rawStyle = (env.S3_FORCE_PATH_STYLE || '').trim().toLowerCase();
  const pathStyle =
    rawStyle === '' ? true : !['0', 'false', 'no', 'off'].includes(rawStyle);
  return {
    endpoint,
    bucket: env.S3_BUCKET!.trim(),
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    // NOTE: secret is deliberately NOT trimmed and NEVER logged or echoed.
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    region,
    pathStyle,
  };
}

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/** `YYYYMMDDTHHMMSSZ` + `YYYYMMDD` for SigV4, derived from a Date (UTC). */
export function amzDateFor(d: Date): { amzDate: string; dateStamp: string } {
  const amzDate = d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export interface SigV4Inputs {
  method: string;
  url: URL;
  /** Extra headers to sign (e.g. content-type, x-amz-acl). Lowercased. */
  extraHeaders?: Record<string, string>;
  payloadHash: string;
  config: S3Config;
  amzDate: string;
  dateStamp: string;
}

export interface SignedRequest {
  /** All headers to send, including Authorization. */
  headers: Record<string, string>;
  authorization: string;
  /** The canonical request that was signed (auditable in tests). */
  canonicalRequest: string;
}

/**
 * Build the SigV4 canonical request and sign it. Exported so unit tests
 * can assert the EXACT canonical request string and recompute the
 * signature independently.
 */
export function signS3Request(inputs: SigV4Inputs): SignedRequest {
  const {
    method,
    url,
    extraHeaders = {},
    payloadHash,
    config,
    amzDate,
    dateStamp,
  } = inputs;
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join(
    '\n',
  );
  const kDate = hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, config.region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    headers: { ...headers, Authorization: authorization },
    authorization,
    canonicalRequest,
  };
}

export type FetchImpl = typeof fetch;

export interface S3Object {
  data: Buffer;
  contentType: string;
  contentLength: number | null;
}

/**
 * Minimal S3 REST client: put / get / head / delete objects.
 * `fetchImpl` and `clock` are injectable for unit tests.
 */
export class S3Client {
  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Object URL — path-style (`/bucket/key`) or virtual-hosted style. */
  objectUrl(key: string): URL {
    const enc = encodeURIComponent(key);
    if (this.config.pathStyle) {
      return new URL(
        `${this.config.endpoint.replace(/\/+$/, '')}/${this.config.bucket}/${enc}`,
      );
    }
    const u = new URL(this.config.endpoint);
    u.hostname = `${this.config.bucket}.${u.hostname}`;
    u.pathname = `/${enc}`;
    u.search = '';
    return u;
  }

  private async signedFetch(
    method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
    key: string,
    extraHeaders: Record<string, string> = {},
    payload?: Buffer,
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const { amzDate, dateStamp } = amzDateFor(this.clock());
    const payloadHash = payload ? sha256Hex(payload) : EMPTY_SHA256;
    const { headers } = signS3Request({
      method,
      url,
      extraHeaders,
      payloadHash,
      config: this.config,
      amzDate,
      dateStamp,
    });
    return this.fetchImpl(url.toString(), {
      method,
      headers,
      body: payload ?? undefined,
    });
  }

  private async s3Error(op: string, res: Response): Promise<UploadError> {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    const code =
      /<Code>([^<]{1,64})<\/Code>/.exec(body)?.[1] ?? `HTTP_${res.status}`;
    const status =
      res.status >= 400 && res.status < 600 ? res.status : 502;
    return new UploadError('s3_error', `S3 ${op} failed: ${code}`, status);
  }

  /** Upload bytes with a private ACL. Throws on genuine failure. */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.signedFetch(
      'PUT',
      key,
      { 'content-type': contentType, 'x-amz-acl': 'private' },
      body,
    );
    if (!res.ok) throw await this.s3Error('putObject', res);
  }

  /** Download bytes. 404 -> UploadError('not_found'). */
  async getObject(key: string): Promise<S3Object> {
    const res = await this.signedFetch('GET', key);
    if (res.status === 404) {
      throw new UploadError('not_found', 'Upload not found', 404);
    }
    if (!res.ok) throw await this.s3Error('getObject', res);
    const data = Buffer.from(await res.arrayBuffer());
    const len = res.headers.get('content-length');
    return {
      data,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: len != null && len !== '' ? Number(len) : null,
    };
  }

  /** Existence check. 404 -> false; other failures throw. */
  async headObject(key: string): Promise<boolean> {
    const res = await this.signedFetch('HEAD', key);
    if (res.status === 404) return false;
    if (!res.ok) throw await this.s3Error('headObject', res);
    return true;
  }

  /**
   * Delete. Idempotent: 404/NoSuchKey counts as success (already gone).
   * Genuine failures throw — callers must NOT treat this as "deleted".
   */
  async deleteObject(key: string): Promise<void> {
    const res = await this.signedFetch('DELETE', key);
    if (res.status === 404) return;
    if (!res.ok) throw await this.s3Error('deleteObject', res);
  }
}
