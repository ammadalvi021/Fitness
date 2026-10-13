# Google Fit sync — setup guide (V20 Feature 6)

FitFusion can import **daily step counts** and **body weight** from Google Fit
into your existing records (weight → `Measurement` type `weight`, steps → type
`steps`). Without configuration the feature stays honest: Settings → Health
sync shows "not connected" / "not configured", the dashboard shows no steps
card, and no data is ever invented.

Apple HealthKit is **not** available in this web app — see §7.

## 1. Create a Google Cloud project and enable the Fitness API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create
   (or select) a project.
2. Open **APIs & Services → Library** and enable **Fitness API**.
   - The Fitness API itself has no per-call billing; the OAuth consent screen
     below is the part that matters for verification status.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**, fill in app name / contact email.
   - Add the two scopes the app requests (non-sensitive "read" scopes):
     - `https://www.googleapis.com/auth/fitness.activity.read`
     - `https://www.googleapis.com/auth/fitness.body.read`
   - While the app is in **Testing** publishing status, add your Google account
     under **Test users** — only test users can complete the flow until the
     app is published/verified. Publishing status and verification are Google's
     process; the app works identically in Testing mode for your own account.

## 2. Create the OAuth client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   application type **Web application**.
2. Under **Authorized redirect URIs** add BOTH:
   - `http://localhost:3000/api/health/google/callback` (local dev)
   - `https://<your-render-domain>/api/health/google/callback` (production —
     replace with your real Render URL, e.g.
     `https://fitfusion-ai-ih12.onrender.com/api/health/google/callback`)
3. Copy the **Client ID** and **Client secret**.

You may reuse the same OAuth client already used for Google sign-in — just add
the extra redirect URI above. The Fitness scopes are requested only in the
separate Health-sync flow (`/api/health/google/connect`), never during sign-in.

## 3. Configure the app

Set these server-side (never in client code, never `NEXT_PUBLIC_*`):

```bash
GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="..."
# 64 hex chars (32 bytes). Generates the AES-256-GCM key that encrypts
# OAuth tokens at rest. Generate once and keep it stable — rotating it
# invalidates already-stored tokens (users just reconnect).
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
HEALTH_SYNC_SECRET="..."
```

- Local dev: add them to the repo-root `.env` (never commit this file).
- `APP_URL` must be the public base URL (`http://localhost:3000` locally, the
  Render URL in production) — it builds the OAuth redirect URI.

## 4. Deploy on Render

1. Render dashboard → the `fitfusion-ai` web service → **Environment**.
2. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `HEALTH_SYNC_SECRET`.
3. Confirm `APP_URL` is the public Render URL.
4. Save — Render redeploys automatically.
5. Verify: sign in, open **Settings → Health sync**, tap **Connect Google Fit**,
   approve in Google, then **Sync now** — the last-sync time and (if Google has
   data) today's steps appear. The dashboard shows a "Steps today" card only
   when synced steps exist.

## 5. How sync works (and its limits)

- **Manual "Sync now"** (`POST /api/health/google/sync`) is the only trigger.
- The access token is refreshed automatically when expired; without a refresh
  token the user is asked to reconnect (HTTP 409 `needs_reconnect`).
- Steps: last 7 days, one `Measurement` row per day, upserted (re-syncs never
  duplicate). Weight: the latest Google Fit reading in the last 30 days,
  imported once (skipped if already present).
- Tokens are encrypted with AES-256-GCM before touching the database
  (`HealthConnection` table) and are never returned by any API.
- Disconnecting (`DELETE /api/health/google/disconnect`) destroys the tokens;
  already-imported measurements remain — they are the user's own data.

## 6. Automatic daily sync (not built in-app)

The app has no in-process scheduler by design. For a hands-free daily sync,
add an external cron that calls the endpoint with the user's session:

```bash
# Example: cron on a trusted host, once daily
curl -s -X POST https://<your-domain>/api/health/google/sync \
  -H "Cookie: ff_session=<user-session-token>" >/dev/null
```

Notes:
- `ff_session` is an httpOnly login cookie; capture it from a logged-in
  browser session and store it as a secret on the cron host. If the session
  expires, the cron gets 401 and that day is skipped — the next manual "Sync
  now" catches up (7-day step window).
- Google-side quotas for the Fitness API are generous for personal use; keep
  it to once or twice a day per user.
- Alternative without secrets on the cron host: a tiny authenticated proxy
  that holds the session server-side. Either way, keep the token off logs.

## 7. Apple HealthKit — why it's not here

**Apple HealthKit is not accessible from a web PWA, full stop.** HealthKit
(`HKHealthStore`) is an iOS/macOS-only native framework: it requires an app
built with Xcode, the HealthKit entitlement, and on-device user permission.
Safari and installed web apps (PWA) expose no step-count, heart-rate, or
workout APIs — there is no web standard for it, and no OAuth-style workaround
exists (Apple offers no "HealthKit REST API" for third parties).

So this feature deliberately does **not** include Apple Health: no stub, no
fake connector, no "coming soon" toggle that implies it works. If a native
iOS app is built later, that's the place to add it — the `HealthConnection`
table already has a `provider` column (`"google"` today, `"apple"` later) and
steps/weight already land in the shared `Measurement` table, so a native
client can reuse the same import path.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Settings shows "not configured" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `HEALTH_SYNC_SECRET` missing (server logs name which) |
| Google shows `redirect_uri_mismatch` | The exact callback URL isn't in the OAuth client's authorized redirect URIs (§2) — scheme, host, and path must match |
| `Error 403: access_denied` after consent | App in Testing publishing status and the Google account isn't a Test user (§1) |
| Sync says "please reconnect" | Refresh token lost (e.g. `HEALTH_SYNC_SECRET` rotated, or Google revoked access) — Disconnect, then Connect again |
| Sync returns `empty: true` | Google has no step/weight data for the account in the window — honest, nothing imported |
