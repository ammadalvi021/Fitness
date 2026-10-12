/**
 * DB availability probe for integration tests.
 *
 * The suite runs against a real PostgreSQL. On machines without a reachable
 * database (e.g. this dev VM) the DB-backed suites skip gracefully instead
 * of failing — the skip is reported, and CI (with a database) runs them.
 */
import { prisma } from '@fitfusion/db';

let cached: boolean | null = null;

/** True when a `SELECT 1` succeeds against the configured DATABASE_URL. */
export async function dbAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    await prisma.$queryRaw`SELECT 1`;
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}
