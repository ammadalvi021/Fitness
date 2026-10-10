# Deploying FitFusion AI on Render

Takes about 15 minutes. You need a GitHub account and a Render account (both free).

## 0. Put the code on GitHub (Render cannot deploy a zip)

```bash
cd fitfusion-ai
git init
git add -A
git commit -m "FitFusion AI"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/fitfusion-ai.git
git push -u origin main
```

## 1. Create from the Blueprint

Render dashboard → **New** → **Blueprint** → select the `fitfusion-ai` repo.
Render reads `render.yaml` and creates two things: the **Web Service**
(`fitfusion-ai`) and the **PostgreSQL 16** database (`fitfusion-db`), already
wired together via `DATABASE_URL`. Click **Apply**.

What the Blueprint does for you:
- `npm install`, Prisma client generation, `prisma migrate deploy`
  (all 4 migrations), and `next build`.
- Starts with `next start` (production) and health-checks `/api/health`.
- Generates a random `SESSION_SECRET` (production rejects placeholder
  secrets, so this matters).
- Leaves billing safely off (`BILLING_PROVIDER=none`).

## 2. Set APP_URL after the first deploy

Once the service is live (e.g. `https://fitfusion-ai.onrender.com`):
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
  `{APP_URL}/api/billing/webhook` in the Stripe dashboard.
- **Demo data**: the seed (`npm run db:seed`) is intentionally *not* run by
  the Blueprint. To add the demo foods/recipes/exercises once, open the
  web service → **Shell** and run `npm run db:seed --workspace @fitfusion/db`.

## Notes and limits

- The free tier **sleeps after inactivity** — the first request after idle
  takes ~30–60s to wake. Fine for testing; upgrade the service (and database)
  plans when it matters.
- `STORAGE_DRIVER=local` keeps food-scan uploads on the service's ephemeral
  disk — they disappear on redeploy. Switch to the `s3` driver with a bucket
  for anything permanent.
- `EMAIL_DRIVER=console` logs emails to the service logs. Configure SMTP for
  real verification/password-reset emails.
