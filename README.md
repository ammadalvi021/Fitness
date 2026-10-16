# FitFusion AI

AI-powered fitness, diet & healthy-lifestyle PWA. Monorepo: Next.js 14 App Router
web app (`apps/web`), pure business logic (`@fitfusion/core`), Prisma +
PostgreSQL data layer (`@fitfusion/db`), and an OpenAI-compatible AI adapter
(`@fitfusion/ai`, **server-only**).

**Cross-package contract:** [`CONTRACT.md`](./CONTRACT.md) is the single source of
truth for interfaces between packages. Read it before changing any shared API.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        apps/web (Next.js 14)                 │
│  app/(marketing)  landing, pricing, auth pages               │
│  app/(app)        authenticated shell: dashboard, nutrition, │
│                   workouts, scanner, recipes, coach, ...     │
│  app/api/**/route.ts   REST API (JSON, NextResponse.json)    │
│  lib/auth.ts  lib/storage.ts  lib/email.ts                   │
│  public/manifest.webmanifest  public/sw.js  (PWA)            │
└───────┬──────────────────┬─────────────────┬─────────────────┘
        │                  │                 │
        ▼                  ▼                 ▼
┌──────────────┐   ┌───────────────┐   ┌────────────────────────┐
│@fitfusion/   │   │ @fitfusion/db │   │ @fitfusion/ai          │
│ core         │   │ Prisma + PG16 │   │ SERVER ONLY            │
│ pure logic,  │   │ schema,       │   │ OpenAI-compatible      │
│ no I/O       │   │ migrations,   │   │ chat + vision          │
│ (vitest)     │   │ seeds, prisma │   │ graceful               │
│              │   │ singleton     │   │ not_configured         │
└──────────────┘   └───────┬───────┘   └───────────┬────────────┘
                           │                     │
                           ▼                     ▼
                    ┌──────────────┐      ┌─────────────────────┐
                    │ PostgreSQL   │      │ AI provider         │
                    │ 16 (source   │      │ (OpenAI-compatible  │
                    │ of truth)    │      │ chat completions)   │
                    └──────────────┘      └─────────────────────┘
```

- `@fitfusion/core` is pure functions only — no I/O, no network, no database.
  Unit-tested with vitest.
- `@fitfusion/db` owns the Prisma schema, migrations, and seeds. PostgreSQL is
  the authoritative source of persistent data.
- `@fitfusion/ai` is a thin server-only adapter over any OpenAI-compatible chat
  completions endpoint. **Never import it from client components** — it reads
  `AI_API_KEY` and must stay server-side.
- API routes return `{ error: { code, message } }` on failure and validate every
  input server-side with zod.

---

## Prerequisites

- **Node.js 20+** (engines field enforces `>=20`)
- **PostgreSQL 16** (authoritative data store; browser local state is never a
  source of truth)
- npm (workspaces; root `npm install` installs all workspaces)

---

## Setup

```bash
# 1. Install (root install already done in this environment; fresh checkouts:)
npm install --ignore-scripts
# Note: prisma ships prebuilt engines; if `prisma generate` fails to fetch
# engines (offline/proxy), re-run: npm run db:generate --workspace @fitfusion/db

# 2. Configure environment
cp .env.example .env
# then edit .env (see "Environment variables" below)

# 3. Database: apply migrations, then seed reference data
npm run db:generate        # prisma generate (engines; retry if network flakes)
# From the repo root, `npm run db:migrate` is the supported command — it runs
# `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` from
# the repo root, so the Prisma CLI loads the root .env itself ("Environment
# variables loaded from .env"). (The nested workspace script
# `npm run db:migrate --workspace @fitfusion/db` executes inside packages/db,
# where it cannot see the root .env and fails from a clean shell with P1012
# "Environment variable not found: DATABASE_URL" — do not use it directly.)
npm run db:migrate            # production-safe
npm run db:seed            # recipes (270), exercises (~50), starter foods

# 4. Run the dev server
npm run dev --workspace apps/web   # http://localhost:3000

# 5. Verify
open http://localhost:3000/api/health   # { ok:true, checks:{database, env, migrations} }

# 6. Gates
npm run typecheck   # tsc --noEmit across all workspaces
npm run test        # vitest across all workspaces
npm run build       # tsc builds for packages
npm run build:web   # next build
npm run test:e2e --workspace apps/web   # playwright smoke spec

For schema development (not production): `npm run db:migrate:dev --workspace @fitfusion/db`
(`prisma migrate dev`).

## Daily use: start / stop

```bash
# Start (from the repo root)
npm run dev --workspace apps/web        # http://localhost:3000

# Stop: Ctrl+C in the terminal running the dev server.

# Production-ish local run
npm run build:web                      # next build
npm run start --workspace apps/web     # next start on http://localhost:3000
```

## Database reset (non-destructive guidance)

`prisma migrate deploy` is forward-only: it never deletes data. There is no
wipe script in this repo, by design — a scripted wipe of user data is never
something you want one typo away.

- **Disposable Docker database** (matches `docker-compose.yml`): to start
  completely fresh, stop and delete the container's data volume, then redo
  the database steps from "Setup" above:
  ```bash
  docker compose down -v   # deletes the fitfusion-pgdata volume (dev data gone)
  docker compose up -d
  npm run db:migrate   # from the repo root; production-safe, forward-only
  npm run db:seed
  ```
  Only ever do this against the **disposable** container. Never point a
  destructive command at a production `DATABASE_URL`.
- **Removing test accounts only** (keeps reference data): the integration
  tests clean up after themselves (`tests/integration/helpers.ts`
  `cleanupUsers`). For manual cleanup, delete the user row in PostgreSQL —
  related rows cascade via the schema's `onDelete: Cascade` relations.

> **On Windows?** Follow [`docs/WINDOWS_SETUP.md`](./docs/WINDOWS_SETUP.md)
> (PowerShell guide; written from documentation, not yet executed on Windows).
> For a disposable database, `docker-compose.yml` at the repo root spins up
> PostgreSQL 16 (`docker compose up -d`, then set `DATABASE_URL` to the
> container's connection string).

---

## Local URLs

- App: `http://localhost:3000`
- Health check: `http://localhost:3000/api/health` — `{ ok, time, version?, checks: { database: { ok, latencyMs }, env: { ok, missingVars[] }, migrations: { ok } }, message? }`. Returns 200 when everything is healthy, 503 with a failure hint otherwise. Never exposes secret values (missing env vars are listed by name only).

---

## Environment variables

Every variable lives in `.env.example` (copy to `.env`). **Single source of
truth:** the repo-root `.env` (next to the root `package.json`) is the ONE AND
ONLY env file — never create `apps/web/.env` (it would silently compete with
the root file). `apps/web/next.config.js` explicitly loads the repo-root `.env`
via `dotenv` at startup, before anything reads `process.env`. Secrets are
**server-side only** — never expose them via `NEXT_PUBLIC_*` or client bundles.
`scripts/check-env.mjs` validates your env (lists missing variable names only —
never values) and errors if a competing `apps/web/.env` exists.

**Hosted deployments:** the repo-root `.env` is the documented *local-dev*
file, but it is not mandatory. When `DATABASE_URL` and `SESSION_SECRET` are
provided as platform environment variables (Vercel/Render/Fly dashboard, CI
secrets, systemd, Docker env), check-env and `GET /api/health` accept them and
no physical `.env` file is required. **Production rule:** with
`NODE_ENV=production`, placeholder secrets (the `SESSION_SECRET` example value,
`changeme`, etc.) are **rejected** — the app refuses to start with them. In
development they only produce a warning.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string (PostgreSQL 16) |
| `APP_URL` | yes | `http://localhost:3000` | Public base URL (emails, OAuth callbacks) |
| `SESSION_SECRET` | yes | — | Signs session cookies; rotate to invalidate sessions |
| `SESSION_TTL_DAYS` | no | `30` | Session lifetime in days |
| `NEXT_PUBLIC_APP_NAME` | no | `FitFusion AI` | Branding override (client-safe) |
| `AI_BASE_URL` | no | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `AI_API_KEY` | no | — | AI provider key (**server-only**). Unset ⇒ graceful `not_configured` |
| `AI_MODEL` | no | — | Chat model (e.g. `gpt-4o-mini`). Needed for chat features |
| `AI_VISION_MODEL` | no | — | Vision model. Needed for food-scan |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | — | Google OAuth; when unset, buttons hidden, API returns `not_configured` |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | no | — | Apple OAuth; same behavior as Google |
| `BILLING_PROVIDER` | no | `none` | `none` \| `sandbox` \| `stripe` |
| `STRIPE_SECRET_KEY` | stripe only | — | Stripe secret (**server-only**). Key alone is NOT enough — all four Stripe vars are required |
| `STRIPE_WEBHOOK_SECRET` | stripe only | — | Stripe webhook signing secret (verifies HMAC on `/api/billing/webhook`) |
| `STRIPE_PRICE_DIET` | stripe only | — | Stripe Price ID for the Diet plan (resolved server-side, never from the client) |
| `STRIPE_PRICE_DIET_EXERCISE` | stripe only | — | Stripe Price ID for the Diet+Exercise plan (resolved server-side, never from the client) |
| `STORAGE_DRIVER` | no | `local` | `local` \| `s3` for food-scan uploads |
| `STORAGE_LOCAL_DIR` | no | `./uploads` | Local driver dir (relative to `apps/web`), served from `/uploads` |
| `STORAGE_ENDPOINT` / `STORAGE_REGION` / `STORAGE_BUCKET` | s3 only | — | S3-compatible endpoint config |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | s3 only | — | S3 credentials (**server-only**) |
| `UPLOAD_MAX_MB` | no | `8` | Max food-photo upload size in MB |
| `EMAIL_DRIVER` | no | `console` | `console` (dev, logs to stdout) \| `smtp` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | smtp only | — | SMTP credentials (**server-only**) |
| `EMAIL_FROM` | no | `FitFusion AI <no-reply@example.com>` | From address for verification/reset emails |

### AI provider configuration

- Any **OpenAI-compatible** chat-completions endpoint works: OpenAI, Azure
  OpenAI, or a self-hosted gateway — set `AI_BASE_URL`, `AI_API_KEY`,
  `AI_MODEL`, `AI_VISION_MODEL`.
- **Graceful `not_configured` behavior:** when `AI_API_KEY` is missing, every
  `@fitfusion/ai` function returns `{ status: "not_configured" }` immediately
  with **no network call**. API routes map this to the scan/coach `not_configured`
  states in the contract; the deterministic (non-AI) meal-plan generator in
  `@fitfusion/core` keeps working without any keys.
- `GET /api/config` exposes `{ ai: { chat, vision } }` capability flags
  (via `aiStatus()`); the UI hides/disables AI features accordingly.
- **Never-fabricate rule:** if the model response can't be parsed or validated,
  functions return `{ status: "error", items: [], ... }` — they never invent
  food items, meals, recipes, or advice.

### Billing provider configuration

- `BILLING_PROVIDER=none` (default, safe): no billing at all. Requesting a paid
  plan is **rejected with HTTP 402** (error code `payment_required`) — a paid
  plan can never become active locally without a provider confirmation.
- `sandbox` (test-only): simulated upgrades are allowed but always clearly
  labeled test-only; nothing is ever charged.
- `stripe`: **all four** Stripe vars are required — `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_DIET`, `STRIPE_PRICE_DIET_EXERCISE`.
  An API key alone is insufficient: without the webhook secret the webhook
  cannot be verified (checkouts refuse with 503), and without the Price IDs no
  checkout session can be built.
- **Safety rule (enforced in `apps/web/lib/billing.ts`):** paid entitlement
  happens ONLY through the Stripe webhook (`POST /api/billing/webhook`) after
  Stripe confirms payment. `selectPlan` can never activate a paid plan by
  itself. Cancellation in stripe mode calls real Stripe
  (`POST /api/billing/cancel`); the local plan changes only when the webhook
  confirms (`customer.subscription.deleted` / `updated`).
- Webhook URL pattern: `{APP_URL}/api/billing/webhook` (e.g.
  `https://app.example.com/api/billing/webhook`). `APP_URL` is also used for
  the Stripe checkout success/cancel redirect URLs.

**Billing API routes** (`apps/web/app/api/billing/`):

| Route | Method | Contract |
|---|---|---|
| `/api/billing/checkout` | POST | `{ planId }` → `{ url }` (Stripe Checkout redirect target). Authenticated; the Price ID is resolved server-side from `config/plans.ts` `STRIPE_PRICE_ENV` — never from the client. 401 unauthenticated, 400 unknown/unavailable/free plan, 503 Stripe not configured |
| `/api/billing/webhook` | POST | Raw-body HMAC verification (`STRIPE_WEBHOOK_SECRET`), idempotent via the `StripeWebhookEvent` table (replayed events are ignored). Handles `checkout.session.completed` → activates the plan, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` → downgrades to free |
| `/api/billing/cancel` | POST | Authenticated. In `stripe` mode calls real Stripe (`subscription.cancel()`); the local change happens only via the webhook. In `none`/`sandbox` mode downgrades locally (labeled test-only in sandbox) |
| `/api/billing/status` | GET | `{ billing, entitlement: { entitled, planId, status, provider, pastDueGraceUntil } }`. Authenticated, **read-only** — never grants or revokes. `entitled` is computed server-side with `subscriptionGrantsPaidAccess()` (incl. the `PAST_DUE_GRACE_DAYS` policy); `pastDueGraceUntil` is the ISO end of the grace window when `status === 'past_due'`, else `null`. The `/billing/success` page trusts only this result: "Payment confirmed" shows solely for a paid planId with status `active`/`trialing` — `past_due` never reads as confirmed |

**Billing pages:** `/billing/success` polls `GET /api/billing/status` and shows a
pending/support-needed state until payment + subscription status are actually
confirmed — it grants nothing on its own. `/billing/cancelled` makes no API
calls and changes nothing about the subscription; both pages link back to Plans.

**Stripe test-mode dashboard setup** (needs real test-mode keys — not done yet):

1. In the Stripe dashboard, toggle **Test mode**.
2. Developers → API keys → copy the **test** `STRIPE_SECRET_KEY` (`sk_test_...`)
   into `.env`.
3. Products → create the two paid products (Diet, Diet+Exercise), each with a
   recurring (subscription) price → copy the Price IDs (`price_...`) into
   `STRIPE_PRICE_DIET` and `STRIPE_PRICE_DIET_EXERCISE`.
4. Developers → Webhooks → Add endpoint: `{APP_URL}/api/billing/webhook`
   (for local testing, expose the dev server with a tunnel such as
   `stripe listen --forward-to localhost:3000/api/billing/webhook`, then use
   the printed `whsec_...` as `STRIPE_WEBHOOK_SECRET`).
5. Add the events: `checkout.session.completed`, `invoice.payment_succeeded`,
   `invoice.payment_failed`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
6. Restart the dev server (`node scripts/check-env.mjs` and
   `GET /api/health` will confirm the config).

**Verify:** trigger a test checkout, complete it with a Stripe test card
(`4242 4242 4242 4242`), then confirm (a) the webhook returns 200, (b) the
`subscriptions` row shows the paid plan with `stripeSubscriptionId` set, and
(c) replaying the same event ID does not double-activate (idempotency). Until
the test-mode keys exist, everything up to the Stripe boundary is covered by
the mock-HMAC integration tests (`apps/web/tests/integration/stripe-webhook.test.ts`,
`billing-hardening.test.ts`).

**Testing webhooks locally with the Stripe CLI** (not executed in this
environment — run on your own machine):

```bash
# 1. Install the Stripe CLI (https://stripe.com/docs/stripe-cli), then log in:
stripe login

# 2. Forward Stripe test-mode events to the local dev server:
stripe listen --forward-to localhost:3000/api/billing/webhook
# The CLI prints a webhook signing secret (whsec_...) — put THAT value in
# STRIPE_WEBHOOK_SECRET (it is different from the dashboard secret, which is
# only for the deployed URL). Keep the dev server running while you test.

# 3. In another terminal, trigger a test event:
stripe trigger checkout.session.completed
# Watch the dev server logs: the webhook should return 200 and activate the
# plan. `stripe events list` / `stripe logs tail` show delivery status.
```

**Test vs live keys — keep them separated:**

| | Test mode | Live mode |
|---|---|---|
| Secret key prefix | `sk_test_...` | `sk_live_...` |
| Webhook secret prefix | `whsec_...` (from `stripe listen`, or the dashboard's test-mode endpoint) | `whsec_...` from the dashboard's **live** endpoint |
| Price IDs | `price_...` created under Test mode | `price_...` created under **live** Products (different IDs!) |
| Dashboard toggle | Test mode ON (orange banner) | Test mode OFF |

Never mix them: a test `sk_test_...` key with live Price IDs (or vice versa)
fails at the Stripe API. While any key is a `sk_test_...`, nothing can charge
real money. Only switch to live keys when you are ready for real charges —
and re-verify the webhook handshake (`whsec_...`) for the deployed
`{APP_URL}/api/billing/webhook` URL, because the `stripe listen` secret is
local-only.
- Rule: never present plan selection copy as a charge. If `BILLING_PROVIDER`
  is `none`/`sandbox`, the UI must label selection as "not billed".

### Storage configuration

- `local` (default): uploads go to `STORAGE_LOCAL_DIR` under `apps/web` and are
  served from `/uploads`. Fine for dev/single-node.
- `s3`: S3-compatible object storage (endpoint/region/bucket + credentials).
- Food-scan uploads are capped at `UPLOAD_MAX_MB` MB server-side.

### OAuth configuration

- Google and Apple OAuth are optional. When their client ID/secret are unset,
  sign-in buttons are hidden and `GET /api/auth/oauth/[provider]` returns
  `{ configured: false }`.

---

## Running the gates

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run test` | `vitest run` in every workspace |
| `npm run build` | package `tsc` builds |
| `npm run build:web` | `next build` (production app build) |
| `npm run test:e2e --workspace apps/web` | Playwright smoke spec (`apps/web/tests/e2e/smoke.spec.ts`); needs browsers (`npx playwright install chromium`) |
| `npm run dev --workspace apps/web` | `next dev` on `http://localhost:3000` |

### Test suites (verified 2026-10-09)

| Suite | Command | Coverage |
|---|---|---|
| `packages/core` — **102/102** | `npm run test --workspace @fitfusion/core` | Pure business logic: units, BMI/BMR/TDEE, energy, macros, water, nutrition, allergy validation, plans, shopping lists, idempotency, validation |
| `packages/ai` — **6/6** | `npm run test --workspace @fitfusion/ai` | AI adapter contract: `not_configured` behavior when `AI_*` is unset, never-fabricate rule |
| `apps/web` integration — **149/150** across 19 files | `npx vitest run tests/integration` (in `apps/web`) | Auth flow + lifecycle, calculators, clampInt regression, diary idempotency, env config, extended flows, meal plans, public pages + plan gating, scanner + 401s, seed data, Stripe webhook (mock HMAC), billing hardening, billing cancel-safety, webhook gating, weightKg session regression (incl. lb→kg conversion). `tests/setup.ts` neutralizes `AI_*` so AI tests deterministically see `not_configured`. **1 known failure (billing domain, pre-existing):** `billing-checkout-extended.test.ts` §8.8 "direct free-plan downgrade with an active Stripe sub cannot orphan it" — the legacy downgrade path nulls `stripeSubscriptionId`; unrelated to platform/env work, flagged for the billing owner. |
| Playwright smoke — **5/5** | `npm run test:e2e --workspace apps/web` | Real chromium against a live dev server |
| Typecheck | `npm run typecheck` | 0 errors across all workspaces |
| Production build | `npm run build:web` | Exit 0 (76 routes: 50 API + 26 pages) |
| Migrations | `prisma migrate status` | Up to date (2 migrations: `init`, `add_stripe_billing_fields`) |

Acceptance rule (from CONTRACT.md): a feature is **PASS** only when exercised
and verified. `IMPLEMENTED` = code exists but unverified; `PARTIAL` = a required
production path is missing; `PLANNED` = not implemented; `BLOCKED` = external
dependency, with the unblock requirement named.

---

## Troubleshooting

Run `node scripts/check-env.mjs` first — most setup problems show up there
with the exact fix. `GET /api/health` reports which leg failed
(`checks.database` / `checks.env` / `checks.migrations`) without ever
exposing secret values; details go to the server logs.

| Symptom | Cause / fix |
|---|---|
| `node scripts/check-env.mjs` → `Missing required env var(s)` | Set them in the repo-root `.env` (copy `.env.example`), or export them in the shell. Hosted platforms: set them in the platform's env dashboard — no `.env` file needed. |
| `Refusing to run with NODE_ENV=production: SESSION_SECRET has an obvious placeholder value` | You are deploying with an example/`changeme` secret. Generate a real one (`openssl rand -base64 48`) and set it as `SESSION_SECRET`. The app refuses to start in production with a placeholder. |
| Prisma `P1012: Environment variable not found: DATABASE_URL` | You ran a Prisma CLI command from the wrong directory (e.g. `npm run db:migrate --workspace @fitfusion/db`, which executes inside `packages/db`). From the repo root always use: `npm run db:migrate` (runs `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` from the root, where the CLI loads the root `.env`). |
| Prisma `P1000: Authentication failed` / `password authentication failed for user "fitfusion"` | The role password in PostgreSQL doesn't match `DATABASE_URL` in your root `.env`. Reset it: `psql -U postgres -h localhost -c "ALTER ROLE fitfusion WITH PASSWORD '<password-from-DATABASE_URL>';"` |
| `Connection refused` / `can't reach database server` | PostgreSQL isn't running (Linux: `sudo service postgresql start`; Windows: `Start-Service postgresql-x64-16`), or the Docker container is down (`docker compose ps`, `docker compose up -d`). |
| `/api/health` → 503, `checks.migrations.ok: false` | Migrations haven't been applied. From the repo root: `npm run db:migrate`. |
| Port 3000 already in use | `lsof -ti:3000 \| xargs kill` (Linux) or stop the other process; or run on another port: `npm run dev --workspace apps/web -- --port 3001` (note the `--`). |
| AI features show "not configured" though keys are set | Typo in the variable name, unsaved `.env`, or the dev server was started before the edit — restart it. Never create `apps/web/.env`; run `node scripts/check-env.mjs` to check. |
| Stripe checkout → 503 `stripe_not_configured` | `BILLING_PROVIDER=stripe` requires **all four** Stripe vars (key alone is not enough). Test-mode keys start with `sk_test_...`; never mix test keys with live Price IDs (see "Test vs live keys" above). |
| `docker compose up` fails: port 5432 already in use | A local PostgreSQL already owns the port. Use one or the other, or map `"5433:5432"` in `docker-compose.yml` and point `DATABASE_URL` at `localhost:5433`. |

On Windows, see also [`docs/WINDOWS_SETUP.md`](./docs/WINDOWS_SETUP.md)
(PowerShell equivalents; written from documentation, not yet executed on
Windows — please report differences).

---

## PWA notes

- `public/manifest.webmanifest` — app name, icons, theme colors (derived from
  `config/branding.ts`), `display: standalone`.
- `public/sw.js` — service worker; registered by the app, served with
  `Cache-Control: no-cache` so updates propagate (see `next.config.js` headers).
- `public/brand/`, `public/icons/` — logo and maskable icons.
- Installable on mobile/desktop; offline shell is cached by the service worker.

---

## Safety & content boundaries

- **BMI is a screening measure, not a diagnosis.** Adult classification only for
  age ≥ 18; minors get pediatric guidance instead of a classification.
- **Food scan:** "Estimates only — a photo can't show exact portions, oils, or
  hidden ingredients." Every AI scan result carries this disclaimer.
- **Workout:** "Stop exercising and seek medical attention if you feel chest
  pain, dizziness, or unusual shortness of breath."
- **Minors / pregnancy / breastfeeding / eating-disorder risk / medical
  conditions:** no weight-loss deficit is ever prescribed (`calculateCalorieTarget`
  forces `weightLossDisabled=true` and maintenance calories); the AI coach uses an
  eating-disorder-safe completion (kind, non-judgmental, no dieting tactics,
  encourages professional help) and never diagnoses or prescribes extreme diets.
  Standard copy: "Please consult a qualified health professional for personalized
  guidance."
- **Allergy handling:** AI-generated meals/recipes are validated against the
  user's allergy list server-side; violating items are dropped or flagged —
  never silently kept or substituted.
- **AI honesty:** the `@fitfusion/ai` package never fabricates output; parse or
  validation failures return honest `error` results with empty item lists.
- **Secrets:** API keys, session secrets, and OAuth/billing credentials are
  server-side only. Only `NEXT_PUBLIC_*` branding overrides may reach the client.

## Recipe library (v21.2)

- **270 seed recipes across 13 cuisine groups** — 239 engine-computed v21
  batch recipes (Pakistani 60, Indian 24, Middle Eastern 20, Turkish 15,
  Chinese/Japanese/Korean/Thai 15 each,
  Mediterranean/Italian/Mexican/American/Continental 12 each) plus 31
  hand-authored originals.
- **Nutrition is computed, not declared:** batch recipes' per-serving values
  are computed by the recipe engine (`packages/core/src/recipe-engine.ts`)
  from a 182-ingredient catalogue (173 USDA standard-reference basis, 9
  standard-estimate). Nothing is hand-adjusted; recompute tests prove the
  stored numbers match the engine — they do not prove independent accuracy.
- **Data-quality tiers** (`packages/db/prisma/recipe-claims-policy.ts`,
  `docs/recipe-data-quality.md`): all 270 are `calculated-estimate`
  (0 reviewed, 0 verified). 92 carry `needsReview` — unknown/unresolvable
  quantities contribute 0 to totals, never silently partial. The UI shows a
  tier badge per recipe ("Calculated estimate" / "Reviewed" / "Verified")
  plus an "Awaiting review" marker where applicable.
- **Browsing API:** `GET /api/recipes` is server-paginated (`page`/`pageSize`,
  max 48; returns `total`/`pageCount`) with server-side filters (cuisine,
  diet, tags, allergens, kcal/protein ranges, maxTime, difficulty, mealType,
  sort). `q` matches titles AND persisted recipe aliases
  (English/Urdu/Roman Urdu); `GET /api/recipes/meta` returns
  cuisines/tags/mealTypes/difficulties/allergens with counts.
- **Claims honesty:** no recipe carries a `halal-friendly` tag (the tag now
  requires a recorded human review); allergen lists are declared from
  ingredient names and the allergen caveat is shown wherever allergen info
  appears.
- **Concurrency (v21.6/v21.7):** recipes carry a `contentHash` (SHA-256 over
  canonical content incl. food IDs) and an integer `revision` (incremented on
  every mutation). PATCH/review/verify/clear require the (hash, revision)
  pair the client read — stale writes get 409 `stale_recipe`. The
  `db:backfill-hashes` script backfills hashes for existing rows
  (`--dry-run` first); it has **not** been run against production — script
  availability is not backfill performed.

---

## Monorepo layout

```
fitfusion-ai/
  CONTRACT.md            # integration contract (source of truth)
  README.md              # this file
  .env.example           # every env var, documented
  package.json           # workspaces: apps/web, packages/*
  tsconfig.base.json     # shared TS config
  config/
    branding.ts          # app name, logo, colors (env-overridable)
    plans.ts             # Free / Diet / Diet+Exercise catalog + gating
  packages/
    core/                # @fitfusion/core — pure logic, NO I/O (vitest)
      src/               # units, bmi, energy, macros, water, nutrition,
                         # allergy, plans, shopping, idempotency, validation
    db/                  # @fitfusion/db — Prisma schema/migrations/seeds
      prisma/schema.prisma
      prisma/migrations/
      prisma/seed.ts     # recipes (270) + exercises (~50) + starter foods
      src/index.ts       # prisma singleton + types
    ai/                  # @fitfusion/ai — SERVER ONLY, OpenAI-compatible
      src/index.ts       # aiStatus, analyzeFoodImage, generateMealPlanAI,
                         # suggestRecipesAI, coachReply (+ zod schemas)
  apps/
    web/                 # Next.js 14 App Router + Tailwind
      app/api/**/route.ts   # REST API routes
      app/(marketing)/      # landing, pricing, auth pages
      app/(app)/            # authenticated app shell
      components/           # shared UI
      lib/auth.ts lib/storage.ts lib/email.ts
      public/manifest.webmanifest public/sw.js public/brand/ public/icons/
      tests/e2e/smoke.spec.ts  # Playwright smoke tests
```
