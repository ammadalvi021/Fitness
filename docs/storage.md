# Object storage for uploads (v21.8 PRIORITY 2)

Uploads (food-scan photos, menu extracts, data exports) are stored by
`apps/web/lib/storage.ts` behind a driver switch:

| Driver | Env | Where files live |
|---|---|---|
| `local` (default) | `STORAGE_DRIVER=local` | `STORAGE_LOCAL_DIR` (default `./uploads`) |
| `s3` | `STORAGE_DRIVER=s3` | S3-compatible bucket |

**`local` is dev-only.** Render's filesystem is ephemeral: files vanish on
every deploy/restart (see `docs/RENDER_DEPLOY.md`). Use the `s3` driver in
production.

## S3 driver configuration

Required:

```bash
S3_ENDPOINT="https://s3.amazonaws.com"   # MinIO: http://minio:9000, R2: https://<acct>.r2.cloudflarestorage.com
S3_BUCKET="fitfusion-uploads"            # must exist; private bucket
S3_ACCESS_KEY_ID="<key>"
S3_SECRET_ACCESS_KEY="<secret>"          # never commit a real value
```

Optional:

```bash
S3_REGION="us-east-1"        # default us-east-1 (R2: auto)
S3_FORCE_PATH_STYLE="true"   # default true — MinIO/R2-compat addressing
                             # set "false" for virtual-hosted style (bucket.endpoint)
```

Missing or invalid config throws `UploadError('not_configured')` naming the
missing var NAMES (e.g. `... missing: S3_ENDPOINT, S3_BUCKET`) — secret
values are never echoed in errors or logs.

Implementation: `apps/web/lib/storage-s3.ts` — SigV4-signed HTTPS REST with
`node:crypto` + `globalThis.fetch`. No AWS SDK, so the whole adapter is
unit-testable with a mocked fetch (see `tests/integration/storage-s3.test.ts`).
Owner authorization stays in `apps/web/lib/uploads.ts`; the adapter is
transport only.

## Bucket permissions

- **Private bucket.** No public access, no public bucket policy. Objects are
  written with `x-amz-acl: private`; bytes are served only through
  `GET /api/uploads/[key]` after the ownership check in `lib/uploads.ts`.
- Minimal IAM policy sketch (AWS-style; adapt to your provider):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FitFusionUploads",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:HeadObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::fitfusion-uploads/*"
    },
    {
      "Sid": "FitFusionListOwnBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::fitfusion-uploads"
    }
  ]
}
```

`ListBucket` is included only so the purge sweep's existence checks can run
against strict bucket policies; the app never lists the bucket.

## Deletion semantics (v21.8 PRIORITY 3)

- Delete is **idempotent**: an already-missing file (`ENOENT` / S3 404
  `NoSuchKey`) counts as success.
- A **genuine** storage failure throws. The purge sweep (`purgeExpiredUploads`,
  admin `POST /api/uploads/purge`) then KEEPS the registry row, counts the
  failure, and logs it — re-running the purge retries only keys whose rows
  still exist.
- Expiry is enforced at serve time too: `GET /api/uploads/[key]` returns 404
  for an expired registry row even if the purge job hasn't run yet, and
  serves bytes with `Cache-Control: private, no-store`.

## Live provider test (PENDING owner credentials)

Unit tests cover everything with mocked fetch. A real-bucket round trip is
marked PENDING until the owner provides credentials:

```bash
cd apps/web
# Option A — local MinIO (docker):
docker run -d --name minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
# create bucket "fitfusion-uploads" in the console at http://localhost:9001,
# or:  mc alias set local http://localhost:9000 minioadmin minioadmin
#       mc mb local/fitfusion-uploads
# Option B — real AWS S3 / Cloudflare R2: create a PRIVATE bucket first.
S3_LIVE_TEST=1 \
S3_ENDPOINT="http://localhost:9000" \
S3_BUCKET="fitfusion-uploads" \
S3_ACCESS_KEY_ID="minioadmin" \
S3_SECRET_ACCESS_KEY="minioadmin" \
npm test -- storage-s3-live
```

The live test puts, heads, gets, and deletes one object and asserts the bytes
round-trip. It never runs without `S3_LIVE_TEST=1` and never runs in CI.
