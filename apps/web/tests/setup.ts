/**
 * Integration-test setup: runs before every test file.
 * - SESSION_SECRET=test (server auth code reads it defensively)
 * - DATABASE_URL must come from the environment (real PostgreSQL)
 * - AI_* vars are NEUTRALIZED by pre-seeding them as EMPTY STRINGS.
 *
 * Why empty strings and not `delete` (root cause, verified 2026-10-09):
 * `@fitfusion/db` (the Prisma client) self-loads the repo-root `.env`
 * through its bundled dotenv at import time, which INJECTS the real
 * AI_API_KEY / AI_MODEL / ... into `process.env` — after this setup file
 * has already run. Deleting the vars here loses a race it can never win.
 * dotenv never overwrites a variable that is already set, so pre-seeding
 * AI_* as '' blocks the self-load from filling in the real secrets no
 * matter when `@fitfusion/db` is first imported. `readAIConfig()` maps ''
 * to null, so every AI integration path deterministically sees
 * `not_configured` / aiConfigured:false and never touches the network.
 * Tests must NOT depend on real keys.
 */
process.env.SESSION_SECRET = 'test';

// Block Prisma's dotenv self-load: pre-seed every AI_* var as '' BEFORE any
// import of @fitfusion/db can run. Also scrub any AI_* already present
// (e.g. exported by the runner) down to ''.
for (const key of Object.keys(process.env)) {
  if (key === 'AI_API_KEY' || key.startsWith('AI_')) {
    process.env[key] = '';
  }
}
for (const key of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_VISION_MODEL']) {
  process.env[key] = '';
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set in the environment to run integration tests',
  );
}
