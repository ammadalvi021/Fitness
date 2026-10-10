/**
 * check-env.mjs — FitFusion AI environment validation helper.
 *
 * TWO supported configuration modes:
 *   1. Local dev: the `.env` file at the REPO ROOT (copied from
 *      `.env.example`). This remains the documented local-dev file.
 *   2. Hosted/CI deployments: correctly configured platform-provided
 *      environment variables (Vercel/Render/Fly dashboard, CI secrets,
 *      systemd, Docker env). A physical `.env` file is NOT required when
 *      every required variable is already present in `process.env`.
 *
 * This script only READS files and reports problems. It never writes files
 * and never mutates `process.env`, so running or importing it cannot change
 * app behavior.
 *
 * How env loading works (explicit design, verified 2026-10-09):
 * - `apps/web/next.config.js` explicitly loads `<repo-root>/.env` via
 *   `dotenv` at startup — before anything reads `process.env`. Next.js 14
 *   has no `envDir` option and would otherwise only look in `apps/web/`.
 * - `dotenv.config()` only fills variables NOT already set, so a real
 *   environment (CI, Docker, your shell) always wins over the file.
 * - Do NOT rely on `@prisma/client`'s bundled self-load of the root `.env`:
 *   it exists but proved unreliable across `prisma generate` runs. It is
 *   harmless (fill-missing only) but it is not the mechanism we depend on.
 * - Prisma CLI commands (migrate) must run from the repo root with an
 *   explicit `--schema`, e.g.:
 *     npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
 *   `npm run db:migrate` (repo root) is the supported shortcut — it runs
 *   exactly that command from the root, so the CLI loads the root `.env`
 *   itself. (The nested `npm run db:migrate --workspace @fitfusion/db` form
 *   executes inside `packages/db`, where no `.env` exists, and fails from a
 *   clean shell.)
 *
 * Usage:
 *   node scripts/check-env.mjs            # from the repo root; exits 0 on OK, 1 on error
 *   import { checkEnv } from './scripts/check-env.mjs';
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Vars the app requires to be present (in the root .env file or the environment). */
export const REQUIRED_VARS = ['DATABASE_URL', 'SESSION_SECRET'];

/**
 * Secret values that are obviously placeholders. Using one in production
 * is rejected (hard error); in non-production it is a warning.
 * Compared case-insensitively after trimming.
 */
const PLACEHOLDER_SECRETS = new Set(
  [
    // The value shipped in .env.example — using it verbatim is a mistake.
    'change-me-to-a-long-random-string-min-32-chars',
    'changeme',
    'change-me',
    'change_me',
    'your-secret-here',
    'your-session-secret',
    'replace-me',
    'replace-me-with-a-random-string',
    'secret',
    'password',
    'placeholder',
    'example',
    'test',
    'test-secret',
    'dev-secret',
    '123456',
    '12345678',
    '00000000',
  ].map((s) => s.toLowerCase()),
);

/**
 * Env files that must NOT exist under apps/web. Next.js would load them at
 * startup (its env dir is apps/web), while Prisma self-loads the root .env —
 * two competing sources of truth with confusing precedence. Keep exactly one.
 */
const FORBIDDEN_APP_ENV_FILES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
];

/**
 * Minimal `.env` parser: `KEY=value`, strips surrounding quotes, skips blank
 * lines and `#` comments. Good enough for validation (not a general parser).
 */
export function parseEnvFile(path) {
  const vars = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    if (key) vars[key] = val;
  }
  return vars;
}

/**
 * Locate the repo root by walking up from `startDir` until a directory
 * containing `.env` or `.env.example` is found. Falls back to the parent of
 * the start dir (covers `apps/web` -> repo root).
 */
export function findRepoRoot(startDir = process.cwd()) {
  let dir = resolve(startDir);
  for (let i = 0; i < 5; i++) {
    if (
      existsSync(join(dir, '.env')) ||
      existsSync(join(dir, '.env.example'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir, '..');
}

/** True when the value looks like an obvious placeholder secret. */
export function isPlaceholderSecret(value) {
  return PLACEHOLDER_SECRETS.has(String(value || '').trim().toLowerCase());
}

function isProduction() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * Validate the environment. A required var counts as present when it is
 * non-empty in `process.env` OR in the root `.env` file — so a hosted
 * deployment with platform-provided variables needs no physical `.env` file.
 * Returns names only — never secret values.
 */
export function checkEnv(rootDir) {
  const root = rootDir ? resolve(rootDir) : findRepoRoot();
  const envPath = join(root, '.env');
  const production = isProduction();
  const errors = [];
  const warnings = [];

  // 1. No per-app env files — they would shadow the single root .env.
  for (const name of FORBIDDEN_APP_ENV_FILES) {
    const p = join(root, 'apps', 'web', name);
    if (existsSync(p)) {
      errors.push(
        `Found ${p} — delete it. The repo-root .env is the ONLY env file; ` +
          `a per-app env file competes with it and causes confusing behavior.`,
      );
    }
  }

  // 2. Read the root .env when it exists. It is the documented local-dev
  //    file, but it is NOT mandatory: platform-provided environment
  //    variables (hosted/CI) are equally accepted.
  const envFileExists = existsSync(envPath);
  let fileVars = {};
  if (envFileExists) {
    try {
      fileVars = parseEnvFile(envPath);
    } catch (e) {
      errors.push(`Could not read ${envPath}: ${e.message}`);
    }
  }

  const valueOf = (name) =>
    (process.env[name] || '').trim() || (fileVars[name] || '').trim();

  // 3. Required vars present in the process environment or the file.
  const missingVars = [];
  for (const name of REQUIRED_VARS) {
    if (!valueOf(name)) missingVars.push(name);
  }
  if (missingVars.length > 0) {
    const where = envFileExists
      ? `in the environment or in ${envPath}`
      : `in the environment (no ${envPath} file found — for local dev, copy ` +
        `.env.example to .env at the repo root; see docs/WINDOWS_SETUP.md)`;
    errors.push(
      `Missing required env var(s): ${missingVars.join(', ')} — set them ` +
        `${where}. Without DATABASE_URL the app cannot reach PostgreSQL ` +
        `and Prisma fails with a cryptic error.`,
    );
  }

  // 4. Placeholder secrets: rejected in production, warned otherwise.
  //    Never prints the value — only the variable name.
  const secret = valueOf('SESSION_SECRET');
  if (secret && isPlaceholderSecret(secret)) {
    const msg =
      'SESSION_SECRET has an obvious placeholder value — replace it with a ' +
      'long random string before this deployment goes live.';
    if (production) {
      errors.push(
        `Refusing to run with NODE_ENV=production: ${msg} ` +
          `Placeholder secrets are rejected in production.`,
      );
    } else {
      warnings.push(msg);
    }
  }

  // 5. Stripe sanity (warning only — billing.ts enforces the real rule at
  //    runtime and the app degrades honestly when Stripe is unconfigured).
  const provider = (valueOf('BILLING_PROVIDER') || 'none').toLowerCase();
  if (provider === 'stripe') {
    const stripeVars = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_DIET',
      'STRIPE_PRICE_DIET_EXERCISE',
    ];
    const missingStripe = stripeVars.filter((name) => !valueOf(name));
    if (missingStripe.length > 0) {
      warnings.push(
        `BILLING_PROVIDER=stripe but Stripe var(s) missing: ` +
          `${missingStripe.join(', ')} — all four are required; until they ` +
          `are set, paid checkouts refuse with 503 (see README "Billing").`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    root,
    envPath,
    envFileExists,
    missingVars,
    errors,
    warnings,
  };
}

// --- CLI: `node scripts/check-env.mjs` ---------------------------------------
let isMain = false;
try {
  isMain =
    !!process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url);
} catch {
  isMain = false;
}

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const result = checkEnv(join(here, '..'));
  if (result.ok) {
    const source = result.envFileExists
      ? `using ${result.envPath}`
      : 'using platform-provided environment variables (no .env file)';
    console.log(`env OK — ${source}`);
    for (const w of result.warnings) console.log(`warning: ${w}`);
    process.exit(0);
  }
  for (const e of result.errors) console.error(`error: ${e}`);
  for (const w of result.warnings) console.error(`warning: ${w}`);
  process.exit(1);
}
