# Google Places API (New) — setup guide for Restaurant Discovery

FitFusion's restaurant discovery (`/log/restaurants`) uses the **Google Places API
(New)**. Without a key the feature still works: users see a setup screen and can add
restaurants manually. Nothing is ever invented — with no provider configured, search
returns only manually-added restaurants.

## 1. Enable the API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or
   select) a project.
2. Open **APIs & Services → Library** and enable **Places API (New)**.
   - Enable only "Places API (New)" — the legacy Places API is a different product
     with different billing, and this codebase does not use it.

## 2. Billing

- Places API (New) requires a **billing account** attached to the project.
- Billing is **field-mask driven**: you pay for the fields you request, grouped into
  SKUs (see current pricing on the Google Maps Platform pricing page — it changes).
- This codebase requests only the fields the UI uses, and caches results in the
  `Restaurant` table so repeat views don't re-hit the API:
  - Nearby/Text search: `id, displayName, formattedAddress, location, rating,
    priceLevel, websiteUri, addressComponents` (ID/Basic + Atmosphere fields)
  - Place details: additionally `nationalPhoneNumber, regularOpeningHours`
    (details are a higher SKU — the app calls details at most once per
    restaurant per 24h and serves the DB cache otherwise)
- Cost controls already in the app: debounced search input, max 20 results per
  call, per-user rate limits on the API routes, 24h server-side cache, single
  details call per page view.

## 3. Create and restrict the key

1. **APIs & Services → Credentials → Create Credentials → API key**.
2. **Restrict the key twice** (defense in depth):
   - **API restrictions**: restrict to **Places API (New)** only.
   - **Application restrictions**: this key is used **server-side only** (never
     shipped to the browser — there is no `NEXT_PUBLIC_*` variable for it), so
     use **IP restrictions** limited to your server's egress IPs. Do not use HTTP
     referrer restrictions for a server-side key.
3. Rotate the key immediately if it is ever exposed client-side or committed.

## 4. Configure the app

Set the environment variable on the server (never in client code):

```bash
GOOGLE_PLACES_API_KEY=AIza...your-key...
```

- Local dev: add it to the repo-root `.env` (never commit this file).
- The adapter reads it via `process.env.GOOGLE_PLACES_API_KEY` **only**
  (`apps/web/lib/places/google.ts`); responses never contain the key.

## 5. Deploy on Render

1. In the Render dashboard, open the `fitfusion-ai` web service → **Environment**.
2. Add `GOOGLE_PLACES_API_KEY` with the restricted key value.
3. Save — Render redeploys automatically (or trigger a manual deploy).
4. Verify: sign in, open `/log/restaurants`, tap "Use my location" — real results
   should appear and the setup banner should be gone.
5. Optional but recommended: set IP restrictions on the key to Render's outbound
   IPs (see Render docs for current egress IP ranges; they can change, so prefer
   the API-restriction lock plus a modest Places quota cap in Cloud Console).

## 6. Quotas & monitoring

- Set a daily quota cap for Places API (New) in **APIs & Services → Quotas** as a
  spend backstop.
- Watch usage in **APIs & Services → Dashboard** after launch; the app's 24h
  cache + rate limits keep steady-state traffic low.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Setup screen still shows after setting the key | Env var not picked up — redeploy / restart; check the exact name `GOOGLE_PLACES_API_KEY` |
| 502 `provider_error` from `/api/restaurants/nearby` | Key invalid, API not enabled, billing not attached, or IP restriction blocking the server |
| Empty results with no error | Nothing matched within the radius — widen the radius or try a text search |
| `REQUEST_DENIED` in server logs | API restriction doesn't include Places API (New), or the key is wrong |

## 8. Honesty rules this feature follows

- No provider → setup screen + manual entry. Never fake results.
- Geolocation only after an explicit tap; denial falls back to manual city entry.
- Coordinates are used in-memory for the search and are never written to the
  user's profile.
- The key is server-side only; API responses are scanned in tests to prove the
  key never leaks.
