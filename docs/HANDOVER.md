# FitFusion AI — Hardening Commission Handover (Phases 1–5 + §12 V3 UX/env/docs addendum)

**Date:** 2026-10-09 · **Verdict rule used throughout:** a feature is **PASS**
only when actually exercised and verified. `IMPLEMENTED` = code exists but not
fully verified. `PARTIAL` = a required production path is missing.
`PLANNED` = not implemented. `BLOCKED` = external dependency, with the unblock
requirement named. A BLOCKED is never converted to PASS by hand.

---

## 1. Files changed + why (the whole commission)

### Phase 2 — Env strategy (deterministic configuration)

| File | Change |
|---|---|
| `apps/web/next.config.js` | Explicitly loads the repo-root `.env` via `dotenv` at startup, before anything reads `process.env`. Without this, Next.js 14 would only look inside `apps/web/`. Proven on cold start |
| `scripts/check-env.mjs` | Fail-fast env validator: lists missing variable NAMES only (never values); errors if a competing `apps/web/.env` exists |
| `apps/web/app/api/health/route.ts` | Extended to `{ ok, time, version?, checks: { database: { ok, latencyMs }, env: { ok, missingVars[] }, migrations: { ok } }, message? }` — 200 when healthy, 503 with failure hints, no secret values |
| `docs/WINDOWS_SETUP.md` | **New.** PowerShell setup guide. Marked: *written from documentation, NOT executed on Windows* |
| `docker-compose.yml` | **New.** Disposable PostgreSQL 16 (`postgres:16-alpine`, port 5432, named volume `fitfusion-pgdata`); default creds match the `.env.example` `DATABASE_URL` so no `.env` change is needed to use it |
| `.env.example` | Phase 5: added the single-source-of-truth comment block at the top, plus commented `STRIPE_PRICE_DIET` / `STRIPE_PRICE_DIET_EXERCISE` placeholders and a comment block explaining the `none` / `sandbox` / `stripe` modes (key alone insufficient) |

### Phase 3 — Billing hardening (genuine Stripe test-mode checkout)

| File | Change |
|---|---|
| `apps/web/lib/billing.ts` | **Rewritten.** `selectPlan` now REJECTS paid plans with `BillingError('payment_required')` / HTTP 402 in `none`/`stripe` modes — a paid plan can never become active locally without a provider confirmation. `sandbox` mode allows a clearly-labeled test-only simulated upgrade |
| `apps/web/app/api/billing/checkout/route.ts` | **New.** `POST /api/billing/checkout`: `{ planId }` → `{ url }`; Price ID resolved server-side from `config/plans.ts` `STRIPE_PRICE_ENV`; 401/503/400s |
| `apps/web/app/api/billing/webhook/route.ts` | **New.** `POST /api/billing/webhook`: raw-body HMAC verification (`STRIPE_WEBHOOK_SECRET`), idempotent via the `StripeWebhookEvent` table; handles `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` |
| `apps/web/app/api/billing/cancel/route.ts` | **New.** `POST /api/billing/cancel`: in `stripe` mode calls real Stripe; the local change happens only via the webhook. In `none`/`sandbox` downgrades locally (test-only label in sandbox) |
| `packages/db/prisma/migrations/20261009162647_add_stripe_billing_fields` | **New.** Adds `stripeCustomerId`, `stripeSubscriptionId` (+ `@unique`), and the `StripeWebhookEvent` table |
| `apps/web/package.json` | `stripe@23.0.0` added |
| `config/plans.ts` | `STRIPE_PRICE_ENV` mapping: `diet` → `STRIPE_PRICE_DIET`, `diet_exercise` → `STRIPE_PRICE_DIET_EXERCISE` |

### Phase 4 — Tests

| File | Change |
|---|---|
| `apps/web/tests/integration/` | Now 14 files, **89/89 passing** — includes `billing-hardening.test.ts` (14), `stripe-webhook.test.ts` (6, mock-HMAC), `env-config.test.ts` (9), `clampint.test.ts` (4), `weightkg-regression.test.ts` (3) |
| `apps/web/tests/setup.ts` | Neutralizes `AI_*` so AI tests deterministically see `not_configured` (fixes an env-race that could make AI tests behave differently across machines) |

### Preserved from earlier (not regressed)

- `apps/web/lib/auth.ts` — session-profile `weightKg` attachment (dashboard/calorie targets work)
- `apps/web/lib/server-api.ts` — `clampInt` fallback (pagination returns 20/page, not 1)

### Phase 5 — Docs (this handover)

- `README.md` — env section (single root `.env` rule, extended var table with the two new `STRIPE_PRICE_*` rows), quickstart + health URL, Windows guide + Docker links, expanded billing section (safety rule, route contracts, Stripe test-mode dashboard steps), test-suite table with verified numbers
- `FEATURE_STATUS.md` — billing rows updated, Phase 1–5 defect list extended, verification-evidence header refreshed
- `docs/HANDOVER.md` — this file

---

## 2. Windows setup — exact PowerShell commands (summarized from `docs/WINDOWS_SETUP.md`)

> Full detail lives in [`docs/WINDOWS_SETUP.md`](./WINDOWS_SETUP.md) — this is a
> summary, not a replacement. **Status: written from documentation, NOT executed
> on Windows.** Please do a run-through and report anything that differs.

```powershell
# 0. Install Node.js 20+ and PostgreSQL 16 (EDB installer), OR Docker Desktop
#    for the disposable database instead:
docker compose up -d          # from the repo root; DB at localhost:5432

# 1. Get the code, install (from the repo root)
cd C:\path\to\fitfusion-ai
npm install

# 2. Create and validate .env (repo-root ONLY — never apps/web/.env)
Copy-Item .env.example .env
notepad .env                  # set SESSION_SECRET (random), DATABASE_URL, optional AI_* / STRIPE_*
node scripts/check-env.mjs    # expected: "env OK — using C:\path\to\fitfusion-ai\.env"

# 3. Database (from the repo root)
npm run db:generate
npm run db:migrate   # repo-root shortcut — runs `npx prisma migrate deploy
# --schema packages/db/prisma/schema.prisma` from the root, where the Prisma
# CLI loads the root .env itself. (Do NOT use
# `npm run db:migrate --workspace @fitfusion/db` — the nested script runs the
# CLI inside packages/db, where it cannot see the root .env and fails with
# P1012 "Environment variable not found: DATABASE_URL".)
npm run db:seed

# 4. Run
npm run dev --workspace apps/web    # http://localhost:3000

# 5. Verify
Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json -Depth 5
```

---

## 3. Env var map

**Where configured:** the repo-root `.env` (copied from `.env.example`) — the ONE
AND ONLY env file. Never create `apps/web/.env`. `node scripts/check-env.mjs`
validates it. Real shell/CI environment variables always win over the file.

| Variable | Required | Where configured | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | root `.env` | PostgreSQL 16 connection string |
| `APP_URL` | yes | root `.env` | Public base URL; used for Stripe success/cancel URLs + webhook URL base (`{APP_URL}/api/billing/webhook`) |
| `SESSION_SECRET` | yes | root `.env` | Signs session cookies; rotate to invalidate sessions |
| `SESSION_TTL_DAYS` | no | root `.env` | Session lifetime (default 30) |
| `NEXT_PUBLIC_APP_NAME` | no | root `.env` | Branding override (client-safe) |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` / `AI_VISION_MODEL` | no | root `.env` | AI provider (server-only). Unset ⇒ graceful `not_configured` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | root `.env` | Google OAuth; hidden until set |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | no | root `.env` | Apple OAuth; hidden until set |
| `BILLING_PROVIDER` | no (default `none`) | root `.env` | `none` \| `sandbox` \| `stripe` |
| `STRIPE_SECRET_KEY` | stripe only | root `.env` | Stripe secret (server-only). Key ALONE is insufficient — all four required |
| `STRIPE_WEBHOOK_SECRET` | stripe only | root `.env` | Webhook signing secret (`whsec_...`) |
| `STRIPE_PRICE_DIET` | stripe only | root `.env` | Stripe Price ID for the Diet plan |
| `STRIPE_PRICE_DIET_EXERCISE` | stripe only | root `.env` | Stripe Price ID for Diet+Exercise |
| `PAST_DUE_GRACE_DAYS` | no (default `7`) | root `.env` | Finite past-due grace window in days; after it expires, paid access is revoked |
| `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR` / `STORAGE_*` (s3) | no / s3 only | root `.env` | Food-scan upload storage |
| `UPLOAD_MAX_MB` | no | root `.env` | Upload cap (default 8) |
| `EMAIL_DRIVER` / `SMTP_*` / `EMAIL_FROM` | no / smtp only | root `.env` | Email; `console` driver logs to stdout in dev |

No secret is ever read by the client (no `NEXT_PUBLIC_*` secrets); `/api/health`
lists missing vars by name only.

---

## 4. DB setup / migration / seed results

- `prisma migrate status` → **"Database schema is up to date!"** — 4 migrations
  found in `packages/db/prisma/migrations` (`20261009063241_init`,
  `20261009162647_add_stripe_billing_fields`, `20261009220000_add_past_due_since`,
  `20261010010000_add_checkout_session_tracking`). (V3, 2026-10-10: the last one
  was pending and applied forward-only — adds `stripeCheckoutSessionId` /
  `stripeCheckoutSessionUrl` to `Subscription`, the duplicate-checkout guard.)
- Seed counts (verified by `seed-data.test.ts`, passing):
  - 13 cuisines · 31 recipes · 50 exercises · 40 starter foods.

---

## 5. Test + build commands (real numbers, independently verified 2026-10-10, V3)

(The 2026-10-09 numbers below are historical — the V2-era table they replaced
is in git history; nothing is re-stated as verified without being re-run.)

| Command | Result |
|---|---|
| `npm run test --workspace @fitfusion/core` | **102/102** passed (11 files: units, BMI, energy, macros, water, nutrition, allergy, plans, shopping, idempotency, validation) |
| `npm run test --workspace @fitfusion/ai` | **6/6** passed (`not_configured` contract, never-fabricate) |
| `npx vitest run tests/integration` (in `apps/web`) | **181/181** passed (22 files — incl. new `billing-status.test.ts` 8/8). **Requires `DATABASE_URL` in the environment** — integration tests fail at setup without it (this is by design; see `tests/setup.ts`) |
| `npm run typecheck` | 0 errors across all workspaces (`npx tsc --noEmit -p apps/web/tsconfig.json` run after clearing stale `apps/web/.next/types`) |
| `npm run db:migrate` | exit 0 — applied the one pending migration forward-only; `migrate status` → up to date (4 migrations) |
| `npm run db:seed` | exit 0 from a clean `env -i` shell — seed self-loads the root `.env` (13/31/50/40, idempotent) |
| `node scripts/check-env.mjs` | exit 0 — `env OK — using …/fitfusion-ai/.env` (plus the `SESSION_SECRET` placeholder warning, his action) |
| `GET /api/health` (dev server, :3000) | 200, `ok:true` — database, env (`missingVars: []`), migrations green |
| `npm run build --workspace apps/web` | **Not re-run in V3** (deliberate: shares `apps/web/.next` with the running dev server — corrupts it. Previous commission verified exit 0.) |
| `npm run test:e2e --workspace apps/web` | **Not re-run in V3.** Previous commission: Playwright smoke **5/5** (chromium, real dev server) |
| Route counts (file-counted, not a build) | 51 API route files + 28 page files under `apps/web/app` (incl. new `GET /api/billing/status`) |

---

## 6. Local URLs

- App: `http://localhost:3000`
- Health: `http://localhost:3000/api/health` — 200 when everything is healthy,
  503 with failure hints otherwise; never exposes secret values.

---

## 7. Stripe routes

| Route | Method | Contract |
|---|---|---|
| `/api/billing/checkout` | POST | `{ planId }` → `{ url }` (Stripe Checkout redirect target). Authenticated. Price ID resolved **server-side** from `config/plans.ts` `STRIPE_PRICE_ENV` — never from the client. 401 unauthenticated · 400 unknown/unavailable/free plan · 503 Stripe not configured |
| `/api/billing/webhook` | POST | Raw-body HMAC verification with `STRIPE_WEBHOOK_SECRET`. **Idempotent** via the `StripeWebhookEvent` table (replayed events are ignored). `checkout.session.completed` → activates the paid plan and records `stripeCustomerId`/`stripeSubscriptionId`; `invoice.payment_succeeded` / `invoice.payment_failed`; `customer.subscription.updated`; `customer.subscription.deleted` → downgrades to free |
| `/api/billing/status` | GET | `{ billing, entitlement: { entitled, planId, status, provider, pastDueGraceUntil } }` (new in V3). Authenticated. **Read-only** — never grants or revokes. `entitled` is computed server-side with `subscriptionGrantsPaidAccess()`, applying the configured past-due grace policy (`PAST_DUE_GRACE_DAYS`, default 7); `pastDueGraceUntil` is the ISO end of the grace window when `status === 'past_due'`, else `null`. The `/billing/success` page trusts only this result: "Payment confirmed" shows solely for a paid planId with status `active`/`trialing` — `past_due` never reads as confirmed. |

**Safety rule (enforced):** paid entitlement happens ONLY via the webhook after
Stripe confirms payment. `selectPlan` can never activate a paid plan by itself.

**Status allowlist (enforced):** a paid `planId` is written ONLY when the
Stripe subscription status is `active` or `trialing`. `incomplete`,
`incomplete_expired`, `unpaid`, `canceled` (or any unknown status) NEVER
grant paid access — in particular the webhook does NOT activate on
`checkout.session.completed` alone while the subscription is `incomplete`;
it records the Stripe binding with `planId: 'free'` and waits for the async
`invoice.payment_succeeded` event.

**Price-ID trust (enforced):** only Price IDs configured via
`STRIPE_PRICE_DIET` / `STRIPE_PRICE_DIET_EXERCISE` map to plans. A
subscription with an unknown or mismatched price grants NO entitlement; the
event is logged and ACKed (200) so Stripe does not retry pointlessly.

**Past-due grace policy (finite, enforced):** `invoice.payment_failed` sets
status `past_due` but KEEPS the paid `planId`. Access continues for
`PAST_DUE_GRACE_DAYS` (root `.env`, default **7** days) counted from
`subscriptions.pastDueSince` — the FIRST failure timestamp; later failures
do not reset the clock. After the window expires the subscription is
downgraded to free. Enforcement: (a) on every subsequent webhook event for
the user, (b) time-based via `npx tsx scripts/enforce-past-due-grace.ts`
(run on a cron — the webhook alone cannot revoke access for a user Stripe
never sends another event about), and (c) access-time via
`subscriptionGrantsPaidAccess()` in `apps/web/lib/billing.ts` — **implemented
and V3-verified in code** in `requirePlan` (`apps/web/lib/auth.ts`): paid gates
require both plan rank AND `subscriptionGrantsPaidAccess()`, so `past_due`-expired
rows stop granting plan features even between webhook deliveries.
`cancel_at_period_end` keeps access until Stripe sends
`customer.subscription.deleted`; immediate cancellation downgrades at once.

---

## 8. Test-mode Stripe setup + verification instructions

1. In the Stripe dashboard, toggle **Test mode**.
2. Developers → API keys → copy the **test** `STRIPE_SECRET_KEY`
   (`sk_test_...`) into `.env`.
3. Products → create the two paid products (Diet, Diet+Exercise), each with a
   recurring (subscription) price → copy the Price IDs (`price_...`) into
   `STRIPE_PRICE_DIET` and `STRIPE_PRICE_DIET_EXERCISE`.
4. Developers → Webhooks → Add endpoint: `{APP_URL}/api/billing/webhook` (for
   local testing, expose the dev server — e.g.
   `stripe listen --forward-to localhost:3000/api/billing/webhook` — and use
   the printed `whsec_...` as `STRIPE_WEBHOOK_SECRET`).
5. Add the events: `checkout.session.completed`, `invoice.payment_succeeded`,
   `invoice.payment_failed`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
6. Restart the dev server; confirm with `node scripts/check-env.mjs` and
   `GET /api/health`.

**Verification:** run a test checkout with card `4242 4242 4242 4242`, then
confirm (a) the webhook returns 200, (b) the `subscriptions` row shows the paid
plan with `stripeSubscriptionId` set, (c) replaying the same event ID does not
double-activate (idempotency), and (d) cancelling flows through the webhook
before the local plan changes. Until the test keys exist, everything up to the
Stripe boundary is covered by the mock-HMAC integration tests
(`stripe-webhook.test.ts`, `billing-hardening.test.ts`).

---

## 9. Outstanding issues + unsupported integrations

### Outstanding issues (not fixed — listed, not silently dropped)

1. **`apps/web/lib/email.ts` console driver logs raw verification/reset links.**
   Verified still present in code (2026-10-10): the console driver logs
   `input.text ?? input.html`, which contains the full links. Dev-only and
   documented; switch to `EMAIL_DRIVER=smtp` in any shared environment.
2. Real Stripe end-to-end (checkout → webhook → activation → cancel): **BLOCKED**
   on his test keys — everything up to the Stripe boundary is tested with
   mocked HMAC signatures only (see §10).

### Fixed since the original list (verified in code, 2026-10-10)

1. **Legacy `POST /api/subscriptions/cancel` desync (old §9.1)** — fixed:
   both the legacy cancel route and `selectPlan` now return 409
   `stripe_cancellation_required` (never clearing `stripeSubscriptionId` /
   `stripeCustomerId` locally) when the row links a live-looking Stripe
   subscription; only the signature-verified webhook clears the linkage.
2. **Plans-page checkout wiring (old §9.2)** — `app/(app)/plans/page.tsx` calls
   `POST /api/billing/checkout` and redirects to the returned Stripe URL, with
   honest "not configured" states in `none` mode. Real Stripe redirect still
   **BLOCKED** on his test keys.
3. **`weightKg` unit conversion (old §9.3)** — fixed: `measurementWeightKg` in
   `apps/web/lib/auth.ts` converts lb/lbs/pound(s) → kg via `kgFromLb`, passes
   kg variants through, nulls unknown units with a server-side warn; covered by
   `weightkg-regression.test.ts` (green in the 181/181 V3 run).

### Unsupported / not-integrated

- Live Stripe (needs his keys — see §8 and §10).
- Live AI (vision scan, AI planner, coach replies) — key present but sandbox
  egress blocks the provider.
- OAuth buttons (Google/Apple) — hidden until client ID/secret set.
- SMTP email, S3 uploads — configured via env, not exercised.
- Exercise demo media — honest "not available" states; needs licensed media.
- Native Android/iOS apps — PLANNED (API-first structure only).

---

## 10. Failures needing Dr. Ammad's action

1. **Stripe test-mode keys:** `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_DIET`, `STRIPE_PRICE_DIET_EXERCISE` — real end-to-end
   (checkout → webhook → activation → cancel) is BLOCKED until these exist.
2. **Windows run-through:** `docs/WINDOWS_SETUP.md` is written from
   documentation and has never been executed on Windows. Run it on his own
   machine and report anything that differs.
3. **Vercel deploy:** still pending his connection + a hosted Postgres (Neon
   free tier suggested). The self-run zip was delivered separately.
4. **Decisions:** none outstanding from this commission — provider default
   stays `none` (safe) unless he explicitly enables `sandbox` or `stripe`.

---

## What was NOT verified (honest list)

- **Real Stripe test-mode end-to-end** (checkout → webhook → activation → cancel):
  BLOCKED on his keys. Everything up to the Stripe boundary is tested with
  mocked HMAC signatures only.
- **Live AI paths** (vision scan, AI meal planner, coach replies): key present
  but sandbox egress blocks the provider; verified only to the honest
  `not_configured` boundary.
- **Windows setup guide**: written from docs, never executed on Windows.
- **Plans-page checkout button**: doesn't exist yet (see §9.2).
- **Production hardening beyond the brief**: rate limiting, monitoring, backup
  procedures — not in scope for this commission.

---

## 11. V2 audit addendum — docs/audit engineer (2026-10-09/10)

Everything below was verified by the docs/audit engineer in a cold shell
(`env -i`, no inherited variables). Other leaf engineers were changing source
concurrently; items I could not personally verify are marked
"per implementing engineer, pending coordinator integration".

### 11.1 Env-loading verification matrix (the §7 support evidence)

| Tool | Mechanism (how it sees the root `.env`) | Cold-shell result |
|---|---|---|
| `next dev` / `next build` / `next start` | `apps/web/next.config.js` runs `dotenv.config({ path: <repo-root>/.env })` at startup, before anything reads `process.env`. Fill-missing only, so real shell/CI env always wins. Next's own env injection then logs `injected env (13) from ../../.env` as a no-op fill-missing pass. | **WORKS** — fresh cold boot, `GET /api/health` → `ok:true` (database, env, migrations all green) |
| `prisma generate` | Needs no env vars at all (no datasource validation at generate time). | **WORKS** — succeeds with zero env vars; env-independent |
| `prisma migrate status` / `migrate deploy` from the **repo root** | Prisma CLI prints `Environment variables loaded from .env` — it loads dotenv from the **current working directory**, so it finds the root `.env` only when run from the repo root. | **WORKS** from repo root |
| `npm run db:migrate` (repo root, V3 fix: now runs `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` from the root) | The CLI loads dotenv from the **current working directory**, so it finds the root `.env` when run from the repo root. | **WORKS** from repo root — verified 2026-10-10: exit 0, applied the pending `20261010010000_add_checkout_session_tracking` migration forward-only; `migrate status` → up to date (4 migrations) |
| `npm run db:migrate --workspace @fitfusion/db` (= nested `prisma migrate deploy` with cwd=`packages/db`, where no `.env` exists) | No `.env` in `packages/db`; nothing loads the root file. | **FAILS** in cold shell: `error: Environment variable not found: DATABASE_URL.` — do not use the nested form; use `npm run db:migrate` from the repo root instead |
| `db:seed` (`tsx prisma/seed.ts`) | Fixed (was defect 11): the tiny loader now uses `join(here, '..', '..', '..', '.env')` — the repo root, one level up from `packages/.env`. | **WORKS** in a clean `env -i` shell — verified 2026-10-10: `Seed complete: cuisines=13 recipes=31 exercises=50 foods=40` (idempotent) |
| vitest suites (`apps/web`) | `tests/setup.ts` throws unless `DATABASE_URL` is in the process environment — no self-load is relied upon, by design. | **FAILS** without export (setup throws, by design); **WORKS** with export (spot-checked `clampint.test.ts` 4/4; full suite §11.4) |

**Single supported layout (unchanged):** exactly one env file — the repo-root
`.env` (copied from `.env.example`). `node scripts/check-env.mjs` is the gate:
exit 0 on the real root `.env`; exit 1 if any of
`apps/web/.env{,.local,.development,.production}` exists (verified: a sentinel
`apps/web/.env` was rejected with exit 1, then deleted — no trace left).

**Shadowing experiment (why the gate exists):** with a temporary
`apps/web/.env` containing a bogus `DATABASE_URL`, a fresh `next dev` boot
served `/api/health` → `ok:false` with the database check failing — the per-app
file's value **won over the root `.env` at runtime**. The sentinel was deleted
afterward and the server restarted clean (`ok:true`). A competing
`apps/web/.env` silently breaks the app, which is exactly what `check-env.mjs`
prevents.

### 11.2 Environment incident during this audit (VM replacement)

When this audit began, PostgreSQL was down and the `fitfusion` role was gone
(VM replaced; data dir partially reset — the `fitfusion` database and all
tables existed, but the role and `_prisma_migrations` rows did not).
Recovery performed: started PostgreSQL, recreated the `fitfusion` role with
the password parsed programmatically from the root `.env` (never printed),
baselined the two existing migrations with
`prisma migrate resolve --applied` (tables already matched the schema — no DDL
ran, no data touched). Seed data verified intact afterward:
13 cuisines / 31 recipes / 50 exercises / 40 foods.

### 11.3 Parallel work — observed then, VERIFIED now (V3, 2026-10-10)

- Migration `20261009220000_add_past_due_since` (`ALTER TABLE "Subscription"
  ADD COLUMN "pastDueSince" TIMESTAMP(3)`) — **verified applied**: column
  present in `packages/db/prisma/schema.prisma` and the DB (`migrate status`
  → up to date, 4/4).
- **`app/(app)/plans/page.tsx` wires paid plans to `POST /api/billing/checkout`**
  with honest "unavailable" states when Stripe isn't configured — **verified in
  code** (`/api/billing/checkout` call at `plans/page.tsx:147`); old
  outstanding issue §9.2 closed (API contract was verified live earlier; real
  Stripe redirect still BLOCKED on his test keys).
- **`apps/web/lib/auth.ts` converts weight units** (`measurementWeightKg`:
  kg/kgs/kilogram(s) as-is, lb/lbs/pound(s) via `kgFromLb`, unknown units →
  `weightKg` null + server-side warn) — **verified in code**; old outstanding
  issue §9.3 closed (covered by `weightkg-regression.test.ts`, green in the
  181/181 V3 run).
- Integration tests grew 14 → 22 files — current count verified in the V3 run
  (181/181, including the new `billing-status.test.ts`).

### 11.4 Test + build evidence I personally ran (this audit)

| Command (cold shell unless noted) | Result |
|---|---|
| `npm run typecheck --workspaces` | **exit 0** — 0 errors, all workspaces |
| `npm run test --workspace @fitfusion/core` | **102/102** (11 files) |
| `npm run test --workspace @fitfusion/ai` | **6/6** (1 file) |
| `npx vitest run tests/integration` in `apps/web` (with `DATABASE_URL` exported) | **149/150** (18/19 files) — 1 genuine failure, see defect 12 below. (An earlier attempt with `npx vitest run tests/integration --dir apps/web` from the repo root failed 18 files on `@/`-alias resolution — that was my invocation error, not the code; the documented in-`apps/web` form is the supported one.) |
| `npm run build --workspace apps/web` | **exit 0** |
| `npx prisma migrate status --schema packages/db/prisma/schema.prisma` | **"Database schema is up to date!"** — 3 migrations (the parallel leaf applied `20261009220000_add_past_due_since` during this audit) |
| `node scripts/check-env.mjs` | exit 0 — `env OK — using …/fitfusion-ai/.env` (plus one warning, §11.5) |
| Fresh `next dev` cold boot + `GET /api/health` | 200, `ok:true` — database, env, migrations all green |
| `db:seed` with `DATABASE_URL` exported | `Seed complete: cuisines=13 recipes=31 exercises=50 foods=40` (idempotent) |

Full log: `/tmp/fitfusion-v2-verify.log` (sandbox scratch — the coordinator's
gate re-runs are authoritative).

### 11.5 New findings for the coordinator

- **Defect 11 (genuine, found 2026-10-10) — FIXED and verified end-to-end:**
  `packages/db/prisma/seed.ts`'s `.env` loader path was off by one level
  (`packages/.env` instead of the repo root). Now uses
  `join(here, '..', '..', '..', '.env')`; verified: `npm run db:seed` from a
  clean `env -i` shell exits 0 with `Seed complete: cuisines=13 recipes=31
  exercises=50 foods=40` (idempotent). No manual `DATABASE_URL` export needed.
- **Warning surfaced by `check-env.mjs` (his action, I will not touch his
  `.env`):** `SESSION_SECRET` has an obvious placeholder value — the script
  warns to "replace it with a long random string before this deployment goes
  live". Sessions work, but it must be rotated.
- The §2 Windows note "`npm run db:migrate` cannot see the root `.env`" is now
  obsolete for the **repo-root** script — it was fixed in V3 (the root script
  runs the `--schema` form from the root; verified working 2026-10-10). It
  remains true for the **nested** form `npm run db:migrate --workspace
  @fitfusion/db` (cwd `packages/db`, no `.env` there — fails with P1012, by
  design; don't use it). The same nested-cwd caveat applies to vitest (by
  design — export `DATABASE_URL` first).
- **Defect 12 (genuine, found 2026-10-10) — FIXED and verified:** the web suite's
  one failing test is fixed and the full suite is now green (**181/181**, 22
  files, V3 re-run). `selectPlan` throws 409 `stripe_cancellation_required`
  when the row links a live-looking Stripe subscription, and the legacy cancel
  route does the same — both never clear `stripeSubscriptionId`/`stripeCustomerId`
  locally. Verified in code 2026-10-10 (see §9). (The §9.1 outstanding item is
  closed.)
- Dev server left running on `:3000` (clean root-`.env` boot, health `ok:true`).
- **Self-inflicted incident, recovered:** I ran `npm run build --workspace apps/web`
  while the dev server was up; both use `apps/web/.next`, and the dev server
  started 500ing (`Cannot find module './1193.js'` — stale dev chunks).
  Cleared `apps/web/.next` (regenerable), restarted the dev server, health back
  to `ok:true`. Lesson for the coordinator: don't run `next build` against a
  repo whose dev server is serving from the same `.next` directory.

### 11.6 Still needed from Dr. Ammad (unchanged, plus one)

1. **Stripe test-mode keys** (4): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_DIET`, `STRIPE_PRICE_DIET_EXERCISE` — real end-to-end still
   BLOCKED without them.
2. **Windows run-through** of `docs/WINDOWS_SETUP.md` (never executed on Windows).
3. **Vercel deploy**: his connection + a hosted Postgres (Neon free tier suggested).
4. **(new)** Rotate `SESSION_SECRET` off the placeholder to a long random
   string (`check-env.mjs` warns: "replace it with a long random string before
   this deployment goes live").

---

## 12. V3 UX/env/docs addendum — UX/env/docs engineer (2026-10-10)

Scope: Priorities 4 (billing success/cancelled pages + server-side entitlement
result) and 5 (env + docs). Real Stripe test keys are still not available —
nothing below claims real Stripe verification.

### 12.1 Files changed + why

| File | Change |
|---|---|
| `apps/web/app/api/billing/status/route.ts` | **New.** `GET /api/billing/status` → `{ billing, entitlement: { entitled, planId, status, provider, pastDueGraceUntil } }`. `entitled` is computed server-side with `subscriptionGrantsPaidAccess()` (active/trialing = paid; `past_due` only inside `PAST_DUE_GRACE_DAYS` of `pastDueSince`; no clock = fail-closed). `pastDueGraceUntil` is the ISO end of the grace window when `status === 'past_due'`, else `null`. Authenticated; **read-only** — grants/revokes nothing (verified by test). |
| `apps/web/app/billing/success/page.tsx` | **Rewritten to consume `GET /api/billing/status`** instead of raw `/api/subscriptions`. "Payment confirmed" shows ONLY when the server reports a paid planId with status `active`/`trialing` — `past_due` (even inside the grace window) now shows a payment-needs-attention state with the grace-end date instead of reading as confirmed (defect 14). Still-pending → pending state; unreachable backend → error state. The page grants nothing on its own. |
| `apps/web/app/billing/cancelled/page.tsx` | Unchanged — already correct: no API calls, changes nothing, links back to Plans. |
| `apps/web/tests/integration/billing-status.test.ts` | **New.** 8/8 passing: 401 unauthenticated; entitled for active paid; not-entitled for free; past_due in-grace → entitled + correct future `pastDueGraceUntil`; past_due expired → not entitled; past_due with no clock → fail-closed; incomplete/unpaid/canceled never entitled; endpoint is read-only (DB row byte-identical after GET). |
| `package.json` (root) | `db:migrate` changed from the nested workspace delegation (`prisma migrate deploy` with cwd=`packages/db`, which could not see the root `.env` and failed with P1012 from a clean shell) to **`npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`** — run from the repo root, so the Prisma CLI loads the root `.env` itself. All docs (`README.md`, `docs/WINDOWS_SETUP.md`, `FEATURE_STATUS.md`, this handover) now use the same command: `npm run db:migrate`. The nested `npm run db:migrate --workspace @fitfusion/db` form is documented as not-for-clean-shell. |
| `README.md`, `docs/WINDOWS_SETUP.md` | Migrate guidance updated to the fixed root command (setup, Docker, and troubleshooting sections; old "NOT `npm run db:migrate`" notes rewritten). |
| `FEATURE_STATUS.md` | "Run it" uses `npm run db:migrate` / `npm run db:seed` (defect-11 export workaround removed); explicit label key added; V3 re-verification block with exact current numbers; new rows for `GET /api/billing/status` and the billing pages; defect 14 recorded. |
| `docs/HANDOVER.md` | This §12; §2/§4/§5 refreshed; §7 routes table gains `/api/billing/status`; §9 old outstanding items 1–3 re-verified as fixed in code and closed (email console-driver item remains); §11.1 matrix, §11.3, §11.5 updated (defect 11 fixed, defect 12 fixed). |

### 12.2 Verification evidence (all executed 2026-10-10)

- `npx tsc --noEmit -p apps/web/tsconfig.json` → **0 errors** (cleared stale `apps/web/.next/types` first).
- `npm run db:migrate` from a clean shell → exit 0; applied the pending
  `20261010010000_add_checkout_session_tracking` forward-only; `migrate status`
  → up to date (4 migrations). No wipe, no data loss.
- `npm run db:generate` and `npm run db:seed` from a clean `env -i` shell →
  both exit 0; seed idempotent (13/31/50/40). Defect 11's fix (three-levels-up
  `.env` path in `seed.ts`) verified end-to-end — no `DATABASE_URL` export needed.
- `node scripts/check-env.mjs` → exit 0 (`env OK — using …/fitfusion-ai/.env`;
  the `SESSION_SECRET` placeholder warning persists — his action).
  Placeholder rejection: `NODE_ENV=production SESSION_SECRET=placeholder` →
  **exit 1** (hard error). Non-production → warning only, exit 0.
- Hosted mode: script copied to `/tmp`, no `.env` present, vars exported →
  exit 0: "env OK — using platform-provided environment variables (no .env
  file)". The script and `/api/health` never hard-require a `.env` file —
  only the variable NAMES.
- Sentinel `apps/web/.env` → check-env rejects with exit 1; sentinel deleted,
  no trace; tree currently has no `apps/web/.env*`.
- `GET /api/health` (running dev server, fresh root-`.env` boot) → 200
  `ok:true`, `checks.env.ok: true`, `missingVars: []`.
- Test suites: core **102/102** (11 files), ai **6/6** (1 file), web integration
  **181/181** (22 files) → **289/289**.
- `next build`: **re-run 2026-10-10** (dev server stopped first to avoid the shared-`.next` corruption seen in a prior session): exit 0. Playwright: **not re-run** in V3; historical 5/5 from the earlier commission.

### 12.3 Outstanding / BLOCKED (unchanged)

- Real Stripe test-mode end-to-end: **BLOCKED** on his four test keys
  (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_DIET`,
  `STRIPE_PRICE_DIET_EXERCISE`). Everything up to the Stripe boundary is
  covered by mock-HMAC tests; the new endpoint is covered by real-DB local tests.
- `EMAIL_DRIVER=console` logs raw verification/reset links (dev-only) — still
  open (verified in code).
- `docs/WINDOWS_SETUP.md` still never executed on Windows — his run-through needed.
- Vercel deploy still pending his connection + hosted Postgres.
- `SESSION_SECRET` still an obvious placeholder — his rotation needed.
- Test-mode vs live secrets separation: preserved (docs keep the
  none/sandbox/stripe + test-keys-only convention).

## 13. V3 checkout-safety addendum — checkout-safety engineer (2026-10-10)

Priority 1: prevent duplicate Stripe subscriptions. All work below is
test-mode logic only; no live payments.

### 13.1 Chosen safe behavior (implemented + documented in code)

**HTTP 409 `existing_subscription_conflict`** — NOT an in-place Stripe
subscription upgrade. Rationale (in `lib/billing.ts` header + checkout route
docblock): an in-place `subscriptions.update` would apply proration and
billing changes without an explicit user confirmation surface (no customer
portal exists in-app), so the route refuses and directs the user to
manage/cancel the existing subscription first (`POST /api/billing/cancel`
schedules end-of-period cancellation; the verified webhook then frees the
account for a fresh checkout).

### 13.2 Files changed + why

- `apps/web/app/api/billing/checkout/route.ts` (rewritten internals, same
  contract `{ planId, idempotencyKey? } -> { url }`): (1) calls the new
  `checkExistingStripeSubscription()` before creating a session — billable
  remote states (active/trialing/past_due/incomplete/paused) return 409,
  terminal remote states (canceled/incomplete_expired/unpaid) and stale
  linkages are synced locally and the request proceeds; (2) reuses a stored
  still-`open` pending session (`stripeCheckoutSessionId`) so a sequential
  retry/double-click resolves to the SAME session; (3) passes a
  client-supplied `idempotencyKey` through to the Stripe SDK; (4) collapses
  concurrent POSTs per user via an in-flight map.
- `apps/web/lib/billing.ts`: added `checkExistingStripeSubscription()`
  plus `CHECKOUT_BLOCKING_REMOTE_STATUSES` /
  `CHECKOUT_TERMINAL_REMOTE_STATUSES` and a full status-semantics policy
  comment (remote verified via Stripe API, never trusted from the local row
  alone; non-404 lookup failures fail closed with 503
  `stripe_lookup_failed`; Stripe-not-configured fails closed earlier with
  503 `stripe_not_configured`, zero SDK calls). Existing functions untouched.
- `packages/db/prisma/schema.prisma` + migration
  `20261010010000_add_checkout_session_tracking`: `Subscription` gains
  `stripeCheckoutSessionId` / `stripeCheckoutSessionUrl` (nullable) to
  persist the pending session. Migration applied; client regenerated.
- `apps/web/tests/integration/billing-checkout-safety.test.ts` (new, 10
  tests, Stripe SDK mocked — mock tests prove route logic, NOT real Stripe
  integration).

### 13.3 Verification evidence (all executed 2026-10-10)

- `npx tsc --noEmit -p apps/web/tsconfig.json` → 0 errors (cleared stale
  `apps/web/.next/types` first).
- New file: **10/10 pass**.
- Regression: billing-checkout-extended + billing-hardening +
  billing-cancel-safety + billing-checkout-safety = **41/41 pass**.
  (The §11.5 defect-12 test currently passes as written — its assertions
  accept the present selectPlan behavior; left for the owning leaf.)
- `next build` NOT run (build gate owned by another engineer; dev server
  untouched).

### 13.4 Coordination notes (not defects in this leaf)

- The webhook engineer (route owner) concurrently landed a V3 guard
  requiring `checkout.session.completed` to match
  `local.stripeCheckoutSessionId` (session mapping created by this leaf's
  checkout route — the stored id is written before the URL is returned,
  and their upsert clears it on binding, so no replay). Coherent; the
  pre-existing `stripe-webhook.test.ts` "activates diet/active" test is
  stale against their new guard (it never created a session via checkout)
  — their file, their fix; not touched here.
- Canceled local subscription → fresh checkout is deliberately allowed
  (documented in code); terminal remote states sync the local row to free
  first (mirrors the webhook's downgradeToFree).
- Real end-to-end Stripe verification still BLOCKED on his four test keys.

---

## 14. V3 webhook subscription-matching hardening (P2 + P3) — 2026-10-10

**Scope:** `apps/web/app/api/billing/webhook/route.ts` (hardened), `apps/web/app/api/billing/checkout/route.ts` (one-line doc touch — the session-mapping write already existed from §13).

**P2 — exact subscription matching.** `findLocal` was rewritten: when an event carries a subscription ID, the local row must match the stored `stripeSubscriptionId` EXACTLY. The old silent fallback to matching by Stripe customer ID is gone — it let events for an OLD, CANCELED, or otherwise untracked subscription of the same customer resolve to and overwrite the user's current row. An unmatched subscription ID is now non-entitling: the event ID is logged server-side and the webhook is ACKed 200 (a retry could not change the outcome, so 200 stops Stripe retrying pointlessly — documented in the route header). Customer-ID matching survives only for events carrying no subscription ID at all, and is logged as ambiguous whenever it resolves.

**P2 — checkout binding.** `checkout.session.completed` now binds a user to a subscription ONLY when the completed session's id equals the `stripeCheckoutSessionId` this server stored at checkout creation (§13 writes it before returning the URL). Missing/mismatched mapping → no binding, no entitlement. The mapping is cleared once the webhook binds, so a stale session id can never re-bind.

**P3 — one explicit price-mismatch policy**, implemented everywhere and quoted in the route header:

> "fail closed on access, hold safe on state, never upgrade on unverified data." (1) The only trusted price→plan mapping is the server-side env-configured one (`STRIPE_PRICE_ENV`). (2) An unknown/mismatched Price ID never grants paid entitlement — never writes a higher-ranked planId than stored. (3) It never silently downgrades an already-tracked subscription either: on `invoice.payment_succeeded` / `customer.subscription.updated` with an eligible/past_due status, the stored planId is HELD (logged with event ID + price ID). (4) On `checkout.session.completed` (new subscription, no prior verified state) an unknown/mismatched price records the binding with planId `free`; an anomalous checkout never clobbers an existing verified paid entitlement on a different subscription. (5) On every mismatch all Stripe identifiers are preserved and the raw price ID + event ID are logged server-side for reconciliation/support.

**P3 — identifier preservation.** `downgradeToFree` gained `preserveStripeSubscriptionId`: past-due grace expiry now keeps `stripeSubscriptionId` (the Stripe subscription is still alive — it can be paid or canceled), so a later `invoice.payment_succeeded` still reconciles and re-activates. `stripeCustomerId` is never cleared. Dead-at-Stripe paths (canceled/deleted/incomplete_expired) still clear the subscription id.

**Tests.** New `apps/web/tests/integration/stripe-webhook-matching.test.ts`: 13/13 pass (old-sub event leaves current row untouched; unknown-sub/known-customer ACKed with no change; duplicate checkout sequential + concurrent → single activation; checkout without/with-wrong session mapping → no binding; unknown price on checkout → free + identifiers kept; metadata/price mismatch → free; price change to unknown on live sub → plan held; anomalous checkout never clobbers verified paid sub; grace expiry preserves sub id and later payment re-activates). Existing checkout tests in `stripe-webhook`, `webhook-gating`, and `billing-webhook-extended` were updated to seed the now-required server-side session mapping. Regression: `stripe-webhook` + `webhook-gating` + `billing-webhook-extended` + `billing-hardening` = 54/54; `billing-checkout-extended` + `billing-cancel-safety` + `billing-checkout-safety` = 27/27. `npx tsc --noEmit -p apps/web/tsconfig.json` → 0 errors. `next build` NOT run (dev server left running).

**Not verified:** real Stripe end-to-end (needs his four test-mode keys); the session-mapping write path in the checkout route was verified by §13's tests, not re-verified here beyond the webhook side.
