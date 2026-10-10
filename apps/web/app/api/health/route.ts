/**
 * FitFusion AI health endpoint.
 *
 * PUBLIC CONTRACT: the response body is safe to expose to anyone — it
 * contains only booleans, latency numbers, variable NAMES (never values),
 * and a generic failure hint. Detailed diagnostics (error messages, stacks,
 * env validation text) go ONLY to the server logs, never into the response.
 */
import { apiOk } from '@/lib/server-api';
import { prisma } from '@fitfusion/db';
import { checkEnv } from '../../../../../scripts/check-env.mjs';

export const dynamic = 'force-dynamic';

interface DatabaseCheck {
  ok: boolean;
  latencyMs: number | null;
}

/** Cheap liveness query. Never throws — reports ok:false when the DB is down. */
async function checkDatabase(): Promise<DatabaseCheck> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

/**
 * Migrations check: the `_prisma_migrations` table only exists after
 * `prisma migrate deploy` has run at least once. Never throws.
 */
async function checkMigrations(): Promise<{ ok: boolean }> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "_prisma_migrations" LIMIT 1`;
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

const FAILURE_HINT =
  'One or more health checks failed. ' +
  'If env vars are missing, provide them either in the repo-root .env ' +
  '(copied from .env.example — there is no apps/web/.env, do not create one) ' +
  'or as platform-provided environment variables. ' +
  'If the database check failed, make sure PostgreSQL is running and DATABASE_URL is correct. ' +
  'If the migrations check failed, run from the repo root: npx prisma migrate deploy ' +
  '--schema packages/db/prisma/schema.prisma.';

export async function GET() {
  const time = new Date().toISOString();
  const version = process.env.npm_package_version || undefined;
  try {
    // Names only, never secret values.
    const env = checkEnv();
    if (env.errors.length > 0) {
      // Detailed diagnostics stay in the server logs — the public response
      // below carries only the generic hint.
      console.error('[health] env validation failed:', env.errors);
    }
    const [database, migrations] = await Promise.all([
      checkDatabase(),
      checkMigrations(),
    ]);
    const checks = {
      database,
      env: { ok: env.errors.length === 0, missingVars: env.missingVars },
      migrations,
    };
    const ok = database.ok && migrations.ok && checks.env.ok;
    return apiOk(
      {
        ok,
        time,
        ...(version ? { version } : {}),
        checks,
        ...(ok ? {} : { message: FAILURE_HINT }),
      },
      ok ? 200 : 503,
    );
  } catch (err) {
    // Absolute last resort: log the full error server-side, but return a
    // GENERIC message publicly — never a stack or an error message, which
    // can contain connection strings or other sensitive detail.
    console.error('[health] unexpected failure:', err);
    return apiOk(
      {
        ok: false,
        time,
        ...(version ? { version } : {}),
        checks: {
          database: { ok: false, latencyMs: null },
          env: { ok: false, missingVars: [] as string[] },
          migrations: { ok: false },
        },
        message: `Health check failed unexpectedly. ${FAILURE_HINT}`,
      },
      503,
    );
  }
}
