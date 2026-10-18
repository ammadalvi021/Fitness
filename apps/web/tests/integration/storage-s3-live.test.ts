/**
 * v21.8 PRIORITY 2 — PROVIDER-BACKED S3 test.
 *
 * STATUS: PENDING owner credentials. This file is ALWAYS SKIPPED unless
 * S3_LIVE_TEST=1 is set. It performs a real round trip (put -> head ->
 * get -> delete) against a real S3-compatible bucket and is the only test
 * that touches the network.
 *
 * Run against local MinIO (docker):
 *
 *   docker run -d --name minio -p 9000:9000 -p 9001:9001 \
 *     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
 *     minio/minio server /data --console-address ":9001"
 *   # create bucket "fitfusion-uploads" at http://localhost:9001
 *     (or: mc alias set local http://localhost:9000 minioadmin minioadmin && \
 *          mc mb local/fitfusion-uploads)
 *   cd apps/web
 *   S3_LIVE_TEST=1 \
 *     S3_ENDPOINT="http://localhost:9000" \
 *     S3_BUCKET="fitfusion-uploads" \
 *     S3_ACCESS_KEY_ID="minioadmin" \
 *     S3_SECRET_ACCESS_KEY="minioadmin" \
 *     npm test -- storage-s3-live
 *
 * Run against AWS S3 (PRIVATE bucket you own):
 *
 *   S3_LIVE_TEST=1 \
 *     S3_ENDPOINT="https://s3.amazonaws.com" \
 *     S3_REGION="us-east-1" \
 *     S3_FORCE_PATH_STYLE="false" \
 *     S3_BUCKET="<your-private-bucket>" \
 *     S3_ACCESS_KEY_ID="<key>" \
 *     S3_SECRET_ACCESS_KEY="<secret>" \
 *     npm test -- storage-s3-live
 *
 * Run against Cloudflare R2:
 *
 *   S3_LIVE_TEST=1 \
 *     S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com" \
 *     S3_REGION="auto" \
 *     S3_BUCKET="<your-private-bucket>" \
 *     S3_ACCESS_KEY_ID="<r2-access-key>" \
 *     S3_SECRET_ACCESS_KEY="<r2-secret-key>" \
 *     npm test -- storage-s3-live
 *
 * DO NOT claim production-ready until this suite has gone green against the
 * bucket you will actually deploy to.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readS3Config, S3Client } from '@/lib/storage-s3';

const LIVE = process.env.S3_LIVE_TEST === '1';

describe.skipIf(!LIVE)('storage-s3 live round trip', () => {
  it('put -> head -> get -> delete against a real bucket', async () => {
    const config = readS3Config(); // throws not_configured naming missing vars
    const client = new S3Client(config);
    const key = `live-test-${randomBytes(8).toString('hex')}.png`;
    const body = randomBytes(1024);

    await client.putObject(key, body, 'image/png');
    expect(await client.headObject(key)).toBe(true);

    const obj = await client.getObject(key);
    expect(obj.data.equals(body)).toBe(true);
    expect(obj.contentType).toContain('image/png');

    await client.deleteObject(key);
    expect(await client.headObject(key)).toBe(false);

    // Idempotent re-delete: already gone -> success, no throw.
    await client.deleteObject(key);
  }, 60000);
});
