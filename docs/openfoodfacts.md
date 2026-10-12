# Open Food Facts — terms, licence & compliance (FitFusion AI V18)

## What was read

- The official Terms of use page (`https://world.openfoodfacts.org/terms-of-use`)
  could not be fetched directly from this environment (the fetch was denied
  with an upstream 403 on 2026-10-12). Instead we relied on:
  - Open Food Facts forum, "Conditions to use the Open Food Facts API"
    (`forum.openfoodfacts.org/t/conditions-to-use-the-open-food-facts-api/443`),
    which summarises the API rules.
  - The OFF wiki FAQ and API/Read/Search docs (`wiki.openfoodfacts.org`),
    including the User-Agent requirement.
  - The Open Food Facts Wikipedia entry, which documents the licence stack.
- Read dates: 2026-10-12.

## Licence facts

| Asset | Licence | Our obligation |
|---|---|---|
| Database (nutrition values, names, ingredients, allergens) | **Open Database License (ODbL)** | Attribution + share-alike when redistributing combined data. We do not bulk-export or redistribute the database; we show single lookups with attribution. |
| Product pictures | **Creative Commons Attribution-ShareAlike 3.0** | Attribute each displayed image to "© Open Food Facts contributors". We hotlink OFF's own image URLs (`image_front_small_url` etc.) — the standard reuse pattern — and show the attribution as the image caption. |

## API usage rules we implemented

1. **Custom User-Agent** — every request sends
   `FitFusionAI/1.0 (contact: support@fitfusion.ai; +https://fitfusion.ai)`,
   identifying the app, a contact, and a URL. See `OFF_USER_AGENT` in
   `apps/web/lib/openfoodfacts.ts`.
2. **Rate limits respected** — we fetch per barcode on demand only, never
   poll. A 12-second timeout aborts stuck requests, and HTTP 404/status-0
   responses are handled honestly (never retried in a loop).
3. **Attribution in the UI** — every product detail screen shows
   "Source: Open Food Facts (crowdsourced)" and "© Open Food Facts
   contributors" near the data and under each product photo.

## Short-lived operational cache (`CachedProduct`)

- **TTL: 7 days.** A barcode lookup is re-fetched when the cached row is
  older than 7 days (`OFF_CACHE_TTL_MS`, enforced by `cacheIsFresh`).
- This is operational caching to reduce load on OFF's servers, not an
  attempt to mirror or redistribute the database.
- Each cached row stores the raw product payload with `provider:
  'openfoodfacts'`; attribution travels with every display.

## Honesty rules (binding)

- OFF data is **crowdsourced third-party data**. Nothing saved from OFF is
  ever marked `verification: 'verified'` — it is always `verification:
  'estimate'` with basis
  "Open Food Facts — crowdsourced third-party data, not manufacturer-verified".
- **Never fabricate nutrition.** When OFF has no per-serving or per-100g
  numbers, the product shows "no nutrition data" and the save API refuses
  with `no_nutrition_data` (HTTP 422) rather than inventing values.
- **Never claim success when not found.** 404/status-0 responses return
  `{ found: false, message: 'No product found for this barcode.' }` and the
  UI offers a manual label-entry fallback instead.
- Per-serving values derived from per-100g × serving size are flagged
  (`derivedPerServing`) and disclosed in the UI.
- Nutri-Score / Eco-Score grades are shown as informational labels only —
  no health claims are made.

## What this phase deliberately does NOT do

- No bulk download or redistribution of the OFF database (stays outside
  ODbL share-alike obligations).
- No API key required — OFF needs none.
