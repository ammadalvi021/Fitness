/**
 * v21.8 PRIORITY 2 — S3-compatible storage adapter.
 *
 * Unit tests for apps/web/lib/storage-s3.ts + the s3 driver wiring in
 * apps/web/lib/storage.ts. `fetch` is mocked everywhere: no network, no
 * credentials. Provider-backed tests against a real bucket live in
 * storage-s3-live.test.ts (PENDING owner credentials, skipped by default).
 *
 * Covered:
 * - SigV4: exact canonical-request string, Authorization header shape,
 *   and an INDEPENDENT signature recomputation (test-local crypto, not the
 *   lib's signer) over a fixed clock.
 * - put/get/head/delete flows: method, URL (path-style vs virtual-hosted),
 *   signed headers, private ACL on PUT.
 * - Config validation: missing vars named exactly; secret values NEVER in
 *   errors; defaults for region/path-style; invalid endpoint rejected.
 * - Deletion semantics: 404 = success (idempotent), genuine failure throws.
 */
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  amzDateFor,
  EMPTY_SHA256,
  readS3Config,
  S3Client,
  signS3Request,
  type S3Config,
} from '@/lib/storage-s3';
import { UploadError as StorageUploadError } from '@/lib/storage';
import {
  deleteUpload,
  getUploadPath,
  readUpload,
  saveUpload,
} from '@/lib/storage';

const FIXED_DATE = new Date('2026-10-16T12:00:00.000Z');
const CONFIG: S3Config = {
  endpoint: 'http://minio.example.com:9000',
  bucket: 'fitfusion-uploads',
  accessKeyId: 'TESTACCESSKEY',
  secretAccessKey: 'TESTSECRETKEY',
  region: 'us-east-1',
  pathStyle: true,
};
const PAYLOAD_HASH_OF_HELLO =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

const OLD_ENV = { ...process.env };
let storageDir = '';

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'ff-s3-test-'));
  process.env.STORAGE_LOCAL_DIR = storageDir;
  delete process.env.STORAGE_DRIVER;
  for (const v of [
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_REGION',
    'S3_FORCE_PATH_STYLE',
  ]) {
    delete process.env[v];
  }
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

function setS3Env(overrides: Record<string, string> = {}) {
  process.env.S3_ENDPOINT = 'http://minio.example.com:9000';
  process.env.S3_BUCKET = 'fitfusion-uploads';
  process.env.S3_ACCESS_KEY_ID = 'TESTACCESSKEY';
  process.env.S3_SECRET_ACCESS_KEY = 'TESTSECRETKEY';
  Object.assign(process.env, overrides);
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Mock fetch with a canned responder; records every request. */
function mockFetch(
  respond: (req: CapturedRequest) => Response,
): { requests: CapturedRequest[]; fetchMock: ReturnType<typeof vi.fn> } {
  const requests: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (url: unknown, init: any = {}) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) {
      headers[String(k).toLowerCase()] = String(v);
    }
    const req: CapturedRequest = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body: init.body,
    };
    requests.push(req);
    return respond(req);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}

const ok = (body?: BodyInit | null, init?: ResponseInit) =>
  new Response(body ?? null, { status: 200, ...init });

describe('readS3Config', () => {
  it('names exactly the missing vars, never secret values', () => {
    process.env.S3_ENDPOINT = 'http://minio.example.com:9000';
    process.env.S3_ACCESS_KEY_ID = 'KEY_CANARY_7f3a';
    process.env.S3_SECRET_ACCESS_KEY = 'SECRET_CANARY_9f8e2d';
    let err: unknown;
    try {
      readS3Config();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StorageUploadError);
    const ue = err as StorageUploadError;
    expect(ue.code).toBe('not_configured');
    expect(ue.status).toBe(501);
    expect(ue.message).toContain('S3_BUCKET');
    expect(ue.message).not.toContain('S3_ENDPOINT'); // it IS set
    expect(ue.message).not.toContain('KEY_CANARY_7f3a');
    expect(ue.message).not.toContain('SECRET_CANARY_9f8e2d');
  });

  it('all four missing -> all four named', () => {
    let err: unknown;
    try {
      readS3Config();
    } catch (e) {
      err = e;
    }
    const ue = err as StorageUploadError;
    for (const v of [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ]) {
      expect(ue.message).toContain(v);
    }
  });

  it('defaults region to us-east-1 and path-style to true', () => {
    setS3Env();
    const cfg = readS3Config();
    expect(cfg.region).toBe('us-east-1');
    expect(cfg.pathStyle).toBe(true);
  });

  it('honors S3_REGION and S3_FORCE_PATH_STYLE=false', () => {
    setS3Env({ S3_REGION: 'eu-west-1', S3_FORCE_PATH_STYLE: 'false' });
    const cfg = readS3Config();
    expect(cfg.region).toBe('eu-west-1');
    expect(cfg.pathStyle).toBe(false);
  });

  it('rejects a non-http(s) endpoint', () => {
    setS3Env({ S3_ENDPOINT: 'ftp://example.com' });
    expect(() => readS3Config()).toThrowError(
      expect.objectContaining({ code: 'not_configured' }),
    );
  });
});

describe('SigV4 signing', () => {
  const { amzDate, dateStamp } = amzDateFor(FIXED_DATE);
  const url = new URL(
    'http://minio.example.com:9000/fitfusion-uploads/scans-abc.png',
  );

  it('builds the exact expected canonical request', () => {
    const { canonicalRequest } = signS3Request({
      method: 'PUT',
      url,
      extraHeaders: { 'content-type': 'image/png', 'x-amz-acl': 'private' },
      payloadHash: PAYLOAD_HASH_OF_HELLO,
      config: CONFIG,
      amzDate,
      dateStamp,
    });
    expect(canonicalRequest).toBe(
      [
        'PUT',
        '/fitfusion-uploads/scans-abc.png',
        '',
        'content-type:image/png',
        'host:minio.example.com:9000',
        'x-amz-acl:private',
        `x-amz-content-sha256:${PAYLOAD_HASH_OF_HELLO}`,
        'x-amz-date:20261016T120000Z',
        '',
        'content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date',
        PAYLOAD_HASH_OF_HELLO,
      ].join('\n'),
    );
  });

  it('Authorization header has the SigV4 shape', () => {
    const { authorization } = signS3Request({
      method: 'GET',
      url,
      payloadHash: EMPTY_SHA256,
      config: CONFIG,
      amzDate,
      dateStamp,
    });
    expect(authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEY\/20261016\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('signature matches an independent recomputation', () => {
    // Independent path: raw node:crypto here in the test, never calling
    // the lib's signS3Request — proves the lib's chain, not just itself.
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      'GET',
      '/fitfusion-uploads/scans-abc.png',
      '',
      'host:minio.example.com:9000',
      `x-amz-content-sha256:${EMPTY_SHA256}`,
      'x-amz-date:20261016T120000Z',
      '',
      signedHeaders,
      EMPTY_SHA256,
    ].join('\n');
    const scope = '20261016/us-east-1/s3/aws4_request';
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      '20261016T120000Z',
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const h = (key: Buffer | string, data: string) =>
      createHmac('sha256', key).update(data, 'utf8').digest();
    const signingKey = h(
      h(h(h('AWS4TESTSECRETKEY', '20261016'), 'us-east-1'), 's3'),
      'aws4_request',
    );
    const expected = h(signingKey, stringToSign).toString('hex');

    const { authorization } = signS3Request({
      method: 'GET',
      url,
      payloadHash: EMPTY_SHA256,
      config: CONFIG,
      amzDate,
      dateStamp,
    });
    expect(authorization).toContain(`Signature=${expected}`);
  });

  it('uses the virtual-hosted URL when path-style is off', () => {
    const client = new S3Client(
      { ...CONFIG, pathStyle: false },
      undefined,
      () => FIXED_DATE,
    );
    expect(client.objectUrl('scans-abc.png').toString()).toBe(
      'http://fitfusion-uploads.minio.example.com:9000/scans-abc.png',
    );
    expect(
      new S3Client(CONFIG, undefined, () => FIXED_DATE)
        .objectUrl('scans-abc.png')
        .toString(),
    ).toBe('http://minio.example.com:9000/fitfusion-uploads/scans-abc.png');
  });
});

describe('S3Client object operations (mocked fetch)', () => {
  const clock = () => FIXED_DATE;

  it('putObject signs, PUTs to the path-style URL with private ACL', async () => {
    const { requests } = mockFetch(() => ok());
    const client = new S3Client(CONFIG, globalThis.fetch, clock);
    const body = Buffer.from('fake-bytes');
    await client.putObject('scans-abc.png', body, 'image/png');

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.method).toBe('PUT');
    expect(req.url).toBe(
      'http://minio.example.com:9000/fitfusion-uploads/scans-abc.png',
    );
    expect(req.headers['x-amz-acl']).toBe('private');
    expect(req.headers['content-type']).toBe('image/png');
    expect(req.headers['x-amz-content-sha256']).toBe(
      createHash('sha256').update(body).digest('hex'),
    );
    expect(req.headers['x-amz-date']).toBe('20261016T120000Z');
    expect(req.headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEY\/20261016\/us-east-1\/s3\/aws4_request, SignedHeaders=.*Signature=[0-9a-f]{64}$/,
    );
  });

  it('putObject throws on genuine failure, without secrets in the message', async () => {
    mockFetch(
      () =>
        new Response('<Error><Code>AccessDenied</Code></Error>', {
          status: 403,
        }),
    );
    const client = new S3Client(CONFIG, globalThis.fetch, clock);
    await expect(
      client.putObject('scans-abc.png', Buffer.from('x'), 'image/png'),
    ).rejects.toMatchObject({ code: 's3_error', status: 403 });
    try {
      await client.putObject('scans-abc.png', Buffer.from('x'), 'image/png');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('AccessDenied');
      expect(msg).not.toContain('TESTSECRETKEY');
      expect(msg).not.toContain('TESTACCESSKEY');
    }
  });

  it('getObject returns bytes + content type; 404 -> not_found', async () => {
    const { requests } = mockFetch(
      (req) =>
        new Response('payload-bytes', {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '13' },
        }),
    );
    const client = new S3Client(CONFIG, globalThis.fetch, clock);
    const obj = await client.getObject('scans-abc.png');
    expect(obj.data.equals(Buffer.from('payload-bytes'))).toBe(true);
    expect(obj.contentType).toBe('image/png');
    expect(obj.contentLength).toBe(13);
    expect(requests[0].method).toBe('GET');

    mockFetch(() => new Response('', { status: 404 }));
    await expect(
      new S3Client(CONFIG, globalThis.fetch, clock).getObject('missing.png'),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('headObject: true on 200, false on 404, throws on 500', async () => {
    mockFetch(() => new Response(null, { status: 200 }));
    expect(
      await new S3Client(CONFIG, globalThis.fetch, clock).headObject('a.png'),
    ).toBe(true);

    mockFetch(() => new Response('', { status: 404 }));
    expect(
      await new S3Client(CONFIG, globalThis.fetch, clock).headObject('a.png'),
    ).toBe(false);

    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(
      new S3Client(CONFIG, globalThis.fetch, clock).headObject('a.png'),
    ).rejects.toMatchObject({ code: 's3_error', status: 500 });
  });

  it('deleteObject: 204 ok, 404 ok (idempotent), 500 throws', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    const c1 = new S3Client(CONFIG, globalThis.fetch, clock);
    await expect(c1.deleteObject('a.png')).resolves.toBeUndefined();

    mockFetch(
      () => new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }),
    );
    const c2 = new S3Client(CONFIG, globalThis.fetch, clock);
    await expect(c2.deleteObject('a.png')).resolves.toBeUndefined();

    mockFetch(() => new Response('boom', { status: 500 }));
    const c3 = new S3Client(CONFIG, globalThis.fetch, clock);
    await expect(c3.deleteObject('a.png')).rejects.toMatchObject({
      code: 's3_error',
      status: 500,
    });
  });
});

describe('storage.ts s3 driver wiring', () => {
  it('saveUpload PUTs through SigV4 fetch and returns url+key', async () => {
    process.env.STORAGE_DRIVER = 's3';
    setS3Env();
    const { requests } = mockFetch(() => ok());
    const saved = await saveUpload(Buffer.from([1, 2, 3]), {
      mime: 'image/png',
      prefix: 'scans',
    });
    expect(saved.url).toBe(`/api/uploads/${saved.key}`);
    expect(saved.key).toMatch(/^scans-[0-9a-f]{32}\.png$/);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('PUT');
    expect(requests[0].headers['x-amz-acl']).toBe('private');
  });

  it('saveUpload with s3 selected but unconfigured -> not_configured naming vars', async () => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_ENDPOINT = 'http://minio.example.com:9000';
    await expect(
      saveUpload(Buffer.from([1]), { mime: 'image/png' }),
    ).rejects.toMatchObject({ code: 'not_configured', status: 501 });
    try {
      await saveUpload(Buffer.from([1]), { mime: 'image/png' });
    } catch (e) {
      expect((e as StorageUploadError).message).toContain('S3_BUCKET');
      expect((e as StorageUploadError).message).toContain('S3_ACCESS_KEY_ID');
      expect((e as StorageUploadError).message).toContain('S3_SECRET_ACCESS_KEY');
    }
  });

  it('deleteUpload via s3: 404 -> success, 500 -> throws', async () => {
    process.env.STORAGE_DRIVER = 's3';
    setS3Env();
    mockFetch(() => new Response('', { status: 404 }));
    await expect(deleteUpload('gone.png')).resolves.toBeUndefined();

    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(deleteUpload('gone.png')).rejects.toMatchObject({
      code: 's3_error',
    });
  });

  it('readUpload via s3: 404 -> not_found UploadError', async () => {
    process.env.STORAGE_DRIVER = 's3';
    setS3Env();
    mockFetch(() => new Response('', { status: 404 }));
    await expect(readUpload('gone.png')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });

  it('deleteUpload local: missing file -> success; genuine failure -> throws', async () => {
    // local driver (STORAGE_DRIVER unset)
    await expect(deleteUpload('never-existed.png')).resolves.toBeUndefined();

    // Genuine failure: unlink on a directory fails (EISDIR/EPERM on Linux).
    const key = 'adir.png';
    mkdirSync(getUploadPath(key), { recursive: true });
    await expect(deleteUpload(key)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(existsSync(getUploadPath(key))).toBe(true);
    rmSync(getUploadPath(key), { recursive: true, force: true });
  });
});
