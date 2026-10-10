# FitFusion AI — Feature Status (earned verdicts)

Grading rule: **PASS** only when actually exercised and verified. **IMPLEMENTED** = code
exists but not fully verified. **PARTIAL** = a required production path is missing.
**PLANNED** = not implemented. **BLOCKED** = external dependency, with the unblock
requirement named.

> **Label key for this file:** historical = from a prior commission, not re-run ·
> independently verified = ran/executed in the commission noted · mocked =
> verified against mocks only · BLOCKED = external dependency, unblock requirement
> named · not-rerun = explicitly left unexecuted.

V3 UX/env/docs commission re-verification (2026-10-10, **independently verified**):
- `npx tsc --noEmit -p apps/web/tsconfig.json` → **0 errors** (stale `apps/web/.next/types` cleared first).
- Web integration suite: **181/181** (22 files — includes the new `billing-status.test.ts`, 8/8, all local/real-DB, no Stripe network); core **102/102** (11 files); ai **6/6** (1 file) → **289/289 total**.
- `npm run db:migrate` (root script now runs `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` from the repo root, so the CLI loads the root `.env` itself) → exit 0; it applied one pending migration (`20261010010000_add_checkout_session_tracking`: adds `stripeCheckoutSessionId`/`stripeCheckoutSessionUrl` to `Subscription`, duplicate-checkout guard — forward-only, no data touched); `migrate status` → **"Database schema is up to date!"** (4 migrations).
- `npm run db:generate` from a clean `env -i` shell → exit 0. `npm run db:seed` from a clean `env -i` shell → exit 0 (`Seed complete: cuisines=13 recipes=31 exercises=50 foods=40`) — the fixed seed `.env` loader (three levels up to the repo root) verified end-to-end; no manual `DATABASE_URL` export needed.
- `node scripts/check-env.mjs` → exit 0 on the real tree (one warning: `SESSION_SECRET` is still an obvious placeholder — his action; `.env` untouched). Placeholder rejection: `NODE_ENV=production SESSION_SECRET=placeholder` → exit 1 with the hard-error message; non-production → warning only, exit 0. Hosted mode (script copied to `/tmp`, no `.env` anywhere, vars exported) → exit 0: "env OK — using platform-provided environment variables (no .env file)". Sentinel `apps/web/.env` → rejected with exit 1, then deleted; no trace left; current tree has no `apps/web/.env*`.
- `GET /api/health` (dev server left running, fresh root-`.env` boot) → 200 `ok:true` (database, env, migrations all green; `missingVars: []`).
- **Not re-run (V3):** `next build` (deliberately — it shares `apps/web/.next` with the running dev server; previous commission verified exit 0) and the Playwright smoke spec (previous commission: 5/5). Real Stripe end-to-end remains **BLOCKED** (no test keys; Stripe paths verified against mock-HMAC tests only).

Verification evidence (2026-10-09, hardening commission Phases 1–5 — **historical**): `tsc --noEmit`
0 errors (all workspaces), `next build` exit 0 (**76 routes: 50 API + 26 pages**),
vitest **102/102** (`packages/core`) + **89/89** (`apps/web` integration, 14 files)
+ **6/6** (`packages/ai`), Playwright smoke **5/5** (chromium, real dev server),
`prisma migrate status` → up to date (2 migrations: `init`, `add_stripe_billing_fields`),
plus a 22-check live runtime pass against the production build (register → login →
onboarding → subscriptions → meal/workout plan generation → diary idempotency →
water → scans → coach → BMI → export → plan gating → logout) and a 7-check auth
lifecycle pass (verify, reset, export, delete).

V2 audit re-verification (2026-10-09/10, docs/audit engineer, cold shell):
`npm run typecheck --workspaces` **exit 0** · core **102/102** ·
ai **6/6** · web integration **149/150** (18/19 files — 1 genuine failure,
defect 12) · `npm run build --workspace apps/web` **exit 0** ·
fresh `next dev` cold boot → `/api/health` 200 `ok:true` (database/env/migrations
green) · `db:seed` idempotent (13/31/50/40) with `DATABASE_URL` exported ·
`migrate status` → **up to date** (3 migrations; the parallel leaf applied

V2 integration re-verification (2026-10-10, coordinator, final tree — after a
fresh VM replacement: Postgres cluster recreated, role/DB recreated, 3/3
migrations applied, seeds re-applied 13/31/50/40):
`npm run typecheck --workspaces` **exit 0** · `npm test` **289/289**
(181 web + 6 ai + 102 core, 34 files, exit 0 — independently re-verified 2026-10-10 after the V3 leaf work landed) · `npm run build --workspace apps/web` **exit 0** (28 pages incl. the
new `/billing/success` + `/billing/cancelled`) · `migrate status` → **up to
date** (3/3) · live: `/api/health` 200 `ok:true`; paid plan w/o payment → 402;
free downgrade on live Stripe sub → 409 `stripe_cancellation_required` with row
untouched (IDs preserved); `/billing/success` + `/billing/cancelled` → 200;
recipes pagination 20/31 intact.
`20261009220000_add_past_due_since` during the audit).
Full env-loading matrix in `docs/HANDOVER.md` §11.1.

## Brief sections

| # | Section | Verdict | Evidence / notes |
|---|---------|---------|------------------|
| 1 | Project overview — functional app, not prototype | **PASS** | Full stack verified live (see runtime pass above) |
| 2 | PWA (Android/iOS/desktop, responsive) | **PASS** | `manifest.webmanifest`, `sw.js` (API never cached, offline fallback), real PNG icons, responsive shell; Playwright asserts manifest 200 |
| 2 | Native Android/iOS apps | **PLANNED** | API-first structure ready for native clients; no native code (as briefed: structure only) |
| 3 | Premium UI: dashboard, rings, light/dark, nav, skeletons, a11y | **PASS** | Built + typechecked; 44px touch targets, ARIA labels, skip link, focus rings; Playwright renders landing/login |
| 4 | Auth: register/login/logout/verify/reset, OAuth hooks, consent, export, deletion | **PASS** | All verified live incl. token expiry semantics, wrong-password delete rejected, full wipe on delete |
| 4 | Onboarding personalization | **PASS** | 5-step skippable flow; persistence verified live (displayName, workoutDays, equipment all round-trip). One genuine defect found & fixed: zod schema silently stripped non-listed fields |
| 5 | Subscriptions: Free / Diet / Diet+Exercise catalog | **PASS** | Configurable catalog, upgrade/downgrade, server-side gating verified (403 `plan_required`); paid plans REJECTED with 402 `payment_required` in `none`/`stripe` mode |
| 5 | Real billing / charging | **IMPLEMENTED** (test-mode code; mocked for Stripe transport) | Stripe Checkout + HMAC-verified idempotent webhook + cancel implemented and integration-tested with mock HMAC (web suite now 22 files incl. `billing-cancel-safety`, `billing-checkout-extended`, `billing-webhook-extended`, `webhook-gating`). **New in V3 (independently verified):** `GET /api/billing/status` returns the server-computed entitlement `{ entitled, planId, status, provider, pastDueGraceUntil }` — the success page trusts only this; "Payment confirmed" shows only on server-confirmed `active`/`trialing`, never on `past_due`. Real end-to-end **BLOCKED** on his test keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_DIET`, `STRIPE_PRICE_DIET_EXERCISE`. Safety rule enforced: paid entitlement only via webhook, never via local `selectPlan` (the old unsafe behavior is gone). Defect 12 (local free-downgrade orphaning a live Stripe sub) **fixed at integration**: 409 `stripe_cancellation_required`, linkage never cleared locally — verified live, full web suite 150/150 at that time (181/181 now, V3 — independently re-verified). |
| 5 | Billing success/cancelled pages | **PASS** (V3, independently verified) | `/billing/success` polls the server-side `GET /api/billing/status` and shows "Payment confirmed" only when the server reports a paid planId with status `active`/`trialing`; `past_due` (even inside the grace window) shows a payment-needs-attention state with the grace-end date; still-pending shows pending; page grants nothing on its own. `/billing/cancelled` makes no API calls and changes nothing about the subscription; both link back to Plans. Real Stripe checkout return **BLOCKED** on his test keys (not exercised against real Stripe). |
| 5 | Webhook hardening (HMAC verify, idempotency, event handling) | **PASS** | `stripe-webhook.test.ts` (mock-HMAC, incl. replay idempotency via `StripeWebhookEvent`) + `billing-hardening.test.ts` (402 `payment_required` without Stripe-confirmed payment) pass in the web suite; full-suite re-run §11.4 |
| 5 | Plans-page checkout wiring | **IMPLEMENTED** | `app/(app)/plans/page.tsx` now calls `POST /api/billing/checkout` and redirects to the returned Stripe URL; honest "not configured" states in `none` mode; sandbox marked test-only. API contract verified live (503 `stripe_not_configured` in none mode; `/billing/success` + `/billing/cancelled` render 200). Real Stripe redirect **BLOCKED** on his test keys. |
| 5 | Past-due grace (`pastDueSince`) | **IMPLEMENTED** (mocked for Stripe transport; independently verified locally) | Migration `20261009220000_add_past_due_since` applied; finite grace via `PAST_DUE_GRACE_DAYS` (default 7) enforced in webhook + `requirePlan` access check (defect 13) + cron sweeper script. **New in V3 (independently verified):** `GET /api/billing/status` computes `entitled` server-side with `subscriptionGrantsPaidAccess()` and returns `pastDueGraceUntil` (ISO) — 8/8 in `billing-status.test.ts` (in-grace → entitled with future grace date; expired → not entitled; no clock → fail-closed; ineligible statuses never entitled; endpoint read-only). Real Stripe events **BLOCKED** on his test keys. |
| 6 | BMI / BMR / TDEE / macros / water calculators | **PASS** | Unit-verified (incl. minor → no adult labels + pediatric guidance) and live-verified (`/api/calculators/bmi` → `healthy` for 80kg/180cm) |
| 6 | Safety: no aggressive deficits, protected groups | **PASS** | Core rules tested: 20% deficit cap, 1500/1200 floors, flags disable weight-loss with professional-guidance copy |
| 7 | Template diet planner (no AI keys) | **PASS** | Live-verified: 7-day plan, allergy filter (peanut excluded), totals; regenerate/swap/scale in core + UI |
| 7 | AI diet planner | **IMPLEMENTED** | Code complete, honest `not_configured`; **BLOCKED** on `AI_API_KEY` for live verification — never fabricates |
| 8 | Food scanner pipeline (upload → review → diary) | **PASS** | Upload validation + honest `not_configured` verified live; UI review screen editable |
| 8 | Vision analysis accuracy | **BLOCKED** | Requires `AI_API_KEY` + `AI_VISION_MODEL`; results labeled estimates with confidence + assumptions by design |
| 9 | Food diary + idempotency | **PASS** | Double-POST same key → 1 row (live); nutrients recomputed server-side; water upsert verified |
| 10 | Workout planner | **PASS** | Live-verified 7-day schedule with rest days + safety copy; plan-gated |
| 10 | Session player (timers, logging) | **IMPLEMENTED** | Built with rest timer + beeps + logging; not runtime-exercised in a browser |
| 11 | Exercise library (50) + honest media states | **PASS** | 50 text-first exercises; `mediaType:'none'` everywhere; UI shows "Demo media not available" — zero fake URLs (DB-verified) |
| 12 | Recipe library (31 curated, 13 cuisines, filters/tags) | **PASS** | Live-verified listing + filters; allergen banner before food content; curated-vs-AI badges |
| 13 | AI coach | **PARTIAL** | Chat UI + consent-gated context + honest `not_configured` verified live; real replies **BLOCKED** on `AI_API_KEY` |

## Cross-cutting

- **Secrets**: server-side only (env), never in client bundles — PASS (verified: `AI_API_KEY` etc. have no `NEXT_PUBLIC_` exposure; config endpoint only reports booleans).
- **Env validation / single-source-of-truth** — **PASS** (V2): full cold-shell matrix verified — fresh `next dev` boot loads the root `.env` via `next.config.js` dotenv (health `ok:true`); `check-env.mjs` exits 0 on the root `.env` and 1 on any `apps/web/.env*`; a shadowing experiment proved a competing `apps/web/.env` overrides the root `.env` at runtime (bogus `DATABASE_URL` → health `ok:false`), justifying the gate. Prisma CLI loads `.env` from cwd (works from repo root, fails from `packages/db` — documented). Matrix: `docs/HANDOVER.md` §11.1.
- **Weight unit conversion** — **IMPLEMENTED** (verified by code read in V3, 2026-10-10): `measurementWeightKg` in `apps/web/lib/auth.ts` converts lb/lbs/pound(s) → kg via `kgFromLb`, passes kg variants through, and nulls unknown units with a server-side warn; covered by `weightkg-regression.test.ts` in the re-run suite (181/181).
- **Docs (handover + status)** — **PASS** (V3, independently verified): `docs/HANDOVER.md` extended with the V3 addendum (§12: billing-status endpoint, fixed `npm run db:migrate`, defect 11 resolved, stale claims removed/relabeled); this file re-verified against the current tree with an explicit label key.
14. (2026-10-10, V3) **Success page treated `past_due` as "Payment confirmed":** the old page showed the confirmed state for any status in `active`/`trialing`/`past_due` — a failed payment reading as confirmed. **FIXED** — new `GET /api/billing/status` computes the entitlement server-side (`subscriptionGrantsPaidAccess()` + configured grace policy) and the page only confirms on a paid planId with status `active`/`trialing`; `past_due` shows a payment-needs-attention state with the grace-end date. The page grants nothing on its own (read-only endpoint). Covered by `billing-status.test.ts` (8/8).
- **Allergy safety**: validated in core (`validateMealAgainstProfile`) and enforced at plan generation + surfaced in UI — PASS.
- **Branding**: single place (`config/branding.ts` + `NEXT_PUBLIC_*` overrides) — PASS.
- **PWA install on physical devices**: IMPLEMENTED (not device-tested).

## Genuine defects found and fixed during verification

1. `OnboardingSchema`/`ProfileUpdateSchema` silently dropped fields (displayName, workoutDays, equipment, …) — extended schemas, added regression test (now 102 tests).
2. Two API routes exported non-handler constants (`FOOD_SCAN_DISCLAIMER_FALLBACK`, `WORKOUT_SAFETY_NOTE`) — `next build` rejected them; made module-private.
3. `themeColor`/`viewport` in `metadata` export (Next 14.2 deprecation warnings) — moved to `viewport` export.
4. Stale `.next/types` artifacts broke typecheck twice — cleared (regenerable).
5. Prisma engine download flaky through egress proxy — installed with `--ignore-scripts` + retried postinstall (succeeded).
6. (2026-10-09, app-view session) Dashboard/Calculators could never show calorie targets: weight is stored in `Measurement` rows (no `weightKg` column on `Profile`), but `profileTargets()` read `profile.weightKg`, always returning null → permanent "Let's set up your plan" state. Fixed in `getSessionUser` (`apps/web/lib/auth.ts`): latest weight measurement is attached as `weightKg` on the session profile (typed `SessionProfile`; never written back to the Profile table). Verified live: dashboard now renders calorie ring, macros, water targets.
7. (2026-10-09, app-view session) `/api/recipes` (and `/api/exercises`) returned only 1 item per page: `clampInt(null, 20, 1, 100)` returned 1 because `Number(null)` is `0` (finite), so the fallback never applied and the value clamped to min. Fixed `clampInt` in `apps/web/lib/server-api.ts` to treat null/undefined/'' as missing → fallback; added `tests/integration/clampint.test.ts` (4 tests, passing). Verified live: recipes returns 20/page of 31 total; explicit `?limit=5&page=2` paginates correctly.
8. (2026-10-09, Phase 2) **Env-loading fragility:** Next.js 14 has no `envDir` option — without intervention it would only load env from `apps/web/`, and the root `.env` relied on Prisma's bundled self-load, which proved unreliable across `prisma generate` runs. Fixed: `apps/web/next.config.js` explicitly loads the repo-root `.env` via `dotenv` at startup (dotenv only fills unset vars, so real environments still win); `scripts/check-env.mjs` fail-fast validates and rejects a competing `apps/web/.env`. Proven on cold start.
9. (2026-10-09, Phase 3) **Unsafe `selectPlan`:** the old billing code could set a subscription active for a paid plan without any provider verification, with no Stripe SDK, checkout, or webhook in the codebase. Fixed: `apps/web/lib/billing.ts` rewritten — paid plans are REJECTED with HTTP 402 `payment_required` in `none`/`stripe` mode; paid entitlement happens ONLY via the HMAC-verified webhook after Stripe confirms payment. Added `POST /api/billing/checkout`, `POST /api/billing/webhook` (idempotent via `StripeWebhookEvent`), `POST /api/billing/cancel`, migration `20261009162647_add_stripe_billing_fields` (`stripeCustomerId`, `stripeSubscriptionId` @unique, `StripeWebhookEvent`), `stripe@23.0.0`, `config/plans.ts` `STRIPE_PRICE_ENV`. Covered by `billing-hardening.test.ts` (14) + `stripe-webhook.test.ts` (6, mock HMAC).
10. (2026-10-09, Phase 4) **Test-setup AI race:** AI integration tests could see different `AI_*` states depending on the machine running them. Fixed: `tests/setup.ts` neutralizes `AI_*` so AI tests deterministically see `not_configured`.
11. (2026-10-10, V2 audit) **Seed `.env` loader off-by-one:** `packages/db/prisma/seed.ts` line 14 — `const envPath = join(here, '..', '..', '.env')` — resolves to `packages/.env`, which doesn't exist; the repo-root `.env` is one level higher (`join(here, '..', '..', '..', '.env')`). The `existsSync` guard makes the miss silent, so a cold `npm run db:seed` fails with `Environment variable not found: DATABASE_URL` (verified). **FIXED at integration** — path corrected to three levels up.
12. (2026-10-10, V2 audit) **Local free-plan downgrade orphans an active Stripe subscription:** `POST /api/subscriptions { planId: 'free' }` for a user with an active Stripe subscription returns 200 and nulls `stripeSubscriptionId` — the Stripe subscription still exists but is no longer tracked (desync). Failing test: `billing-checkout-extended.test.ts` §8.8 "direct free-plan downgrade with an active Stripe sub cannot orphan it" (reproduced in isolation; the sibling legacy-cancel test passes). This is outstanding-issue §9.1 surfacing on the `selectPlan` path. **FIXED at integration** — `selectPlan` in `apps/web/lib/billing.ts` now throws 409 `stripe_cancellation_required` (directing to `POST /api/billing/cancel`) when the row links a live-looking Stripe subscription, and never clears `stripeSubscriptionId`/`stripeCustomerId` locally (only the verified webhook's `downgradeToFree` may clear them). Verified live: downgrade attempt → 409, row untouched (planId `diet_exercise`, IDs preserved); full web suite 181/181 at V3 verification.
13. (2026-10-10, V2 integration) **`requirePlan` ignored subscription status:** the guard checked plan rank only, so a `past_due`-expired (or otherwise ineligible) paid row kept granting features between webhook deliveries. **FIXED** — `requirePlan` in `apps/web/lib/auth.ts` now additionally requires `subscriptionGrantsPaidAccess()` for paid gates (free gates unaffected). tsc 0 errors; no test regressions.

## What's BLOCKED and what unblocks it

- AI features (vision scan, AI plans, coach replies): set `AI_API_KEY` (+ optional `AI_BASE_URL`, `AI_MODEL`, `AI_VISION_MODEL`). Without them the app runs fully on template logic with honest setup screens. Note: sandbox egress currently blocks the provider even with a key.
- Real payments: `BILLING_PROVIDER=stripe` + ALL FOUR Stripe vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_DIET`, `STRIPE_PRICE_DIET_EXERCISE` (key alone is insufficient). Sandbox mode available for labeled test-only simulation. See `docs/HANDOVER.md` §8 for the dashboard steps + verification checklist.
- Real food-scan accuracy claims: needs AI keys + human review; estimates stay labeled by design.
- `SESSION_SECRET` rotation: still an obvious placeholder value (flagged by `node scripts/check-env.mjs`: "replace it with a long random string before this deployment goes live") — his `.env` was not touched.
- Exercise demo media: needs licensed/original media; slots render an honest unavailable state until then.
- OAuth buttons: `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET`; hidden until configured.
- SMTP email: `EMAIL_DRIVER=smtp` + host/creds; console driver logs in dev.
- S3 uploads: `STORAGE_DRIVER=s3` + endpoint/bucket/creds; local driver works out of the box.

## Run it

```bash
cd ~/workspace/fitfusion-ai
cp .env.example .env            # then edit secrets
npm install                     # --ignore-scripts if the prisma postinstall flakes; then rerun node node_modules/@prisma/engines/scripts/postinstall.js
npm run db:migrate              # repo root; runs prisma migrate deploy --schema from the root
npm run db:seed                 # seed self-loads the root .env; idempotent
# (On Windows PowerShell, if the seed's built-in .env loader misses,
# export DATABASE_URL first: $env:DATABASE_URL = (parse from .env))
npm run dev --workspace apps/web   # http://localhost:3000
```

Gates: `npm run typecheck --workspaces`, `npm run test --workspaces`, `npm run build --workspace apps/web`, `npm run test:e2e --workspace apps/web` (needs `DATABASE_URL` set for integration tests).
