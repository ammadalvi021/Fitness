# FitFusion AI — Recipe Data Quality Report (v21.2 P8/P9)

Status of the recipe + ingredient seed data's governance claims: what each
label means, what evidence backs it, and what is still unknown. Written
2026-10-13 by Worker F (claims policy + data provenance).

## 1. Data-quality tiers (the three UI states)

Every recipe's nutrition falls into exactly one tier:

| Tier | Meaning | Evidence required |
|---|---|---|
| `calculated-estimate` | The per-serving nutrition is an **estimate**: engine-computed from the ingredient catalogue (v21 batches) or hand-authored (31 originals). Not human-reviewed, not independently verified. | None — this is the honest default. |
| `reviewed` | A named human checked the recipe's nutrition and claims and recorded the review. | Reviewer identity + date + scope, recorded. |
| `verified` | The **independent verification process** ran with recorded evidence. | ALL of `VERIFIED_STANDARD_EVIDENCE` (see §4). |

**Counts across the 270 seed recipes (measured 2026-10-13):**

| Tier | Count | Breakdown |
|---|---|---|
| `calculated-estimate` | **270** | 239 v21 batch (engine-computed) + 31 originals (hand-authored estimates) |
| `reviewed` | **0** | No human review records exist in seed data. |
| `verified` | **0** | No verification evidence exists in seed data. |

Of the 270, **92 carry `needsReview: true`** (16 Pakistani, 4 Indian/Middle-Eastern/Turkish,
40 Asian, 32 Western) — unresolved or un-convertible quantities whose nutrition
excludes those ingredients. These stay **visible** (never hidden): they are
calculated estimates flagged as awaiting review.

> **Count reconciliation (2026-10-14, Worker C):** an import-based recount of
> the actual seed modules gives exactly **16 + 4 + 40 + 32 = 92**, confirming
> this number. The conflicting "95" figure (used in FEATURE_STATUS.md and
> HANDOVER.md) was a text-grep artifact: `grep -c "needsReview: true"` across
> the batch files also matched the header-contract prose in three of the four
> batch files (one literal mention each in `seed-recipes-pakistani.ts`,
> `seed-recipes-indian-met.ts`, `seed-recipes-asian.ts`), yielding
> 17 + 5 + 41 + 32 = 95. Only the 92 are real recipe flags. An even earlier
> briefing mentioned "~98" — a pre-measurement approximation.
> `packages/db/prisma/recipe-quality-report.ts` is now the single source of
> truth, and `recipe-quality-report.test.ts` asserts these numbers against
> the docs so they cannot drift again.

### Badge spec (for the recipe list/detail UI)

- `verified` → **"Verified"** badge (success tone).
- `reviewed` → **"Reviewed"** badge (neutral/accent tone).
- `calculated-estimate` → **"Calculated estimate"** badge (neutral tone),
  with an additional **"Awaiting review"** marker when `needsReview` is true.
- Unresolved/unverified states must stay visible — never hidden behind a
  cleaner-looking badge.

Worker F did not implement these badges: the `[slug]` route and the recipes
list page were explicitly out of scope for this worker. The data side is
ready (`verified` flag is now honest; tiers are defined in
`packages/db/prisma/recipe-claims-policy.ts` `qualityTier()`).

## 2. The 31 original recipes — verified-status verdict

**Verdict: DEMOTED.** The 31 original recipes (`RECIPES` in
`packages/db/prisma/seed.ts`) were seeded with `verified: true`. Their
nutrition values are **hand-written** (authored, not engine-computed) and no
verification evidence was ever recorded — no independent check, no reviewer,
no date, no method. Under the standard in §4, the label was unevidenced.

**Change made:** `seed.ts` now seeds them with `verified: false` (the upsert
`data` object is shared by create+update, so re-running the seed corrects
already-seeded rows). Their honest tier is `calculated-estimate`
(sub-class: hand-authored, not engine-computed). The visible UI effect: the
detail page's "Verified" badge becomes "Curated" for these 31.

What "verified" requires is defined in `VERIFIED_STANDARD_EVIDENCE`
(`packages/db/prisma/recipe-claims-policy.ts`):
1. An independent check of the recorded per-serving nutrition against an
   authoritative source or an independent recomputation.
2. A recorded reviewer identity (`checkedBy`) distinct from the recipe author
   or generator.
3. A recorded check date (`checkedAt`) and method.
4. Dietary and allergen claims re-checked against the ingredient list at
   verification time.

**Important:** re-running the recipe engine and getting the same numbers is a
**regression test, not verification** and not independent accuracy proof (see §6).

## 3. Halal claims — old rule → new rule

**Old rule (DEAD):** `'halal-friendly'` (batches) / `'halal'` (western batch
and 31 originals) was granted by *pork-absence inference* — no pork-family
ingredient in the ingredient list ⟹ tag. This confused "we didn't see pork"
with a halal claim. **161 tags removed** (60 Pakistani + 59 Indian/MET +
25 Western + 17 across the 31 originals).

**New rule (v21.2 P8, canonical in `recipe-claims-policy.ts`):**
- A recipe may carry the explicit `halal-friendly` tag **ONLY** when a human
  reviewer asserted it and the review is recorded (`halalReview: { reviewer,
  reviewedAt }`). `mayClaimHalalFriendly()` enforces: tag AND non-blank
  review record, otherwise false.
- "No pork identified in the ingredients" is a **screening observation**, not
  a halal claim — it must never be presented as certification, and the UI must
  distinguish the two claims.
- **Current count: 0 recipes carry `halal-friendly`/`halal`.** No halal
  reviews have been recorded; the `halalReview` field exists on all seed
  interfaces as the mechanism for future reviews.

**Allergy.ts note:** `validateMealAgainstProfile` treats a `halal` *label* as
halal-safe for diet-preference matching — that is meal-plan validation logic,
not a data claim, and was left untouched.

## 4. Allergen claims — what is actually known

- Every seed recipe's `allergens` list is **declared from ingredient names**
  at generation time — a name-based screening, **not** a certified allergen
  analysis. This is now tracked explicitly: `allergenBasis` on the seed
  interfaces (absent = `'declared-from-ingredient-names'`).
- **Current count: all 270 recipes are name-derived; 0 are human-reviewed.**
- Wherever the basis is not a recorded human review, the UI must show the
  canonical caveat (`ALLERGEN_CAVEAT` in `recipe-claims-policy.ts`):

  > "Allergen information is declared from the recipe's ingredient names only.
  > It is not a certified allergen analysis: unlisted sub-ingredients, shared
  > cooking equipment, and cross-contamination are not assessed. If you have a
  > food allergy, verify every ingredient yourself before cooking."

- No allergen-safety promise may be derived from name matching — including
  via diet tags. (The vegan/gluten-free/dairy-free name-derivation rules were
  left as-is; they are absence-of-ingredient observations, not safety
  certifications, and were out of scope for this worker.)

## 5. Ingredient database provenance (P9)

`packages/db/prisma/seed-ingredients.ts` — 182 entries:

| Basis | Count | `source` |
|---|---|---|
| USDA FoodData Central standard reference | 173 | `USDA FoodData Central` |
| Standard reference estimate | 9 | `standard estimate` |

- `source` is populated on **every** entry (a plain relabel of the
  already-recorded `basis` — no new factual claim).
- `sourceRef`: **0 captured.** Per-100-g values are standard-reference values,
  not per-record extractions; the numeric FoodData Central IDs were never
  captured at generation time. The field exists for future capture and must
  **never** be invented — the real form is `usda-<fdcId>` (see
  `apps/web/lib/usda.ts`), enforced by test.
- `lastReviewedAt`: **0 recorded.** Never backfilled with a guess.
- Tests assert: every ingredient has a basis+source label; `sourceRef`, when
  present, matches `/^usda-\d+$/` (format check, not invented values);
  `lastReviewedAt`, when present, is a real ISO date.

### Known limitations (honest, by design)

- **Cooking transformations are not modeled.** Raw vs cooked (and dry vs
  cooked) are separate catalogue entries; the engine does not model nutrient
  loss/gain during cooking.

#### Engine simplifications that affect every recipe's numbers

These are deliberate simplifications in the computation engine, not
measurements. They are stated here — in the user-visible quality report —
rather than only in code comments, because they systematically move every
recipe's numbers in a known direction:

- **(a) Undocumented cooking transformations.** The engine sums the raw
  ingredient weights named in the recipe. It does **not** model what cooking
  does to the food: water absorbed by rice/pasta/lentils, water lost by
  evaporation, fat absorbed into or drained from the dish, or oil left in the
  pan (a recipe calling for "3 tbsp cooking oil" counts all ~41 g even when
  much of it stays in the karahi). Per-serving values therefore reflect the
  *ingredients as listed*, not the food as cooked and plated.
- **(b) Zero-calorie spice simplifications.** Water, salt, and all spice
  entries are counted as **0 kcal** — a documented simplification, not a
  measurement. Recipe quantities for spices are gram-level ('to taste' → 2 g
  estimate), so their contribution is nutritionally negligible and zeroing
  them keeps recipe totals stable — but it is **not** a claim that spices
  have no calories. Water and salt are genuinely 0.
- **Piece weights are home-kitchen averages** (1 medium onion = 120 g,
  1 egg = 50 g), not measured per recipe.
- **Densities only where documented** (default 1.0 g/ml); tbsp/tsp are flat
  15 g / 5 g conversions.
- **Unresolved ingredients contribute 0** to recipe totals and flag
  `needsReview` — never silently partial.
- **Values are standard-reference values**, not lab-verified values for any
  specific product or brand.
- The v18 food catalogue (`seed-v18-data.ts`) carries its own `basis` labels
  persisted on the Food model; it was out of scope for this worker.

## 6. Engine recompute tests are regression tests, not accuracy proof

The seed tests re-run `computeRecipe()` and assert the stored values match.
This proves the numbers were **never hand-adjusted** — it does **not** prove
the numbers are *accurate*. Accuracy would require an independent check
against authoritative data (that's what the `verified` tier is for, §4).
Do not cite "all recompute tests pass" as evidence that the nutrition data is
correct.

## 7. Files changed (Worker F)

- `packages/db/prisma/recipe-claims-policy.ts` **(new)** — canonical policy:
  `mayClaimHalalFriendly`, `halalPolicyViolations`, `ALLERGEN_CAVEAT`,
  `allergenCaveat`, `VERIFIED_STANDARD_EVIDENCE`, `meetsVerifiedStandard`,
  `qualityTier`. Pure module, no DB.
- `packages/db/prisma/recipe-claims-policy.test.ts` **(new)** — 19 tests:
  policy paths, old-inference-is-dead, caveat, evidence standard, tiers,
  and the seed.ts demotion assertions (seed.ts read as text — it executes on
  import).
- `packages/db/prisma/seed-recipes-pakistani.ts` — 60 `halal-friendly` tags
  removed; header contract rewritten; `halalReview?`/`allergenBasis?` added.
- `packages/db/prisma/seed-recipes-indian-met.ts` — 59 `halal-friendly` tags
  removed; header rewritten; review/provenance fields added.
- `packages/db/prisma/seed-recipes-asian.ts` — claims-policy note + fields
  added (no halal tags existed).
- `packages/db/prisma/seed-recipes-western.ts` — 25 `halal` tags removed;
  claims-policy note + fields added.
- `packages/db/prisma/seed.ts` — 17 `halal` tags removed from the 31 originals;
  `verified: true` → `verified: false` in the RECIPES upsert; review/provenance
  fields added to the local type.
- `packages/db/prisma/seed-ingredients.ts` — `source` populated on all 182
  entries; `sourceRef?`/`lastReviewedAt?` added (all absent, documented as
  never-to-be-invented); provenance contract in the header.
- Tests updated: `seed-ingredients.test.ts` (+3 provenance tests),
  `seed-recipes-pakistani.test.ts` (old inference assertion replaced),
  `seed-recipes-indian-met.test.ts` (mandatory-tag assertion replaced),
  `seed-recipes-western.test.ts` + `seed-recipes-asian.test.ts` (policy blocks
  added).
- `docs/recipe-data-quality.md` **(new)** — this report.

Not touched (per coordination): migrations, `recipe-engine.ts`,
`custom-recipe.ts`, the `[slug]` route, the recipes list page UI, the v18
food catalogue, starter FOODS' `verified` flags.

## 8. Notes for Worker G (docs)

- Publishable counts: **270 recipes, all `calculated-estimate`** (239
  engine-computed batch + 31 hand-authored originals); **0 reviewed**;
  **0 verified**; **92 needsReview** (16 Pakistani, 4 Indian/Middle-Eastern/Turkish,
  40 Asian, 32 Western). Reconciled 2026-10-14: the conflicting "95" was a
  grep artifact (three header-comment prose mentions counted as recipe flags).
  `packages/db/prisma/recipe-quality-report.ts` is the single source of truth;
  `recipe-quality-report.test.ts` asserts the docs' numbers against the live
  seed modules, so they cannot drift again.
- Ingredient DB: **182 entries** — 173 USDA standard-reference basis,
  9 standard-estimate; 0 captured sourceRefs; 0 lastReviewedAt.
- Halal: **0 recipes** carry `halal-friendly`/`halal` (161 inference-granted
  tags removed); the tag now requires a recorded human review.
- Allergens: **all 270 name-derived**; the caveat must be shown wherever
  allergen info appears.
- UI gap (explicitly out of Worker F's scope): the list/detail pages still
  need the three tier badges per the spec in §1 — currently the detail page
  shows "Verified"/"Curated", which after the demotion no longer over-claims
  but does not yet distinguish the three tiers.
  **[v21.3 update — gap closed:** tier badges ("Calculated estimate" /
  "Reviewed" / "Verified") plus the "Awaiting review" marker now render on
  list cards and the detail page; the old v21.2 claim above is superseded.]
- Test command: `cd packages/db && npx vitest run` (348 passed, 4 DB-gated
  skipped — no PostgreSQL on this VM); `npx tsc --noEmit -p tsconfig.json`
  clean.

## 9. Review workflow (v21.3) — how a recipe earns "Reviewed" or "Verified"

**Canonical policy:** `packages/core/src/recipe-claims.ts`
(`ReviewRecord`, `VerificationEvidence`, `meetsReviewedStandard`,
`meetsVerifiedStandard`, `qualityTier`, `VERIFIED_STANDARD_EVIDENCE`).
`packages/db/prisma/recipe-claims-policy.ts` is a re-export shim so existing
seed/test imports don't break — it contains no logic of its own.

### Who can review

Only emails on the **`ADMIN_EMAILS`** env allowlist (comma-separated,
case-insensitive; empty/missing = nobody is admin — fail closed). The
endpoint `POST /api/admin/recipes/[slug]/review` (and the admin-only GET on
the same path) is gated by the existing `requireAdmin` helper in
`apps/web/lib/admin.ts` — the same helper used by the v18 restaurant-menu
correction queue. Anonymous callers get 401, authenticated non-admins get
403, and the admin review panel on the recipe detail page probes the GET and
renders **nothing** for non-admins. There is no self-service path to
reviewed/verified status.

### What evidence counts

**Reviewed** (`ReviewRecord`, every field required):
1. Reviewer identity — **server-set from the session email**, never from
   client input (anti-forgery). The panel prefills it from the GET response.
2. Review date (`reviewedAt`) — ISO date, defaults to today in the panel.
3. Method — one of `independent recomputation` / `label cross-check` /
   `lab analysis` / `other`.
4. Reference — the evidence used (e.g. "USDA SR Legacy #170923", or an
   independent spreadsheet recomputation).
5. `dietaryRechecked` **and** `allergenRechecked` — both must be true:
   dietary claims (tags, diet category) and the allergen list re-checked
   against the ingredient list.

**Verified** (`VerificationEvidence`, every field required) — all of
`VERIFIED_STANDARD_EVIDENCE` (§2): an independent check of the per-serving
nutrition against an authoritative source or an independent recomputation;
`checkedBy` (server-set from the session, expected to be distinct from the
recipe author/generator); `checkedAt` + method; and
`allergenAndDietRechecked = true`. A verification additionally requires a
complete review record: the POST accepts one already stored on the recipe,
or accepts `reviewEvidence` in the same call (saved first, then the
verification) — a documented one-call path, not a shortcut around evidence.

**Clear** removes everything: `verified=false`, both evidence columns set
to NULL. Evidence is destroyed, not hidden.

### What never counts

- **AI-generated and engine-calculated recipes stay "Calculated estimate".**
  All 270 seed recipes ship with NULL evidence columns; the engine
  recomputing the same numbers is a regression check, not a review (§6).
- A bare `verified: true` flag with no evidence tiers as
  `calculated-estimate` — an unevidenced flag is not a stronger claim.
- A partial record (missing reference, unchecked recheck box, unparseable
  date) is rejected with a 400 and field-level errors; the server's
  `meetsReviewedStandard()` / `meetsVerifiedStandard()` gate runs on the
  final object after the session identity is attached.

### Invalidation on content change (v21.4)

**Canonical policy:** `packages/core/src/recipe-governance.ts`
(`MATERIAL_RECIPE_FIELDS`, `invalidationForEdit`, `mayVerifyNutrition`).
A recipe must never stay Verified (or Reviewed) on evidence tied to an
earlier version of its content:

- **Material-change set** — `ingredients` (added/removed/quantity change),
  `portions` / `yieldGrams` (yield — per-serving values are totals divided
  by the yield), `dietCategory`, `tags` (material claims like
  high-protein), `allergens`, and the derived nutrition values themselves
  (material by construction, so a future direct-edit path cannot slip
  through). Metadata-only edits — name/title, prepMin, cookMin,
  difficulty, instructions, imageUrl, videoUrl, mealType, cuisineId — do
  **not** touch evidence.
- **Any material edit lapses the review AND the verification**: PATCH
  `/api/recipes/[slug]` writes `verified=false`,
  `verificationEvidence=NULL`, `reviewEvidence=NULL` inside the SAME single
  `prisma.recipe.update` call, so the recipe is never half-invalidated. The
  review lapses too because the review record certifies dietary/allergen
  rechecks against a specific ingredient list and nutrition values — keeping
  a 'reviewed' tier on content the reviewer never saw would be the same
  overreach the v21.3 evidence badges were built to prevent.
- **New review on a verified recipe resets the verification** (same update,
  evidence destroyed) unless a fresh verification is performed in the same
  explicitly supported workflow: the admin 'verify' action with fresh
  verification evidence, which accepts `reviewEvidence` in the same call.
  The admin panel confirms before a bare 'review' lands on a verified
  recipe.

### Incomplete nutrition can never be verified (v21.4)

Canonical policy (`mayVerifyNutrition`, same module): a recipe with
`needsReview=true` (unresolved ingredients / incomplete nutrition) can
NEVER receive a Verified badge. The admin `verify` action is rejected with
400 `incomplete_nutrition` naming the unresolved ingredients; the flag is
never cleared to bypass the check. Required path: resolve the missing
nutritional values or serving info → recalculate → re-review → then
verify. The admin review GET returns `needsReview`,
`unresolvedIngredients`, and `verificationBlocked`, and the admin panel
renders the block (with the ingredient names) and disables the Verify
button while blocked.

### API contract (evidence shaping)

The server is the tier authority: `GET /api/recipes` and
`GET /api/recipes/[slug]` compute the canonical `tier` from the full stored
evidence and return it in the response. Alongside it, every caller gets
display-safe summaries — `reviewInfo: { reviewer, reviewedAt }` and
`verificationInfo: { checkedBy, checkedAt, method }` (the detail page shows
"Reviewed by X · date" under the badge). Full evidence objects
(`reviewEvidence`, `verificationEvidence`) are returned **to admins only**.
Implementation: `apps/web/lib/recipe-evidence.ts` `shapeRecipeEvidence()`.

## 10. v21.4 — custom-recipe diet/allergen hardening (ITEM 6, 2026-10-15, Worker D)

**Defect confirmed:** POST /api/recipes did
`dietCategory: input.dietCategory ?? 'vegetarian'` — a meat recipe with an
omitted field was labeled vegetarian — and stored `allergens: []` with no
record that screening ever happened (an empty list read as "no allergens").

**What changed.**
- `dietCategory` is **required at creation** (`CustomRecipeSchema` in
  `packages/core/src/validation.ts`): missing/unknown → 400
  `validation_error`. Never defaulted. The PATCH schema keeps it optional
  (absent = leave as-is). The `/recipes/new` UI forces an explicit choice
  (Select starts unselected; Save disabled until chosen).
- New additive, no-backfill migration
  `20261015090000_v214_recipe_allergen_screening`:
  `Recipe.allergenScreened BOOLEAN NOT NULL DEFAULT false` — the
  screening **status** is now recorded separately from the detected
  `allergens` list. All 270 seed recipes stay `allergenScreened = false`
  (no per-row screening record exists; `true` would invent evidence).
- POST /api/recipes runs name-based screening at creation
  (`screenIngredientAllergens()` in the new pure module
  `packages/core/src/recipe-allergen-screening.ts`, exported from
  `@fitfusion/core`) and stores the detected families with
  `allergenScreened: true`. Screening is name-derived only — the
  ALLERGEN_CAVEAT still applies; an empty detected list means
  "nothing detected in the ingredient names", never allergen-free.
- Detail-page allergen copy is screening-aware: declared list → "Declared
  from ingredient names: …"; empty + screened → "None detected from
  ingredient names."; empty + unscreened → "Allergen screening has not been
  performed for this recipe." The "None declared from ingredient names."
  line is gone.
- `dietAllergenRecheckNeeded(prev, next)` (same pure module): true when
  the ingredient name set or dietCategory materially changed; false for
  portions-only/grams-only edits and when there is no previous record
  (creation screens unconditionally). Intended for the PATCH
  material-change path — the PATCH route is another worker's (not verified
  against the final tree here).

**Test-status categories (used verbatim here):** source-implemented ·
mock-tested · DB-tested · browser-tested · real-service-verified ·
blocked-not-run.

**What v21.4 actually ran (executed 2026-10-15 by Worker D):**
- `npx tsc --noEmit`: 0 errors (packages/core, packages/db, apps/web).
- core vitest **320/320** (23 files) — incl. `recipe-allergen-screening.test.ts`
  11/11 (wheat/milk/eggs/peanuts detected; eggplant/coconut not
  false-positived; empty result is "not detected", never a safety promise;
  recheck semantics) and v21.4 `CustomRecipeSchema` cases (missing/unknown
  dietCategory rejected; PATCH keeps it optional).
- `v214-custom-recipe-diet-allergen.test.ts`: **7/7 mock-tested** (400 on
  missing/unknown dietCategory, nothing created; meat recipe stored as
  `non_vegetarian`; wheat+milk+eggs+peanuts detected with
  `allergenScreened: true` persisted; clean recipe → `[]` with
  `screened: true`).
- `v214-allergen-screened-db.test.ts`: 2/2 skipped (blocked-not-run — no
  PostgreSQL on this VM). The migration is source-implemented and the
  schema validates (`prisma validate`); it has not been applied to any
  database by this worker.
- Seed-count truth (executed 2026-10-15, `npx tsx
  packages/db/prisma/recipe-quality-report.ts`): 270 total (239 v21 batch +
  31 hand-authored originals); needsReview total: 92 (16 Pakistani, 4
  Indian/Middle-Eastern/Turkish, 40 Asian, 32 Western); reviewed: 0 |
  verified: 0; ingredients: 182 (USDA standard-reference=173,
  standard-estimate=9; sourceRef=0, lastReviewedAt=0).
- Not run: `next build`, browser tests, real-service verification. Old
  counts quoted elsewhere in this file are historical, not fresh runs.
