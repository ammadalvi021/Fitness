/**
 * Admin gate for back-office routes (menu management, correction queue).
 *
 * Simple email allowlist via the `ADMIN_EMAILS` env var (comma-separated,
 * case-insensitive). An empty/missing list means NO ONE is an admin —
 * fail closed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type SessionContext } from '@/lib/auth';
import { apiError } from '@/lib/server-api';

/** Parse ADMIN_EMAILS into a normalized set of lower-cased emails. */
export function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

/** True when the session user's email is on the ADMIN_EMAILS allowlist. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}

/** True when the session belongs to an admin user. */
export function isAdmin(s: SessionContext): boolean {
  return isAdminEmail(s.user.email);
}

/**
 * Like requireUser but also enforces the admin allowlist.
 * Returns the session on success, or a NextResponse (401/403) to return early.
 */
export async function requireAdmin(
  req: NextRequest,
): Promise<SessionContext | NextResponse> {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  if (!isAdmin(s)) {
    return apiError('forbidden', 'Admin access required', 403);
  }
  return s;
}
