# Deploying FitFusion AI on Render

Takes about 15 minutes. You need a GitHub account and a Render account (both free).

## Your deploy flow (do not change this part)

Every release ships as a zip. Your working flow is:

1. On Windows, **extract the zip over your existing clone** (the folder you
   previously `git init`-ed and pushed from) — new/changed files land on top,
   your git history stays intact.
2. Click-by-click in PowerShell (or Git Bash):
   ```powershell
   cd C:\path\to\fitfusion-ai      # your clone folder
   git add -A
   git commit -m "v21.8-final"
   git push origin main
   ```
3. Render **auto-deploys from `main`** — no dashboard action needed.
   Watch progress in Render dashboard → `fitfusion-ai` → **Events**.

## 0. First time only: put the code on GitHub (Render cannot deploy a zip)

```bash
cd fitfusion-ai
git init
git add -A
git commit -m "FitFusion AI"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/fitfusion-ai.git
git push -u origin main
```

## 1. Create from the Blueprint (first time only)

Render dashboard → **New** → **Blueprint** → select the `fitfusion-ai` repo.
Render reads `render.yaml` and creates two things: the **Web Service**
(`fitfusion-ai`) and the **PostgreSQL 16** database (`fitfusion-db`), already
wired together via `DATABASE_URL`. Click **Apply**.

What the Blueprint does for you:
- `npm install`, Prisma client generation, then the database steps
  (`prisma migrate deploy` across **all 19 migrations** — see "The build
  command, step by step" below — followed by `npm run db:seed`), then
  `next build`.
- Starts with `next start` (production) and health-checks `/api/health`.
- Generates a random `SESSION_SECRET` (production rejects placeholder
  secrets, so this matters).
- Leaves billing safely off (`BILLING_PROVIDER=none`).

## 2. Set APP_URL after the first deploy

Once the service is live (e.g. `https://fitfusion-ai-ih12.onrender.com`):
Dashboard → the web service → **Environment** → set `APP_URL` to that URL →
**Save** (triggers a redeploy). `APP_URL` is used for Stripe redirect URLs
and the webhook URL `{APP_URL}/api/billing/webhook`.

## 3. Verify

Open `https://<your-service>.onrender.com/api/health` — expect
`{"ok":true,...}`. Then open the app, register, and click around.

## 4. Optional extras

- **AI features**: add `AI_API_KEY` (and `AI_BASE_URL`/`AI_MODEL` if not
  OpenAI-compatible defaults) under Environment.
- **Stripe test-mode**: add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_DIET`, `STRIPE_PRICE_DIET_EXERCISE`, set
  `BILLING_PROVIDER=stripe`, then add the webhook endpoint
  `{APP_URL}/api/billing/webhook` in the Stripe dashboard. (Yes, all four —
  an API key alone never enables paid entitlements.)
- **Demo/seed data**: the seed (`npm run db:seed`, run from the repo root)
  runs automatically at build time on every deploy (see below). You normally
  never need to run it yourself. If you ever do (e.g. a seed fix without a
  code change), open the web service → **Shell** and run:
  ```bash
  npm run db:seed
  ```

---

## The build command, step by step

`render.yaml` `buildCommand` is, in order:

| Step | What it is | Safe to re-run? |
|---|---|---|
| `npm install` | Compilation input | Yes |
| `prisma generate` | Compilation (builds the Prisma client) | Yes |
| `prisma migrate deploy` | **Database op — controlled.** Applies pending migrations only. All 19 migrations are additive (no `DROP TABLE` / `DROP COLUMN` anywhere in `packages/db/prisma/migrations/`). Never runs `db push` — it never guesses at schema changes. | Yes — repeat runs apply zero migrations |
| `npm run db:seed` | **Database op — idempotent.** Re-runs perform **zero writes** when nothing changed (verified in `packages/db/src/seed-safety.ts`): records report `created / updated / unchanged / skipped / failed`. Private user recipes are never touched (`skipped`), and exercise media imported from an authorized source is preserved — the seed only writes media when the seed entry explicitly carries it. A recipe whose content actually changed gets its hash recomputed and review/verification evidence invalidated (so stale badges can never survive a content change). | Yes — by design |
| `npm run build` (packages + web) | Compilation (`next build`) | Yes |

### ⚠️ Should you change the build command? Recommendation: NO

Your flow works — don't break it. The DB steps at build time are safe
*specifically because* migrations are additive-only and the v21.8 seed is
idempotent. Your past build-time timeouts were a **duration** problem (DB ops
at build time make builds long), not a correctness problem — and moving them
would not fix that on the free tier anyway; it would just trade it for a
manual step you can forget.

**If you ever want the build to skip DB operations**, here is the exact diff
and its consequences:

```diff
     buildCommand: >-
       npm install &&
       npx prisma generate --schema packages/db/prisma/schema.prisma &&
-      npx prisma migrate deploy --schema packages/db/prisma/schema.prisma &&
-      npm run db:seed &&
       npm run build --workspace @fitfusion/core --workspace @fitfusion/db --workspace @fitfusion/ai &&
       npm run build --workspace apps/web
```

Consequences:
- After every deploy you must open the web service → **Shell** and run
  BOTH (in this order) before the app works:
  ```bash
  npm run db:migrate     # = prisma migrate deploy (same command render.yaml uses)
  npm run db:seed        # one-time content; safe to re-run
  ```
- Until you run migrate, `/api/health` returns **503**
  (`checks.migrations.ok: false`) and the app will not start properly —
  Render will mark the deploy unhealthy.
- If you forget the seed, recipes/exercises/food reference data are missing.

The documented alternative: keep the build command as-is.

---

## ⚠️ Ephemeral filesystem (read this before going live)

**Render's free-tier local disk is ephemeral.** `STORAGE_DRIVER=local`
(default in `render.yaml`) stores food-scan uploads under `./uploads` inside
the running service — **every file vanishes on redeploy or restart.**
Fine for testing; for anything you want to keep, switch to the S3-compatible
driver.

Click-by-click:

1. Get an S3-compatible bucket (AWS S3, Cloudflare R2, or any S3-compatible
   provider).
2. Render dashboard → the web service → **Environment** → add these
   variables (names are from `.env.example`, which is the source of truth):
   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<your-endpoint>
   S3_REGION=<your-region>
   S3_BUCKET=<your-bucket>            # private bucket, no public access
   S3_ACCESS_KEY_ID=<your-access-key>
   S3_SECRET_ACCESS_KEY=<your-secret>
   # S3_FORCE_PATH_STYLE=true        # default; set "false" for virtual-hosted style
   ```
3. **Save** (triggers a redeploy). New uploads now persist across deploys.

Notes:
- The same `S3_*` names work locally via `.env` (copy them from
  `.env.example`). Missing vars fail loudly as `not_configured` naming the
  missing var — secret values are never logged. Full details, bucket
  permissions, and the minimal IAM policy: `docs/storage.md`.
- `STORAGE_LOCAL_DIR` (default `./uploads`) only applies to the `local`
  driver; with `s3` it is ignored.

---

## Production requirements

1. **Managed PostgreSQL 16** — the Blueprint's `fitfusion-db` covers this.
   Migrations are applied with `prisma migrate deploy` (what the Blueprint
   runs). **Never run `prisma db push` on production** — it bypasses the
   migration history and can lose data. The health check verifies migrations
   (`checks.migrations.ok`); a 503 there means migrations haven't been
   applied — run `npm run db:migrate` from the Shell.
2. **Durable storage** — see "Ephemeral filesystem" above: production needs
   `STORAGE_DRIVER=s3`, not `local`.
3. **Free-tier limits**: the service **sleeps after inactivity** (first
   request after idle takes ~30–60s to wake) — fine for testing, upgrade the
   plan when it matters. Also check the Render dashboard for the **free
   PostgreSQL expiry date** (free databases do not last forever): export or
   back up your data before then, or move to a paid database plan.

---

## Upload purge scheduling (recommended)

Expired uploads (transient menu extracts, failed / not-configured scan
photos) accumulate unless something deletes them. `POST /api/uploads/purge`
deletes every file whose `Upload.expiresAt` has passed (default retention
`UPLOAD_TEMP_RETENTION_HOURS=24`) and its registry row. It is **admin-only**
via your normal admin login — there is **no API key**: the route calls
`requireAdmin`, which checks your session cookie (`ff_session`) against the
`ADMIN_EMAILS` allowlist. There is no in-repo scheduler, so schedule it
outside the app.

### Option A — Render Cron Job (recommended), hourly

Render dashboard → **New** → **Cron Job** → name it `fitfusion-upload-purge`
→ schedule `0 * * * *` (hourly) → set:

- **Build command:** `npm install --omit=dev`
- **Run command** — logs in as your admin user, then triggers the purge
  (`--fail` makes curl exit non-zero on 401/403 so a bad credential shows as
  a failed run, not a silent pass):
  ```bash
  bash -c 'set -e;
  curl -sS --fail -c /tmp/jar -X POST "$APP_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$PURGE_ADMIN_EMAIL\",\"password\":\"$PURGE_ADMIN_PASSWORD\"}" > /dev/null;
  curl -sS --fail -b /tmp/jar -X POST "$APP_URL/api/uploads/purge"'
  ```
- **Environment variables** (add as secret values, dashboard → the cron
  job → Environment):
  ```
  APP_URL=https://<your-service>.onrender.com
  PURGE_ADMIN_EMAIL=<your-admin-email>      # must be in ADMIN_EMAILS
  PURGE_ADMIN_PASSWORD=<your-admin-password>
  ```

`render.yaml` currently ships **no cron jobs** — this is deliberately a
manual dashboard step: it needs *your* admin credentials as secret env vars,
which can never live in the repo.

### Option B — trigger manually

Log in as an admin user in the browser, then run from any machine with
`curl` (works from PowerShell too, with the quotes adjusted):

```bash
# 1) log in, saving the session cookie
curl -sS -c jar.txt -X POST https://<your-service>.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<your-admin-email>","password":"<your-admin-password>"}'
# 2) run the purge
curl -sS -b jar.txt -X POST https://<your-service>.onrender.com/api/uploads/purge
```

Expected response: `{"purged":{"deleted":<n>,"errors":0}}`.

---

## Seed guarantees (verified against `packages/db/src/seed-safety.ts`)

- **Idempotent**: re-running the seed on an unchanged database performs
  **zero writes** — every record reports `unchanged`, and the runner prints
  a per-type report (`created / updated / unchanged / skipped / failed`).
- **Your data is never touched**: private user-created recipes (`userId` set
  or `isPrivate`) are always `skipped`, never overwritten.
- **Evidence honesty**: review/verification evidence is preserved across
  runs. It is invalidated (`verified: false`, evidence cleared) only when
  the seed content **materially** changes — detected by content hash plus
  derived nutrition numbers — so a verified badge can never silently survive
  a recipe change.
- **Exercise media preserved**: the seed never writes `mediaType`/`mediaUrl`
  on update unless the seed entry explicitly carries media — media imported
  from an authorized source survives repeated seed runs.
- **Conflict-safe**: updates are conditional on the recipe's `revision`
  (`updateMany` with a revision guard) — a concurrent mutation mid-run
  reports `failed` instead of silently overwriting.

## Migrations (19 total)

`packages/db/prisma/migrations/` contains 19 migrations (plus
`migration_lock.toml`):

1. `20261009063241_init`
2. `20261009162647_add_stripe_billing_fields`
3. `20261009220000_add_past_due_since`
4. `20261010010000_add_checkout_session_tracking`
5. `20261012111231_v18_food_location_models`
6. `20261012214000_add_profile_fasting_session`
7. `20261012214000_v20_calorie_target_override`
8. `20261012214500_v20_micronutrients`
9. `20261012220000_v20_google_fit_sync`
10. `20261013120000_v21_recipe_fields`
11. `20261013161000_v212_food_serving_weight`
12. `20261014021500_v212_recipe_aliases`
13. `20261014100000_v213_recipe_review_evidence`
14. `20261015053000_v214_diary_partial_flag`
15. `20261015090000_v214_recipe_allergen_screening`
16. `20261015121500_v215_recipe_content_hash`
17. `20261015195900_v217_recipe_revision`
18. `20261016133000_v218_menu_submissions`
19. `20261016133000_v218_upload_ownership`

---

## Notes and limits

- The free tier **sleeps after inactivity** — the first request after idle
  takes ~30–60s to wake. Fine for testing; upgrade the service (and database)
  plans when it matters.
- `EMAIL_DRIVER=console` logs emails to the service logs. Configure SMTP for
  real verification/password-reset emails.
