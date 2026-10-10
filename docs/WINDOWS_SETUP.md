# FitFusion AI — Windows Local Setup Guide

> **Status: written from documentation, NOT executed on Windows.**
> Every command below is written from the official docs of Node.js, PostgreSQL,
> Prisma, and Next.js plus verification of this repo's scripts on Linux — but
> nobody has run this end-to-end on a Windows machine yet. Dr. Ammad: please do
> a run-through and report anything that differs; this file will be corrected
> from your feedback.

All commands are PowerShell. No `.ps1` script files are used anywhere, so
PowerShell execution-policy restrictions do not apply.

---

## 0. The one rule about configuration

**There is exactly ONE env file: `.env` at the REPO ROOT** (the folder that
contains `package.json`, `apps/`, and `packages/`).

- Create it once: `Copy-Item .env.example .env` (see step 4).
- Edit it with Notepad or any editor. This is the only file you ever edit for
  configuration.
- **Do NOT create `apps/web/.env`** (or `.env.local` next to it). It will
  silently compete with the root `.env` and cause confusing behavior.
  `node scripts/check-env.mjs` errors out if such a file exists.

Why this works (verified, not assumed):

1. `apps/web/next.config.js` **explicitly loads the repo-root `.env`** via
   `dotenv` at startup, before anything reads `process.env`. (Next.js 14 has
   no `envDir` option — without this, it would only look inside `apps/web/`.)
2. `dotenv` only fills variables that are **not already set**, so a real
   environment (CI, Docker, your shell) always wins over the file.
3. Every variable in the root `.env` (`DATABASE_URL`, `AI_*`,
   `SESSION_SECRET`, …) is therefore available to the server **from the very
   first request** — deterministically. We do NOT depend on
   `@prisma/client`'s bundled self-load of the root `.env`: it exists, but it
   proved unreliable across `prisma generate` runs, so it is treated as a
   harmless fallback, never the mechanism.

> **Optional:** if you prefer, you can still preload the `.env` into your
> PowerShell session with the snippet in step 7 (it simply takes precedence
> over the file — useful for temporarily overriding a value without editing).

---

## 1. Install Node.js 20+

Engines requirement: **Node >= 20**. Either:

```powershell
# Option A — winget (recommended)
winget install OpenJS.NodeJS.LTS

# Option B — download the LTS installer from https://nodejs.org and run it
```

Close and reopen PowerShell afterwards, then verify:

```powershell
node --version   # must print v20.x.x or higher
npm --version
```

## 2. Install PostgreSQL 16 (pick ONE of A or B)

### Option A — EDB installer (simplest, no Docker)

```powershell
winget install PostgreSQL.16
```

or download from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
and run the installer. During setup:

- Remember the password you set for the `postgres` superuser.
- Keep port **5432**.
- You can uncheck Stack Builder at the end.

Verify the service is running:

```powershell
Get-Service postgresql*
# Status should be "Running". If not:
Start-Service postgresql-x64-16
```

Make sure `psql` is on your PATH (the installer offers this; if you skipped it,
add `C:\Program Files\PostgreSQL\16\bin` to PATH and reopen PowerShell):

```powershell
psql --version
```

### Option B — Docker Desktop (disposable database)

```powershell
winget install Docker.DockerDesktop
```

Start Docker Desktop, then from the repo root:

```powershell
docker compose up -d
docker compose ps   # the "fitfusion-db" container should be healthy
```

The `docker-compose.yml` at the repo root uses credentials that already match
the `DATABASE_URL` example in `.env.example`, so no `.env` changes are needed.
Skip step 3 if you use this option.

> **Port conflict:** if you have BOTH a local PostgreSQL (Option A) and try
> `docker compose up`, the container fails because port 5432 is taken. Use one
> or the other. (Alternatively, map `"5433:5432"` in `docker-compose.yml` and
> point `DATABASE_URL` at `localhost:5433`.)

## 3. Create the database and role (Option A only)

The defaults below match `.env.example`, so you can copy-paste:

```powershell
# Create the role (password must match DATABASE_URL in your .env)
psql -U postgres -h localhost -c "CREATE ROLE fitfusion WITH LOGIN PASSWORD 'fitfusion_dev_pw' CREATEDB;"

# Create the database owned by that role
psql -U postgres -h localhost -c "CREATE DATABASE fitfusion OWNER fitfusion;"
```

(You will be prompted for the `postgres` superuser password you set during
install.) If you prefer different credentials, change them in **both** places:
here and in your root `.env`'s `DATABASE_URL`.

Quick sanity check:

```powershell
psql "postgresql://fitfusion:fitfusion_dev_pw@localhost:5432/fitfusion" -c "SELECT version();"
```

## 4. Get the code and install dependencies

Unzip the source zip (or clone), then in PowerShell:

```powershell
cd C:\path\to\fitfusion-ai
npm install
```

This installs the root workspace plus `apps/web`, `packages/core`,
`packages/db`, and `packages/ai` (npm workspaces).

## 5. Create and validate your `.env`

```powershell
# From the repo root:
Copy-Item .env.example .env
notepad .env
```

Minimum to check in `.env`:

- `DATABASE_URL` — keep the default if you followed step 3 / Docker defaults:
  `postgresql://fitfusion:fitfusion_dev_pw@localhost:5432/fitfusion`
- `SESSION_SECRET` — replace the placeholder with a long random string.
  (PowerShell one-liner to generate one:
  `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))`)
- `AI_API_KEY` etc. — only if you want AI features; leave unset otherwise
  (the app degrades gracefully to "not configured").

Then validate (this is the fail-fast — it exits non-zero with a clear message
instead of a cryptic Prisma stack later):

```powershell
node scripts/check-env.mjs
# expected: "env OK — using C:\path\to\fitfusion-ai\.env"
```

## 6. Database: generate client, migrate, seed

```powershell
# From the repo root:

# 1. Generate the Prisma client (works offline of the DB; needs no DATABASE_URL)
npm run db:generate

# 2. Apply migrations. From the repo root, `npm run db:migrate` is the
#    supported command (it runs the --schema form below from the root, where
#    the Prisma CLI loads the root .env itself: "Environment variables loaded
#    from .env"). Do NOT use `npm run db:migrate --workspace @fitfusion/db`:
#    that nested script runs the Prisma CLI inside packages/db, where it
#    cannot see the root .env and fails with P1012 "Environment variable not
#    found: DATABASE_URL".
npm run db:migrate
# — equivalent: npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

# 3. Seed demo data (recipes, exercises, foods). Safe to re-run.
npm run db:seed
```

Expected: `migrate deploy` prints "No pending migrations to apply." (or applies
them), and `db:seed` finishes without errors.

## 7. Start the dev server

```powershell
# From the repo root:
npm run dev --workspace apps/web
```

Wait for `✓ Ready in ...` / `Local: http://localhost:3000`, then open:

- App: http://localhost:3000
- Health: http://localhost:3000/api/health — should return `"ok": true`
  (pretty-print it with
  `Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json -Depth 5`).

> **Optional — full env from the very start:** as explained in step 0, the
> root `.env` is already loaded by `next.config.js` at startup (before the
> first request), so this is normally unnecessary. If you want to
> *temporarily override* a value without editing the file, import `.env`
> into the PowerShell session first (commands only, no script file) —
> session variables take precedence over the file:
>
> ```powershell
> Get-Content .env | ForEach-Object {
>   if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
>   $k, $v = $_ -split '=', 2
>   [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), 'Process')
> }
> npm run dev --workspace apps/web
> ```
>
> This affects only the current PowerShell window.

## 8. Run the tests

```powershell
# From the repo root — unit tests across all workspaces:
npm test

# Web integration tests (need PostgreSQL running + DATABASE_URL in the shell —
# run the step-7 env-import snippet first in a fresh PowerShell window; they use
# a real database and clean up after themselves):
npm run test --workspace apps/web

# Type check:
npm run typecheck --workspace apps/web

# E2E (Playwright) — install browsers once first:
npx playwright install chromium --with-deps
npm run test:e2e --workspace apps/web
```

---

## 9. Stripe test webhooks (optional, needs real test-mode keys)

> **Written from documentation, NOT executed on Windows.**

Local testing of the paid-checkout flow uses the Stripe CLI to forward
test-mode events to your dev server. **Keep test and live keys separated:**
test keys start with `sk_test_...` and their Price IDs are different objects
from live ones — never mix them. While any key is `sk_test_...`, nothing can
charge real money.

```powershell
# 1. Install the Stripe CLI and log in (opens a browser):
winget install Stripe.StripeCLI
stripe login

# 2. From the repo root, with the dev server RUNNING, forward test events:
stripe listen --forward-to localhost:3000/api/billing/webhook
# The CLI prints a signing secret (whsec_...) — put THAT value in your
# root .env as STRIPE_WEBHOOK_SECRET. It is local-only and differs from the
# dashboard's webhook secret (which is for your deployed APP_URL).

# 3. In a second PowerShell window, trigger a test event:
stripe trigger checkout.session.completed
# Watch the dev-server window: the webhook should return 200 and activate
# the plan. Check delivery with: stripe logs tail
```

Fill the other three Stripe vars from the Stripe **dashboard in Test mode**
(orange banner on): `STRIPE_SECRET_KEY` (`sk_test_...`) from Developers →
API keys; `STRIPE_PRICE_DIET` / `STRIPE_PRICE_DIET_EXERCISE` (`price_...`)
from Products (create the two paid products as recurring prices first).
Then restart the dev server and re-run `node scripts/check-env.mjs`.

---

## Troubleshooting

### `node scripts/check-env.mjs` fails

Read the `error:` lines — each names the exact file and the fix (usually:
`.env` missing → `Copy-Item .env.example .env`; or a stray `apps/web/.env`
to delete).

### `Refusing to run with NODE_ENV=production: SESSION_SECRET has an obvious placeholder value`

You deployed with an example/`changeme`-style secret. Generate a real one and
put it in `SESSION_SECRET`:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
```

The app refuses to start with `NODE_ENV=production` until this is a real
secret (in dev it is only a warning).

### Port 3000 already in use

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object OwningProcess, @{n='Name';e={(Get-Process -Id $_.OwningProcess).ProcessName}}
# then:
Stop-Process -Id <pid> -Force
```

(or start on another port: `npm run dev --workspace apps/web -- --port 3001` —
note the `--` before `--port`).

### PostgreSQL not running / connection refused

```powershell
Get-Service postgresql*
Start-Service postgresql-x64-16
```

If you used Docker: `docker compose ps` — the container must be `healthy`;
`docker compose logs db` shows why not. Remember the port-5432 conflict: only
one of local PostgreSQL / Docker may own the port.

### `password authentication failed for user "fitfusion"` (P1000)

The role password in PostgreSQL doesn't match `DATABASE_URL` in your root
`.env`. Reset it:

```powershell
psql -U postgres -h localhost -c "ALTER ROLE fitfusion WITH PASSWORD 'fitfusion_dev_pw';"
```

### `Environment variable not found: DATABASE_URL` (P1012)

You ran a Prisma CLI command from the wrong directory (e.g.
`npm run db:migrate --workspace @fitfusion/db`, which executes inside
`packages/db`). From the **repo root**, always use `npm run db:migrate`:

```powershell
npm run db:migrate
# runs: npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

### Prisma engine download fails during `db:generate`

Prisma downloads its query-engine binary on first generate. Behind a
corporate proxy or aggressive antivirus this can fail. Fixes:

- Set the proxy for the session: `$env:HTTPS_PROXY="http://proxy:port"` (and
  `HTTP_PROXY`).
- Allow-list `%USERPROFILE%\.cache\prisma` / the npm cache in your antivirus.
- Retry `npm run db:generate` — the download resumes.

### `/api/health` returns 503

Read the `checks` object and the `message` field — it tells you exactly which
leg failed:

- `checks.env.ok: false` → fix the root `.env` (see `missingVars` for names).
- `checks.database.ok: false` → PostgreSQL isn't reachable (service down,
  wrong `DATABASE_URL`, firewall).
- `checks.migrations.ok: false` → run the `migrate deploy` command from step 6.

### `npm` / `npx` not recognized

Close and reopen PowerShell after the Node.js install (PATH refresh), or
reboot.

### AI features show "not configured" though `AI_API_KEY` is set

Since the root `.env` is now loaded explicitly at startup (step 0), this
should not happen on a fresh start. If it does: check for typos in the
variable name in your root `.env`, make sure you saved the file, and restart
the dev server. (Do NOT create an `apps/web/.env` — run
`node scripts/check-env.mjs`; it flags that mistake.)

---

## Quick reference (repo root)

| Task | Command |
|---|---|
| Validate env | `node scripts/check-env.mjs` |
| Generate Prisma client | `npm run db:generate` |
| Apply migrations | `npm run db:migrate` (repo root; runs `prisma migrate deploy` with `--schema` from the root, where the CLI loads the root `.env`) |
| Seed demo data | `npm run db:seed` |
| Start dev server | `npm run dev --workspace apps/web` |
| Health check | `Invoke-RestMethod http://localhost:3000/api/health` |
| Start disposable DB (Docker) | `docker compose up -d` |
| Stop disposable DB | `docker compose down` |
| Forward Stripe test webhooks | `stripe listen --forward-to localhost:3000/api/billing/webhook` |
