/**
 * FitFusion AI — Next.js config.
 *
 * EXPLICIT ENV LOADING (single source of truth):
 * The repo-root `.env` (copied from `.env.example`) is the ONE AND ONLY env
 * file — there is no `apps/web/.env`, do not create one.
 *
 * Next.js 14 loads `.env*` files from the app directory (apps/web) only, so
 * without this block the root `.env` would never be loaded by Next itself.
 * (Next 14 has no `envDir` option.) Previously `DATABASE_URL` only worked
 * because `@prisma/client`'s bundled runtime happened to self-load the root
 * `.env` — but that behavior proved unreliable across regenerations, so we no
 * longer depend on it.
 *
 * This block loads `<repo-root>/.env` deterministically on every
 * `next dev` / `next build` / `next start`, before anything else reads
 * `process.env`. `dotenv.config()` only fills variables that are NOT already
 * set, so a real environment (CI, Docker, PowerShell session) always wins.
 * If the file is missing, this is a silent no-op and the fail-fast in
 * `scripts/check-env.mjs` (surfaced via `/api/health`) reports it clearly.
 */
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PWA service worker is registered from /sw.js (public/). Keep it out of the
  // build output hashing so updates are cache-busted via ?v= query if needed.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

module.exports = nextConfig;
