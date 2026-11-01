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
recipes pagination intact (20/31 at that time; 270 recipes after the v21 expansion — see §12).
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
| 12 | Recipe library (270 recipes, 13 cuisines, server pagination/filters/tags, data-quality tiers) | **PASS** (v21.2 re-verified: tsc 0 errors, production build exit 0, tier badges render on list + detail) | 270 seed recipes: 239 engine-computed v21 batch (Pakistani 60, Indian 24, Middle Eastern 20, Turkish 15, Chinese/Japanese/Korean/Thai 15 each, Mediterranean/Italian/Mexican/American/Continental 12 each) + 31 hand-authored originals (demoted `verified: true` → `false`; tier `calculated-estimate`). `GET /api/recipes`: real DB pagination (`page`/`pageSize`, max 48, returns `total`/`pageCount`), server-side filters (cuisine, diet, tags incl. `halal` ≡ `halal-friendly`, allergens, kcal/protein ranges, maxTime, difficulty, mealType, sort) + alias-aware `q` (titles + persisted English/Urdu/Roman-Urdu aliases); new `GET /api/recipes/meta` (cuisines/tags/mealTypes/difficulties/allergens with counts). Private recipes are owner-only (404 otherwise, incl. the favorite route). Review status: **0 reviewed / 0 verified / 92 needsReview** (reconciled from the seed files 2026-10-14 by `packages/db/prisma/recipe-quality-report.ts`: 16 Pakistani, 4 Indian/Middle-Eastern/Turkish, 40 Asian, 32 Western; unresolved/un-convertible quantities contribute 0, never silently partial). Ingredient DB: 182 entries (173 USDA standard-reference basis, 9 standard-estimate; 0 captured sourceRefs — never invented). No recipe carries a `halal-friendly` tag (161 inference-granted tags removed; the tag now requires a recorded human review); allergen lists are declared from ingredient names with the caveat shown on the detail page. UI: tier badge per recipe ("Calculated estimate"/"Reviewed"/"Verified") + "Awaiting review" marker on list cards; detail page keeps the "Nutrition incomplete" banner and shows declared allergens with the caveat. Evidence note: engine recompute tests are regression checks, not accuracy proof (`docs/recipe-data-quality.md` §6). The `verified`/`reviewed` tiers became reachable in v21.3: migration `20261014100000_v213_recipe_review_evidence` added the `verificationEvidence`/`reviewEvidence` JSONB columns and `POST /api/admin/recipes/[slug]/review` records evidence-backed reviews (see `docs/recipe-data-quality.md` §9); seed data still carries no evidence, so all 270 seed recipes remain `calculated-estimate` (0 reviewed / 0 verified). |
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

## v21.4 addendum (2026-10-15, Worker D — ITEM 6 + ITEM 8)

> Intended end-state notes (additive, labeled v21.4). Other workers are
> changing code in parallel (evidence serializer, review route, diary
> route); any statement about their files is flagged below as
> unverified-against-final-tree.

**ITEM 6 — custom-recipe dietary/allergen states (defect CONFIRMED and fixed).**
The old POST defaulted an omitted `dietCategory` to `'vegetarian'` (a meat
recipe with no stated diet was labeled vegetarian) and stored `allergens: []`
with no record that screening ever happened.

- `dietCategory` is now **required at creation** (`CustomRecipeSchema` in
  `packages/core/src/validation.ts`): a missing/unknown value is a 400
  `validation_error` — never defaulted. The PATCH schema
  (`CustomRecipeSchema.partial()`) keeps it optional (absent = leave as-is).
- The creation UI (`apps/web/app/(app)/recipes/new/page.tsx`) forces an
  explicit choice: the diet Select starts unselected and Save stays disabled
  until the user picks vegetarian or non-vegetarian.
- New migration `20261015090000_v214_recipe_allergen_screening` (additive,
  forward-only, no backfill): `Recipe.allergenScreened BOOLEAN NOT NULL
  DEFAULT false` — records whether the `allergens` list was produced by
  ingredient-name screening, SEPARATE from the list itself. All pre-v21.4
  rows (incl. the 270 seed recipes) stay `false`; claiming `true` for them
  would invent evidence.
- POST /api/recipes now runs name-based screening at creation via the new
  pure helper `screenIngredientAllergens()` (`packages/core/src/
  recipe-allergen-screening.ts`, exported from `@fitfusion/core`) and stores
  the detected families in `allergens` with `allergenScreened: true`.
  Screening is name-derived only — never a certified allergen analysis; the
  ALLERGEN_CAVEAT still accompanies the list.
- Detail-page copy (`apps/web/app/(app)/recipes/[slug]/page.tsx`): non-empty
  list → "Declared from ingredient names: …"; empty + screened → "None
  detected from ingredient names."; empty + unscreened → "Allergen screening
  has not been performed for this recipe." — the old "None declared from
  ingredient names." line no longer renders for unscreened recipes.
- New pure helper `dietAllergenRecheckNeeded(prev, next)` (same module):
  true when the ingredient name set or dietCategory materially changed;
  false for portions-only or grams-only edits and for creation (creation
  screens unconditionally). Exposed for the PATCH material-change path
  (PATCH route itself is another worker's — not verified against the final
  tree here).

**ITEM 8 — docs reconciliation (this edit).** Stale v21.2 statements
claiming the review-evidence columns were missing have been removed (§12
row above; `docs/HANDOVER.md` §15; `docs/recipe-data-quality.md` §8) and
replaced with the v21.3 reality (migration
`20261014100000_v213_recipe_review_evidence`, admin review endpoint
`apps/web/app/api/admin/recipes/[slug]/review`, evidence-backed badge
policy in `docs/recipe-data-quality.md` §9, incomplete-nutrition
protections).

**Test-status categories used below:** source-implemented (code exists, not
executed) · mock-tested (executed against mocks) · DB-tested (executed
against real PostgreSQL) · browser-tested (executed in a real browser) ·
real-service-verified (executed against a live external service) ·
blocked-not-run (could not run; unblock named). Old counts quoted as
historical are NOT fresh runs.

**What v21.4 Worker D actually ran (2026-10-15):**
- `npx tsc --noEmit` — **0 errors** in all three workspaces (packages/core,
  packages/db, apps/web). Independently executed this commission.
- `packages/core` vitest: **320/320** (23 files), including the new
  `recipe-allergen-screening.test.ts` (11/11: wheat/milk/eggs/peanuts
  detected from names; eggplant/coconut do not false-positive; empty result
  is "not detected", never a safety promise; recheck semantics) and the new
  v21.4 `CustomRecipeSchema` cases (missing/unknown dietCategory rejected;
  PATCH schema keeps it optional). Independently executed.
- `apps/web` mocked route suite
  `tests/integration/v214-custom-recipe-diet-allergen.test.ts`: **7/7
  mock-tested** (missing/unknown dietCategory → 400, nothing created; meat
  recipe stored as non_vegetarian; wheat+milk+eggs+peanuts detected and
  `allergenScreened: true` persisted; clean recipe → `[]` with screened=true;
  declared-row names screened too). Independently executed (dummy
  DATABASE_URL; `@fitfusion/db` fully mocked, no DB touched).
- DB-gated suite `tests/integration/v214-allergen-screened-db.test.ts`: 2/2
  **skipped** — no PostgreSQL on this VM (probe-guarded; even a dummy
  DATABASE_URL skips rather than failing). Migration SQL
  `20261015090000_v214_recipe_allergen_screening` is source-implemented;
  `prisma validate` confirms the schema is valid; the migration has NOT been
  applied to any database by this worker (blocked-not-run: needs a real
  PostgreSQL — run `npm run db:migrate` where one exists).
- Seed-count truth (quote from `npx tsx
  packages/db/prisma/recipe-quality-report.ts`, executed 2026-10-15):
  "recipes: 270 total (239 v21 batch + 31 hand-authored originals) …
  needsReview total: 92 … reviewed: 0 | verified: 0 … ingredients: 182 (USDA
  standard-reference=173, standard-estimate=9; sourceRef=0,
  lastReviewedAt=0)".
- **Not run:** `next build`, Playwright/browser tests, real-service
  verification (nothing in ITEM 6 touches an external service). The web
  full-integration suite was not re-run (DB-gated files skip; mocked files
  unrelated to ITEM 6 were spot-run: `v20-recipe-import` 28 passed + 1 skipped (29),
  `recipe-patch-governance-mocked` 6/6, `recipe-browse-pagination-mocked`
  5/5 — all pass).
- Existing DB-gated POST fixtures updated for the required dietCategory
  (`v18-custom-recipes.test.ts`, `v212-nutrition-correctness.test.ts` —
  source-implemented, skip here; they will execute wherever PostgreSQL
  exists).

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

## v21.5 addendum (2026-10-15, coordinator — allergen, dietary & governance fixes)

**Status key used below:** implemented (source) · pure/mock-tested (vitest, no DB) · DB-tested (real PostgreSQL) · browser-tested · blocked/not-run.

### P1 — PATCH allergen re-screening: defect CONFIRMED and fixed (implemented · pure/mock-tested)
Creation screened allergens but `PATCH /api/recipes/[slug]` never updated `allergens`/`allergenScreened` — adding peanuts to a clean recipe left a stale list. PATCH now uses the existing `dietAllergenRecheckNeeded()` + `screenIngredientAllergens()` and writes the refreshed list + status in the **same atomic** `prisma.update`. Metadata-only edits (prepMin) leave both untouched. Files: `apps/web/app/api/recipes/[slug]/route.ts`.

### P2 — canonical-name screening: defect CONFIRMED and fixed (implemented · pure/mock-tested)
`resolveIngredientRows` let the client display name shadow the DB food name, so renaming "Peanut Butter" → "nutty spread" hid the peanut allergen. `ResolvedRow` now carries `canonicalName` (+ `aliases` from the `FoodAlias` relation); creation and PATCH screening use canonical+alias names. Nutrition math and display names unchanged. Files: `apps/web/app/api/recipes/custom-recipe.ts`, `apps/web/app/api/recipes/route.ts`.

### P3 — vegetarian/meat conflicts: defect CONFIRMED and fixed (implemented · pure/mock-tested)
Required `dietCategory` didn't stop "vegetarian" + chicken. New pure `packages/core/src/diet-conflicts.ts`: unambiguous meat/poultry/fish/seafood in a declared-vegetarian recipe → **400 `diet_conflict`** naming the ingredient; ambiguous free-text → `needsReview: true` + warning (never assumed vegetarian). Dairy/eggs are NOT conflicts (lacto-ovo is the market norm; documented + pinned by tests). Enforced on creation POST and PATCH. User-declared category is never presented as independently verified (copy audited).

### P4 — stale admin reviews: defect CONFIRMED and fixed (implemented · pure/mock-tested)
Review POST was read → validate → write with no concurrency guard. New `Recipe.contentHash` (SHA-256 over canonical content; migration `20261015121500_v215_recipe_content_hash`, additive, nullable, zero DROPs). PATCH recomputes it atomically and accepts `expectedContentHash` → **409 `stale_recipe`** on mismatch. Review POST writes via conditional `updateMany` (0 rows → 409); `verify` additionally re-reads before writing and refuses with 400 `incomplete_nutrition` if `needsReview` flipped. Pre-v21.5 rows (NULL hash) use the legacy path until their first PATCH. The SHA-256 is pure TypeScript — a `node:crypto` import here broke `next build` (client bundle) and was replaced; byte-identical output verified against `node:crypto`, plus a regression test forbidding `node:` imports in the module.

### P5 — yieldGrams contract: clarified (implemented · pure/mock-tested)
`yieldGrams` was listed as material with a false "re-bases every recorded number" claim; in reality per-serving nutrition is always batch totals ÷ `portions` and nothing consumes `yieldGrams` functionally. Moved to `NON_MATERIAL_RECIPE_FIELDS` (informational: the cook's reference for actual batch weight). A yieldGrams-only PATCH now stores the value with nutrition and evidence untouched; `portions` remains material. Documented in `recipe-governance.ts` §4.

### Verification actually executed (2026-10-15, coordinator)
- Typecheck: **0 errors** (`apps/web`, `@fitfusion/core`, `@fitfusion/db`, incl. new `check:prisma-syntax` for prisma scripts).
- Core: **359/359** (25 files) incl. new diet-conflicts (19), governance (33, incl. hash + isomorphic guard).
- Web recipe suites: **81/81** (7 files) incl. new v215-patch-allergen-rescreen (14), v215-vegetarian-conflicts (10), recipe-stale-content-mocked (12).
- Migration: `prisma validate` → valid; zero DROPs. **DB-tested: blocked** — no PostgreSQL on this machine; DB suites skip-guard. **Browser-tested: blocked** — no runner in repo.
- Production build: **exit 0** (after fixing the `node:crypto` bundle break above).
- Drive-by fixes: stale `micronutrients.test.ts` assertion (`micros: null` now valid per the v21.4 web-search fix); share-card date-bomb test (pinned `todayIso` test seam added to `describeCardAvailability`).

### Remaining limitations
- Pre-v21.5 stored recipe rows screen on display names until their next material edit (no backfill — forward-only rule).
- `contentHash` NULL rows use the **explicit-null conditional** review path (v21.7): the guard is `updateMany({ where: { id, contentHash: null, revision: expectedRevision } })` — still concurrency-safe, never an unconditional write. There is no unguarded review path.
- Name-based screening is over-inclusive by design ("Peanut Butter" also matches the milk family via `butter`); the UI caveat stands — screening ≠ certified verification.
- The v21.4 migration `20261015090000_v214_recipe_allergen_screening` and the new v21.5 migration must both be applied (`prisma migrate deploy`) wherever the app database runs, before code using `allergenScreened`/`contentHash` is deployed there.
- DB-backed paths (live PATCH re-screen, conditional review writes, migration apply) need a real PostgreSQL exercise; Google Fit OAuth and USDA-live still need owner keys + one smoke test each.

## v21.6 addendum (2026-10-15, coordinator — final concurrency & recipe-identity hardening) [historical]

**Status key:** implemented (source) · pure/mock-tested (vitest, no DB) · DB-tested (real PostgreSQL) · browser-tested · blocked/not-run.

- **Identity-aware content hash** (implemented · pure/mock-tested): `computeRecipeContentHash` canonical form now includes `foodId` + `canonicalName` — same display name with different foodIds hashes differently (verified live); identical inputs hash identically. v21.6 canonical form supersedes v21.5's (rows adopt it on next write/backfill; the guard compares at write time so this is safe).
- **Backfill script** (implemented · logic-tested, **live run pending**): `packages/db/prisma/backfill-recipe-hashes.ts` (`npm run db:backfill-hashes`), idempotent, conditional `updateMany({ where: { id, contentHash: null } })` writes, `--dry-run` supported. **NOT run against production** — that stays an owner-side step after deploy.
- **Concurrency guards enforced** (implemented · pure/mock-tested): missing/stale `expectedContentHash` → 409 `stale_recipe` on PATCH/review/verify/clear; explicit-null legacy path for NULL-hash rows; hash included in API responses; admin client submits the loaded hash.
- **Verification (historical, 2026-10-15):** typecheck 0 errors; core 41/41 governance + 32/32 web concurrency suites (spot figures — see v21.7 for current full counts); build exit 0; dist rebuilt from src. DB-backed concurrency tests: blocked (no PostgreSQL) — written skip-guarded.

## v21.7 addendum (2026-10-15, coordinator — revision token, deterministic hashing, truthful backfill)

**Status key:** implemented (source) · pure/mock-tested (vitest, no DB) · DB-tested (real PostgreSQL) · browser-tested · blocked/not-run.

### P1 — revision token for review-state concurrency (implemented · pure/mock-tested)
Defect: `expectedContentHash` never changes on review/verify/clear, so two concurrent admin actions could pass the same guard and clobber each other's review state. Fix: new `Recipe.revision Int @default(0)` (migration `20261015195900_v217_recipe_revision`, additive, zero DROPs). **Every** recipe or review-state mutation (material PATCH, metadata-only PATCH, admin review/verify/clear) increments revision atomically inside the same conditional `updateMany({ where: { id, revision: expectedRevision }, data: { …, revision: { increment: 1 } } })`; zero matched rows → **409 `stale_recipe`**. Clients submit the (hash, revision) pair they read; the admin UI was updated. Relationship to `contentHash`: the hash is *content identity* (changes only on material content change, drives evidence invalidation); the revision is a *mutation counter* (changes on every write, drives write serialization). Metadata-only edits bump revision but preserve evidence per policy. Client revision is a concurrency precondition only — owner/admin authorization runs first and is unchanged. Files: `schema.prisma`, `packages/core/src/recipe-governance.ts` (§5b), `packages/core/src/validation.ts`, `apps/web/app/api/recipes/[slug]/route.ts`, `apps/web/app/api/admin/recipes/[slug]/review/route.ts`, `apps/web/components/AdminRecipeReview.tsx`. Tests: `v217-revision-guard-mocked.test.ts` 25/25 (missing/stale/malformed revision; clear-vs-verify, review-vs-clear, review-vs-review, edit-vs-review races; metadata-only evidence preservation; legacy revision-0); `v217-revision-guard-db.test.ts` 4 genuine race scenarios written, **DB-tested: blocked** (skip-guarded — no PostgreSQL on this machine).

### P2 — deterministic hash canonicalization (implemented · pure/mock-tested)
Defect: the ingredient sort compared foodId → canonicalName → name → grams but not quantity/unit, so rows tying on the first four keys kept input order (stable sort) and identical content could hash differently. Fix: comparator now covers all six canonical fields (… → quantity → unit). Reordered arrays hash identically; different foodIds/grams/quantity/unit stay distinguishable; documented whitespace/case normalization unchanged; single shared code path (creation/PATCH/review/verify/backfill). v21.7 canonical form supersedes v21.6's — rows adopt it on next write/backfill; safe because the guard compares at write time. Tests: 7 new in `recipe-governance.test.ts` (tied rows reversed, 4 permutations, duplicates, differing foodIds/grams, legacy rows, payload distinguishability) — 48/48 in file.

### P3 — truthful backfill reporting (implemented · logic-tested, **live run pending**)
Defect: the backfill script could exit 0 with skipped rows. Fix: new `--allow-partial` flag; exit non-zero when rows remain unprocessed (skipped + failed; raced rows don't count — a concurrent write already set a hash) unless `--allow-partial`; final message states complete / PARTIAL / FAILED / INCOMPLETE truthfully. Kept: `--dry-run` non-destructive, conditional writes, scanned/written/wouldWrite/raced/skipped/failed counts, repeat-safe, no revision touch, shared `@fitfusion/core` canonicalization (import-guarded against forks). Invocation: `npm run db:backfill-hashes --workspace @fitfusion/db -- --dry-run` (repo root) or `npm run db:backfill-hashes -- --dry-run` (db workspace). Tests: `backfill-recipe-hashes.test.ts` 18/18 (exit-code matrix, message truthfulness, determinism, revision-untouched, import guard). **The backfill has NOT been run against any production database** — script availability ≠ backfill performed. Owner-side steps: `--dry-run` first, then `-- --batch-size 200`.

### Verification actually executed (2026-10-15, coordinator)
- Typecheck: **0 errors** (`apps/web`, `@fitfusion/core`, `@fitfusion/db`, incl. `check:prisma-syntax`, 21 prisma files OK).
- Core: **375/375** (25 files), incl. governance 48/48 (7 new v21.7).
- Web concurrency/review suites: **104/104** (6 files: v217-revision-guard-mocked 25, v216-concurrency-guards-mocked 16, recipe-stale-content-mocked 16, recipe-patch-governance-mocked 9, recipe-review-mocked 21, recipe-review-validation-v214 17).
- DB: backfill 18/18, quality-report 9/9; prisma validate → valid; migration `20261015195900_v217_recipe_revision` zero DROPs. **DB-tested: blocked** — no PostgreSQL on this machine (4 genuine race tests + live backfill await it). **Browser-tested: blocked** — no runner in repo.
- Production build: **exit 0** (no concurrent dev server).
- Identity-hash spot-check executed live: different foodIds → different hashes; identical inputs → identical hashes.

### Remaining limitations
- **Concurrency is not declared fully resolved**: backfill live-run + real-PostgreSQL race tests pending (environmental).
- Pre-v21.7 stored rows have `revision = 0`; first guarded write moves them forward atomically.
- Migrations `20261015090000_v214_recipe_allergen_screening`, `20261015121500_v215_recipe_content_hash`, and `20261015195900_v217_recipe_revision` must all be applied (`prisma migrate deploy`) before deploying this code.
- Name screening remains over-inclusive by design (caveat stands); Google Fit OAuth and USDA-live still need owner keys + one smoke test each.

## v21.8 addendum (2026-10-16, coordinator — data integrity, restaurant & nutrition fixes)

**Status key:** implemented (source) · pure/mock-tested (vitest, no DB) · DB-tested (real PostgreSQL) · browser-tested · blocked/not-run.

### P1 — seed safety for existing records (implemented · pure/mock-tested)
Defect: `prisma/seed.ts` rewrote material recipe fields (and `verified: false`) on every run without recomputing `contentHash`, bumping `revision`, or invalidating evidence — silently downgrading admin-verified recipes. Exercise upserts reset `mediaType`/`mediaUrl` to none/null, wiping authorized imported media. Fix: new pure `packages/db/src/seed-safety.ts` — `planRecipeSeed` classifies each recipe as create / skip (private: `userId != null` or `isPrivate` — never touched) / unchanged / metadata-only / material, using the canonical `computeRecipeContentHash(buildContentSnapshot(…))` (single source of truth — same canonicalization as PATCH and the backfill script). Unchanged content → zero writes, evidence untouched. Material change → one conditional `updateMany({ where: { id, revision: readRevision } })`: recomputed hash, `revision` increment, evidence invalidated (`verified: false` + JsonNull), allergens re-screened as union(declared, screenIngredientAllergens(names)) — union chosen because 101/270 seed recipes' declared lists differ from the screener in both directions (e.g. margherita-pizza declares milk/wheat the screener misses; blindly replacing curated lists would introduce false negatives). Exercises never touch mediaType/mediaUrl unless the seed entry explicitly carries media. Report: created/updated/unchanged/skipped/failed per record type; exit 1 on failures. No migration needed (seed logic only). Tests: `seed-safety.test.ts` 26/26 executed (create/skip/unchanged/metadata-only/material/legacy-null-fill/no-false-negative-union/mocked write paths/exercise media/stats) + real-data idempotency over all 239 v21 batch recipes; `seed-safety.integration.test.ts` 7 tests skip-guarded (**DB-tested: blocked** — no PostgreSQL here). Files: `packages/db/src/seed-safety.ts` (new), `packages/db/src/index.ts`, `packages/db/prisma/seed.ts`, tests.

### P2 — restaurant-menu publication workflow (implemented · pure/mock-tested)
Defect: `POST /api/menus/confirm` used `requireUser` (any authenticated user) and wrote directly to `RestaurantMenuItem` — the table served by the public menu GET; any user could publish unreviewed items. Fix: new `MenuSubmission` model (status pending|approved|rejected, `submittedBy`, `reviewedBy`/`reviewedAt`/`reviewNote`, `publishedItemId`, `source`, `matchedFoodId`) — forward-only additive migration `20261016133000_v218_menu_submissions` (validated byte-identical to Prisma's generated DDL). Confirm now validates fully, then inserts `pending` submissions in one `prisma.$transaction` (failed batch → zero partials) and never publishes. Admin routes: `GET /api/menu-submissions?status=` (queue), `PATCH /api/menu-submissions/[id]` (approve publishes a copy in the same interactive transaction as the review stamp; reject keeps it private; 409 on re-review; 403 non-admins). Public GET unchanged (reads `RestaurantMenuItem` only — pending is invisible). Admin UI gained a pending-submissions queue + review modal. Tests: `menu-material-change.test.ts` 10/10, `menu-routes-mocked.test.ts` 17/17 executed; `v218-menu-submissions.test.ts` 25 tests written, skip-guarded (**DB-tested: blocked**). Note: old-flow published rows remain published (grandfathered — destructive cleanup flagged for owner decision).

### P3 — conservative allergen filtering (implemented · pure/mock-tested)
Defect: `excludeAllergen` only excluded known matching labels; `allergenScreened: false` recipes passed the filter and were presented as satisfying the request. Exclusion terms also missed synonyms ("dairy", "gluten", "tree-nut"). Fix (fail closed — exclusion, not a separate section): when `excludeAllergen` is present the clause is `{ allergenScreened: true, NOT: { allergens: { hasSome: <resolved terms> } } }`. New `resolveAllergenExclusionTerms()` in core maps synonyms/canonical family names (dairy→milk, gluten→wheat, peanut→peanuts, tree-nut spellings→tree nuts, plus member foods); peanut and tree-nut stay separate families; unmapped terms pass through verbatim. New pure `apps/web/lib/recipe-allergen-filter.ts` (`buildAllergenExclusionWhere`, `recipeEligibleUnderAllergenExclusion`). UI note under the filter + retained detail-page allergen caveat (name screening ≠ allergy safety). Tests: core +7 synonym tests; `v218-allergen-exclusion-tier.test.ts` 19/19 (screened+matching→excluded, screened+clean→included, unscreened+empty→excluded, unscreened+stale→excluded, synonyms). No migration. Pre-existing: `mine=1` ignores `excludeAllergen` (out of scope).

### P4 — incomplete-nutrition policy at every tier (implemented · pure/mock-tested)
Defect: verify endpoint refused `needsReview: true`, but canonical `qualityTier()` ignored it — a legacy record (verified evidence + needsReview) tiered `verified`, showing "Verified" next to "Awaiting review". Fix: `needsReview: true` caps the tier at `calculated-estimate` — never Verified or Reviewed. Single source of truth `qualityTier()` in `@fitfusion/core` (`QualityTierInput.needsReview?` optional; absent = pre-v21.8 behavior). `apps/web/lib/recipe-evidence.ts` now requires `needsReview` at every serializer input; public and admin serializers agree by construction; verify-success response derives the tier canonically instead of hardcoding 'verified'. `apps/web/lib/recipe-tier.ts` demotes stale `tier:'verified'` + needsReview at presentation time (demotes only, never promotes). Tests: core `recipe-claims.test.ts` +4; web +10 (public/admin agreement, wrapper demotion). No migration.

### P5 — stale restaurant-menu verification on edit (implemented · pure/mock-tested)
Defect: `PATCH /api/menu-items/[id]` preserved `lastVerifiedAt` even when name/portion/nutrition/source changed. Fix: pure `menuPatchHasMaterialChange()` (material fields incl. source + nutritionStatus; '' ≡ null; 1e-9 float tolerance for Postgres↔JS round-trips). Material change → `lastVerifiedAt = null` unless `verify:true` in the same request re-stamps a fresh verification. Non-material/no-op edits preserve the stamp. Anti-laundering: `verify:true` rejected (400) when merged nutritionStatus is `unavailable`. Admin UI Verify button disabled for unavailable items. Tests: 10/10 in `menu-material-change.test.ts` + P5 cases in `menu-routes-mocked.test.ts`.

### P6 — honest menu estimator (implemented · pure-tested)
Defect: `estimateFromRecipe` filtered invalid rows before summing — a plausible total that silently omitted ingredients (e.g. chicken + "mystery sauce" with no kcal data returned the chicken-only total as the dish nutrition); the admin page additionally pre-filtered bad rows so they never reached the estimator. Fix: every row is now classified; `EstimateProblem { row, ingredient, reason }`; `RecipeEstimate` gains `complete: boolean` + `problems`. Missing/NaN quantity, zero/negative grams (incl. "oil to taste"), missing/zero kcalPer100g, unnamed-with-data → problems. Incomplete → `complete: false`, INCOMPLETE banner listing each row + reason, partial subtotal labeled "do not use", no "Use this estimate" button. Complete path byte-for-byte unchanged (assumptions, ±15% range, oil handling). Tests: `menu-estimate-incomplete.test.ts` 8/8 + `restaurant-menus-pure.test.ts` 4/4 = 12/12 executed. No migration.

### P7 — upload ownership and retention (implemented · pure/mock-tested)
Defect: `GET /api/uploads/[key]` checked authentication only — any authenticated user with a known/guessed key could fetch another user's scans, menu screenshots, or data exports. Fix: new `Upload` ownership registry (migration `20261016133000_v218_upload_ownership`, additive-only: one new table; pre-v21.8 files resolve ownership at read time from the requester's own FoodScan/DataExport rows and self-heal). New `apps/web/lib/uploads.ts`: `saveOwnedUpload` (records uploader+purpose; deletes the file if the registry write fails — no ownerless uploads), `resolveUploadOwner`, pure `decideUploadAccess` (owner / ADMIN_EMAILS allowlist / deny), `auditUploadAccess` (key+metadata only — never contents/secrets), `markUploadTemporary`, `purgeExpiredUploads` (default 24h via UPLOAD_TEMP_RETENTION_HOURS). Retrieval: 404 for non-owners/unknown keys (no existence oracle); admin access audit-logged, fail-closed on empty allowlist. Scans/menu-extracts/data-export wired; account deletion cleans registry + legacy keys. New admin-gated `POST /api/uploads/purge` sweep — **no in-repo scheduler invokes it; deployment must call it on a schedule.** Tests: `upload-ownership-pure.test.ts` 26/26 executed (mocked delegate + temp-dir storage).

### Verification actually executed (2026-10-16, coordinator)
- Typecheck: **0 errors** (`apps/web`, `@fitfusion/core`, `@fitfusion/db`, incl. `check:prisma-syntax`, 23 prisma files OK).
- Core: **386/386** (25 files), incl. allergen-screening +7, claims +4.
- DB: **408 passed / 11 skipped** (14 files), incl. new seed-safety 26/26; skips are DB-gated (7 seed-safety integration + 4 pre-existing).
- Web v21.8 suites: **125/125** (8 files: allergen-exclusion-tier 19, menu-estimate-incomplete 8, menu-material-change 10, menu-routes-mocked 17, upload-ownership-pure 26, v217-revision-guard-mocked 25, v216-concurrency-guards-mocked 16, restaurant-menus-pure 4).
- Migrations: `20261016133000_v218_menu_submissions` + `20261016133000_v218_upload_ownership` — both additive, zero DROPs; same timestamp prefix sorts deterministically (`menu` < `upload`); `prisma validate` → valid.
- Production build: **exit 0** (no concurrent dev server).
- **DB-tested: blocked** — no PostgreSQL on this machine (seed-safety integration 7, menu-submissions 25, revision-guard-db 4, backfill live run — all written skip-guarded, pending owner-side). **Browser-tested: blocked** — no runner in repo.

### Remaining limitations
- Backfill (`db:backfill-hashes`) still not run against any production database — script availability ≠ backfill performed; concurrency not declared fully resolved.
- Retention sweep (`POST /api/uploads/purge`) needs a deployment-side schedule; nothing calls it in-repo.
- `MenuSubmission` old-flow published rows grandfathered; pre-v21.8 uploaded files self-heal the registry on first owner read (mime 'unknown', byteSize 0 — honest).
- `mine=1` recipe browse ignores `excludeAllergen` (pre-existing, out of scope).
- Migrations `20261015090000_v214_recipe_allergen_screening`, `20261015121500_v215_recipe_content_hash`, `20261015195900_v217_recipe_revision`, `20261016133000_v218_menu_submissions`, `20261016133000_v218_upload_ownership` must all be applied (`prisma migrate deploy`) before deploying.
- Google Fit OAuth and USDA-live still need owner keys + one smoke test each.

## v22 Phase A addendum (2026-10-31 — Yoga & Aerobics: data layer, seed content, catalog APIs, media manifest)

Scope honoured: data layer + seed + catalog APIs + media manifest ONLY. No UI
pages/players (Phases B/C), no changes to sessions/progress/plan-generator/coach
(Phase D), no existing endpoint behaviour changed, billing untouched.

| Item | Grade | Evidence |
| --- | --- | --- |
| Prisma models `YogaPose`, `YogaSequence`, `YogaSequencePose`, `AerobicRoutine`, `RoutineStep`; additive `WorkoutSession.kind/sourceSlug/durationSeconds/caloriesEstimateKcal`; additive `Profile.workoutTypes` | **PASS** | `prisma validate` clean; `prisma generate` clean; schema diff reviewed field-by-field against the approved plan |
| Migration `20261031074725_v22_yoga_aerobics` | **PASS** | Generated via `prisma migrate dev` against a scratch PostgreSQL 16 after baseline `migrate deploy` of the 19 prior migrations; SQL inspected — ONLY `ADD COLUMN`s (with defaults), 5 `CREATE TABLE`s, indexes and FKs; zero drops/renames/column alters. Fresh empty-DB `migrate deploy` of all 20 migrations → "Database schema is up to date!" |
| `@fitfusion/core` MET module (`met.ts`: `YOGA_MET`, `AEROBICS_MET`, `estimateCaloriesKcal`, `sequenceDurationSeconds`, `routineDurationSeconds`) | **PASS** | 12/12 new unit tests; full core suite **398/398** (26 files). All outputs are estimates and must be labelled as such |
| Seed content: 25 yoga poses, 7 sequences (62 sequence poses), 6 aerobic routines (87 steps) | **PASS** | Seed run TWICE against the scratch DB with identical counts both runs (`yogaPoses=25 yogaSequences=7 sequencePoses=62 aerobicRoutines=6 routineSteps=87`); existing counts unchanged (recipes=270, exercises=50, foods=169). Original copy, no medical/rehabilitation claims; every routine duration ≈ target (870/1200/1500/1500/1800/1800 s) |
| Catalog APIs: `GET /api/yoga/poses`, `GET /api/yoga/sequences`, `GET /api/yoga/sequences/[slug]`, `GET /api/aerobics/routines`, `GET /api/aerobics/routines/[slug]` | **PASS** | 8/8 integration tests against the seeded scratch DB: list counts, filters, pose order + `each` side preserved, phase order warmup→main→cooldown, computed durations match core maths, unknown slugs → 404 `not_found` |
| Guided-media manifest (`apps/web/lib/guided-media/manifest.ts`) | **PASS** | 4/4 tests: covers exactly the seeded 25+6 slugs (asserted against the seed data file), every non-null URL resolves to a real file in `public/`, zero references to `/exercise-videos/` or `/exercise-gifs/`. All entries are honest placeholders (null URLs) — no demonstration media exists yet |
| Typecheck (all workspaces) | **PASS** | `npm run typecheck` → 0 errors |
| Production build (`apps/web`) | **PASS** | `next build` compiled successfully; all 5 new API routes present in the route table |
| Existing suites | **PASS with disclosed pre-existing failures** | db **419/419** (14 files); ai **11/11**; web **1042 passed / 14 failed / 1 skipped** (1057). The 14 failures are in 7 older files (seed-data, v18-custom-recipes, v212-nutrition-correctness, v212-recipe-browse, recipe-serving-diary, onboarding-options, extended-flows) and are **pre-existing drift**, not Phase A regressions: none touch yoga/aerobics/workouts or any file changed in Phase A. Evidence: `seed-data.test.ts` expects 31 recipes/149 foods/544 aliases vs the 270/169/571 the seed has produced since the v21 batch; `v212-recipe-browse` expects `halal` tag counts after halal tags were stripped in v21; diary/nutrition tests expect 201 where v21.4 governance validation returns 400; custom-recipe nutrition totals predate the v18/v21 food-catalog expansion; onboarding test expects a `body.data` envelope the route does not emit. Identified, not hidden; fixing them is out of Phase A scope |

**Phase A limitations (honest):**
- All pose/routine media is `placeholder` with null URLs — no demonstration assets exist yet (Step 7-compliant; nothing is faked or substituted).
- Yoga/aerobics sessions cannot be started or completed yet — players are Phases B/C; `WorkoutSession` guided columns are schema-ready but unused until Phase D wiring.
- The catalog API integration suite skips (visibly) unless the DB is seeded; it was executed here against the seeded scratch DB (8/8).

## v22 Phase B addendum (2026-10-31 — Yoga UI, pose-by-pose player, guided completion recording)

Scope honoured: yoga browse/detail/player + additive guided-session recording
ONLY. No aerobics UI (Phase C), no preferences/plan-generator/progress/coach
changes (Phase D), no existing strength-flow behaviour changed, billing
untouched, no `.env`/secrets read or edited.

| Item | Grade | Evidence |
| --- | --- | --- |
| Guided player state machine (`apps/web/lib/guided-player/machine.ts`) | **PASS** | Pure TS (no React): 'each' expands to left-then-right holds, transitions inserted between poses with the incoming step's transitionSeconds, PAUSE freezes countdown + elapsed, SKIP never counts a segment, REPEAT restarts a hold / rewinds from a transition (un-counting the hold), FINISH_EARLY completes with partial counts. 13/13 unit tests |
| `POST /api/workouts/sessions` guided creation | **PASS** | Additive `kind` (default 'strength') + `sourceSlug`; yoga requires sourceSlug (400 without), unknown slug → 404 `not_found`, name defaults to the sequence title, kind+sourceSlug stored. Integration-tested against seeded scratch PG |
| `PATCH /api/workouts/sessions/[id]` guided completion | **PASS** | Additive optional `durationSeconds` (1..21600). Only for yoga/aerobics sessions being marked completed: stores duration (client value, else wall-clock from startedAt→endedAt) and computes `caloriesEstimateKcal` SERVER-SIDE from the sequence/routine MET value + latest weight Measurement (kg as-is; lb/lbs × 0.453592; unknown unit → null). Schema accepts no client calorie value (smuggled value proven ignored). Strength sessions: guided fields ignored entirely — proven by test (duration/calories stay null) |
| Guided-sessions integration suite | **PASS** | 9/9 against the seeded scratch PostgreSQL: 401 unauthenticated, 404 bad slug, 400 missing slug, create→complete stores kind/sourceSlug/duration, exact rounded MET calories for kg weight, null calories without weight, exact lb conversion, cross-user PATCH → 404 with the row untouched, strength regression |
| Yoga browse `/workouts/yoga` | **IMPLEMENTED** | 7 category cards (display names mapped from API category slugs) + full sequence list with level/pose count/total duration, all from `GET /api/yoga/sequences`. Built and typechecked; not browser-exercised |
| Yoga preview `/workouts/yoga/[slug]` | **IMPLEMENTED** | Ordered pose list (name, Sanskrit name, hold time, side), safety notes, honest labelled media placeholder, Start Session → player. Built and typechecked; not browser-exercised |
| Yoga player `/workouts/yoga/[slug]/play` | **IMPLEMENTED** | Machine-driven: big countdown, pose X of Y + progress bar, instructions/breathing/beginner modification/cautions, side labels, transition "Get ready" state, next-pose preview, pause/resume/repeat/skip/end-with-confirm, WebAudio segment beeps, aria-live pose announcements, completion screen (active time, poses completed, "Estimated calories" from the PATCH response or the add-weight guidance when null). Creates the guided session on Start and PATCHes completion with active elapsed seconds. Not browser-exercised |
| Workouts hub Yoga entry card | **IMPLEMENTED** | One additive card on `/workouts` linking to `/workouts/yoga`; page otherwise unrestructured |
| Typecheck (all workspaces) | **PASS** | web/core/db/ai `tsc --noEmit` → 0 errors |
| Production build (`apps/web`) | **PASS** | `next build` compiled successfully; new routes in the table: `/workouts/yoga`, `/workouts/yoga/[slug]`, `/workouts/yoga/[slug]/play` |
| Existing suites | **PASS with disclosed pre-existing failures** | core **398/398**; db **419/419**; ai **11/11**; web **1064 passed / 14 failed / 1 skipped** (1079). The 14 failures are the SAME pre-existing drift in the same 7 files as Phase A (seed-data ×5, v18-custom-recipes ×3, v212-nutrition-correctness, v212-recipe-browse, recipe-serving-diary, onboarding-options, extended-flows) — no new failures; the +22 passing tests over Phase A are the new Phase B suites (13 machine + 9 guided-sessions) |

**Phase B limitations (honest):**
- The three yoga pages are IMPLEMENTED, not PASS: they were compiled and typechecked but never exercised in a real browser in this phase.
- Pose media remains `placeholder` everywhere — the player shows the clearly labelled "Demonstration media coming soon" panel; no video is faked or substituted.
- Guided sessions record into `WorkoutSession` history, but progress/plan/coach surfaces do not yet present guided sessions distinctly — that wiring is Phase D.
- Aerobics sessions cannot be created from the API yet (`kind` enum is strength|yoga); the PATCH completion path already handles kind 'aerobics' for Phase C.

## v22 Phase C addendum (2026-10-31 — Aerobics UI, follow-along player, aerobics guided sessions)

Scope honoured: aerobics browse/preview/player + the additive aerobics
extension to guided-session creation ONLY. No Phase D work (preferences /
plan mixing / progress / coach), no Phase E work, no existing endpoint
behaviour changed beyond the specified additive `kind: 'aerobics'` support
in `POST /api/workouts/sessions`, the PATCH route was NOT modified, billing
untouched, no `.env`/secrets read or edited. Source: v22.2 (cumulative —
Phase A + B + C).

| Item | Grade | Evidence |
| --- | --- | --- |
| Aerobics follow-along engine (`apps/web/lib/guided-player/aerobics-machine.ts`) | **PASS** | Pure TS sibling to the yoga machine (yoga machine + its 13 tests untouched, still 13/13). Steps sorted warmup→main→cooldown then step order; exactly ONE timed segment per step — no bilateral expansion, no inserted transitions; segments carry step name, cue, lowImpactAlternative, phase label. Same playback semantics: PAUSE freezes countdown + elapsed, SKIP never counts, REPEAT restarts the current step, FINISH_EARLY preserves active elapsed, total = plain step sum (cross-checked against `routineDurationSeconds` from `@fitfusion/core` and the detail API's `totalDurationSeconds`). 13/13 new unit tests |
| `POST /api/workouts/sessions` aerobics creation | **PASS** | Additive: `kind` enum extended to include `'aerobics'`; aerobics requires `sourceSlug` (400 `validation_error` without), validates against `prisma.aerobicRoutine` (404 `not_found`), name defaults to the routine title, `sourceSlug` stored for guided kinds (yoga + aerobics), `null` for strength. Strength and yoga request/response behaviour unchanged — proven by the pre-existing suite cases |
| `PATCH /api/workouts/sessions/[id]` aerobics completion | **PASS** | Route NOT rewritten in Phase C; its pre-existing aerobics path (server-side `guidedCalorieEstimate()` from `AerobicRoutine.metValue` + latest weight) was exercised end-to-end for the first time by the new integration cases: duration stored, calories = exact rounded MET formula, client-smuggled calorie value ignored |
| Guided-sessions integration suite (aerobics block) | **PASS** | 14/14 in the file against the seeded scratch PostgreSQL (9 pre-existing yoga/strength + 5 new aerobics): valid create → 201 with kind/sourceSlug/name from routine; bad slug → 404; missing slug → 400; completion stores duration + server-calculated MET calories with smuggled value ignored; cross-user PATCH → 404 with the row untouched |
| Aerobics browse `/workouts/aerobics` | **IMPLEMENTED** | 6 category cards (beginner, low-impact, dance, moderate-cardio, full-body, advanced) + full routine list from `GET /api/aerobics/routines` (level/category badges, duration, step count). Built and typechecked; not browser-exercised |
| Aerobics preview `/workouts/aerobics/[slug]` | **IMPLEMENTED** | Phase breakdown (warm-up/main/cool-down step lists with per-step durations), intensity + level, total duration/step count, low-impact alternatives noted per step, safety notes when present, honest labelled media placeholder (`mediaStatus` placeholder — no fake video). Built and typechecked; not browser-exercised |
| Aerobics player `/workouts/aerobics/[slug]/play` | **IMPLEMENTED** | Machine-driven follow-along player: big countdown, current move + cue, phase indicator (Warm-up / Main / Cool-down), current step's low-impact alternative, next-move preview, pause/resume/repeat/skip, WebAudio step-change cues (yoga player pattern), aria-live announcements, completion screen. Creates the session via POST `{kind:'aerobics', sourceSlug}` on Start (same point as the yoga player) and PATCHes completion with active elapsed seconds only — never client calories. Built and typechecked; not browser-exercised |
| Workouts hub Aerobics entry card | **IMPLEMENTED** | One additive card on `/workouts` immediately after the Yoga card, linking to `/workouts/aerobics`; page otherwise unrestructured |
| Typecheck (all workspaces) | **PASS** | `npm run typecheck` → exit 0, 0 errors |
| Production build (`apps/web`) | **PASS** | `next build` compiled successfully; new routes in the table: `/workouts/aerobics`, `/workouts/aerobics/[slug]`, `/workouts/aerobics/[slug]/play` |
| Existing suites | **PASS with disclosed pre-existing failures** | core **398/398**; db **419/419**; ai **11/11**; web **1082 passed / 14 failed / 1 skipped** (1097). The 14 failures are in the SAME 7 pre-existing files as Phases A/B (seed-data, v18-custom-recipes, v212-nutrition-correctness, v212-recipe-browse, recipe-serving-diary, onboarding-options, extended-flows) — no new failures; the +18 passing over Phase B are the new Phase C suites (13 engine + 5 sessions) |

**Phase C limitations (honest):**
- The three aerobics pages are IMPLEMENTED, not PASS: compiled and typechecked but never exercised in a real browser in this phase.
- Routine media remains `placeholder` everywhere — the preview and player show the clearly labelled "Demonstration media coming soon" panel; no video is faked or substituted.
- Guided sessions still record into `WorkoutSession` history; presenting them distinctly in progress/plan/coach surfaces remains Phase D (not started).

## v22 Phase D addendum (2026-10-31 — preferences, weekly-plan mixing, progress, coach context)

Scope honoured: the four Phase D pieces ONLY. No Phase E work, billing
untouched, no `.env`/secrets read or edited, every change to an existing
endpoint is additive. The strength-only plan-generator guard is absolute:
profiles with `workoutTypes` empty or `['strength']` generate plans
identical to pre-Phase-D behaviour (pinned by test). Source: v22.3
(cumulative — Phases A + B + C + D).

| Item | Grade | Evidence |
| --- | --- | --- |
| Workout-type preference API (`workoutTypes` on Profile) | **PASS** | `ProfileUpdateSchema` (packages/core) gains `workoutTypes`: enum `strength|yoga|aerobics`, max 3, deduplicated with first-occurrence order preserved — wiring PUT /api/profile and POST /api/onboarding through the shared schema. Settings route gains the same enum + dedupe and returns `workoutTypes` from GET /api/settings. Invalid values fail through the existing zod → `validation_error` 400 shapes. Integration (scratch PostgreSQL): settings round-trip dedupes `['yoga','strength','yoga']` → `['yoga','strength']`, invalid settings value → 400, profile round-trip stores/returns, invalid profile value → 400 (phase-d-preferences.test.ts, 4/4). Core validation unit tests added (core suite 404/404, +6 over Phase C) |
| Onboarding workout-type selection | **IMPLEMENTED** | Onboarding is the surface that actually collects workoutDays/workoutMinutesPerDay in the UI (settings/profile UIs do not edit those fields — audited), so the multi-select (Strength/Yoga/Aerobics CheckRows, existing toggleIn pattern) was added beside the workout-days toggles and sent in the onboarding payload when non-empty. Built and typechecked; not browser-exercised |
| Weekly-plan mixing (plan generator) | **PASS** | When `workoutTypes` includes yoga/aerobics, workout days deterministically become guided days referencing real seeded catalog entries. Rotation: guided kinds in fixed order (yoga, aerobics); mixed with strength, every SECOND workout session (odd index) is guided — strength days keep their own focus-rotation counter so strength picks are unaffected; guided-only profiles get all workout days guided, kinds cycling. Candidates filtered level-appropriately (seeded levels reuse the fitnessExperience vocabulary via the existing allowedDifficulties list, fallback to all of that kind) and ordered by (closest total duration to workoutMinutesPerDay, slug). Guided day Json: `{type:'yoga'|'aerobics', title, sourceSlug, durationSeconds, note}`. `no_exercises` 400 now only when strength days will actually be generated. Response notes gain exactly one additive guided note when guided days exist. Integration (seeded scratch PostgreSQL, phase-d-plan-mixing.test.ts, 4/4): `[]` vs `['strength']` days deep-equal (the pin); mixed ['strength','yoga'] has slug-verified yoga days + strength days and regenerates identically; guided-only ['yoga','aerobics'] has all workout days guided with both kinds; strength-only notes equal the exact 3 baseline strings |
| Workouts-page guided-day rendering | **IMPLEMENTED** | `normalizePlanDays` additively carries guidedKind/sourceSlug/durationSeconds; guided days render a Yoga/Aerobics badge, duration, and a "View session" link to the guided player route instead of the strength Start-session buttons. Dashboard parses plan days defensively and does not crash on guided days (checked; no change needed). Built and typechecked; not browser-exercised |
| Progress — active minutes + estimated calories (`GET /api/progress`) | **PASS** | Additive only: workouts object gains `activeMinutes`, `estimatedCaloriesKcal` and `byKind` {strength, yoga, aerobics} × {sessions, completed, activeMinutes, estimatedCaloriesKcal}; byDay entries gain `activeMinutes`. All computed from COMPLETED sessions' stored durationSeconds/caloriesEstimateKcal only — null durations contribute nothing, null calories count 0, nothing is estimated retroactively; every pre-existing field keeps identical values. Integration (phase-d-progress-coach.test.ts): hand-seeded sessions of all three kinds incl. null-calorie and an in-progress yoga (3600s/999 kcal, excluded) reproduce the exact expected totals (50 active minutes, 150 estimated kcal, per-kind splits, per-day minutes) |
| Progress page summary UI | **IMPLEMENTED** | Defensive parsing (absent fields → 0) + a MetricCard row in the page's existing style: Active minutes, Estimated calories (labelled "estimated calories from completed workouts"), Strength/Yoga/Aerobics session split, Guided minutes with per-kind subtext. Built and typechecked; not browser-exercised |
| Coach context (`lib/coach-context.ts`) | **PASS** | Additive, same sentence style; the coach_personalization opt-out early return is untouched (tested: opted-out user → ''). Profile sentence gains `workout types: …` only when set. The existing `Workouts in the last 7 days: N.` sentence is byte-identical (now counted from the same findMany). Only when guided sessions exist in the window, one added sentence: per-kind guided counts (all statuses, matching the total-count semantics) with completed-only active minutes and estimated kcal — e.g. "Guided workouts in the last 7 days: 2 yoga, 1 aerobics, 50 active minutes, ~150 estimated kcal burned." No guided sessions and no preferences → output byte-identical to pre-Phase-D |
| Typecheck (all workspaces) | **PASS** | `npm run typecheck` → exit 0, 0 errors |
| Production build | **PASS** | `npm run build` clean across all workspaces |
| Existing suites | **PASS with disclosed pre-existing failures** | core **404/404** (+6 new validation tests); db **419/419**; ai **11/11**; web **1093 passed / 14 failed / 1 skipped** (1108). The 14 failures are in the SAME 7 pre-existing files as Phases A–C (seed-data, v18-custom-recipes, v212-nutrition-correctness, v212-recipe-browse, recipe-serving-diary, onboarding-options, extended-flows) — no new failures; the +11 passing over Phase C are exactly the new Phase D integration tests. Of the 14, the one touching this phase's area is the pre-existing extended-flows misc-endpoints failure (includes the old progress `waterByDay` drift) — it predates Phase D, is unchanged in count, and was neither fixed (out of scope) nor worsened |

**Phase D limitations (honest):**
- All pages (onboarding selection, workouts-page guided cards, progress summary) are IMPLEMENTED, not PASS: compiled and typechecked but never exercised in a real browser in this phase.
- Guided plan days link to the guided session preview/player; starting a guided day does not yet create the session from the plan card (the player creates it on Start, as in Phases B/C).
- Progress active minutes for strength sessions remain 0 unless a duration was recorded — strength sessions store no durationSeconds today, and none is invented.

## v22 Phase E addendum (2026-10-31 — full test pass, end-to-end verification, release)

Scope honoured: verification and release ONLY. No new features; no source
behaviour changed (the only repo addition is the new chain test). Billing
untouched; no real `.env`/secrets read or edited — all verification ran
against a NEW sandbox scratch PostgreSQL 16 cluster created for this phase
(port 5433, database `fitfusion_phasee`) via process-env `DATABASE_URL`.
Source: v22.4 (cumulative — Phases A + B + C + D + E verification).

| Item | Grade | Evidence |
| --- | --- | --- |
| Fresh-environment proof (migrations + seed idempotency) | **PASS** | `prisma migrate deploy` from an EMPTY database: all 20 migrations applied, `20261031074725_v22_yoga_aerobics` last and clean. Seed run twice: guided counts identical both runs (poses 25, sequences 7, sequence poses 62, routines 6, steps 87); pre-existing catalogs untouched (exercises 50, recipes 270, foods 169) |
| Cross-phase end-to-end chain (`phase-e-e2e-chain.test.ts`) | **PASS** | 6/6 on the fresh seeded DB: (1) register + PUT /api/profile stores `workoutTypes` ['strength','yoga','aerobics']; (2) generated plan mixes strength days with guided days (yoga `relaxation-and-breathing`, aerobics `low-impact-aerobics` — plan probe verified slugs/titles/durations against the catalogs); (3) yoga (1800s) + aerobics (1200s) sessions completed through POST/PATCH sessions API with exact server MET calories for the recorded 70 kg weight; (4) GET /api/progress: total 2, completed 2, activeMinutes 50, estimatedCaloriesKcal = exact MET sum, byKind yoga {1,1,30,kcal} / aerobics {1,1,20,kcal} / strength zeros; (5) coach context contains the preference, "1 yoga, 1 aerobics", 50 active minutes, the estimated-kcal sum, latest weight; (6) second user: progress all zeros, coach context has no guided sentence and none of user 1's data |
| Browser exercise (Playwright Chromium, production build, real UI login) | **PASS** | Production server (`next start`) against the fresh seeded DB; health ok:true (database/env/migrations green). Logged in through the real login form (landed /dashboard). Every page below returned 200, rendered its expected content, and produced ZERO console/page errors; screenshots captured: /workouts (Yoga + Aerobics hub cards), /workouts plan view (guided days "Relaxation & Breathing" + "Low-Impact Aerobics" rendered), /workouts/yoga, /workouts/yoga/beginner-yoga-foundations (poses + hold times), …/play (player + Start), /workouts/aerobics, /workouts/aerobics/beginner-aerobics-starter (Warm-up/Main/Cool-down phases), …/play (player + Start), /progress ("Active minutes" + "Estimated calories" cards). Onboarding: wizard driven to the workouts step (basics filled, steps skipped) — "Workout types" Strength/Yoga/Aerobics check rows visible and the Yoga row toggles to the selected state on click. Pages graded IMPLEMENTED in Phases B–D are upgraded to PASS (browser-exercised) on this evidence. Full interactive player completion in the browser was not performed (API-level completion is chain-proven) |
| Full suites (fresh re-run) | **PASS with disclosed pre-existing failures** | core **404/404**; db **419/419**; ai **11/11**; web **1099 passed / 14 failed / 1 skipped** (1114). +6 passing over Phase D = exactly the new chain test's 6 steps. The 14 failures are the SAME tests in the SAME 7 pre-existing files as the Phase A baseline (seed-data 6, v18-custom-recipes 3, v212-nutrition-correctness 1, v212-recipe-browse 1, recipe-serving-diary 1, onboarding-options 1, extended-flows 1) — itemised in the release report; NOT fixed in this phase (pre-existing drift outside this module; a separate decision) |
| Typecheck (all workspaces) | **PASS** | `npm run typecheck` → exit 0, 0 errors |
| Production build | **PASS** | `npm run build` clean; route table includes all yoga/aerobics routes, /progress, /onboarding |
| Defects found in module code | **None** | Every Phase E check passed on its first run; no fix was required, so no source file changed in Phase E |

**Phase E limitations (honest):**
- Guided *player completion* was exercised end-to-end at the API level (chain test) and the play pages were loaded and verified rendering in a real browser, but a full in-browser play-through (pressing Start and running a session to completion in the UI) was not performed.
- Media for poses/routines remains the labelled placeholder ("Demonstration media coming soon"); no real demonstration assets exist yet.
- The 14 pre-existing failures in 7 older test files remain, unchanged, as known out-of-scope drift (see the release report for the itemised list).
