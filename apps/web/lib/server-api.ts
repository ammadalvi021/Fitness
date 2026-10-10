/**
 * Server-side helpers for API routes: JSON responses, error envelopes,
 * zod messages, safe JSON body parsing, and public user projection.
 * (Client-side fetch helpers live in lib/api.ts — do not merge.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: string };
}

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: string,
): NextResponse {
  const body: ApiErrorBody = { error: { code, message } };
  if (details) body.error.details = details;
  return NextResponse.json(body, { status });
}

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function zodMessage(e: z.ZodError): string {
  return e.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}

export async function readJson(
  req: NextRequest,
): Promise<{ ok: true; data: unknown } | { ok: false; res: NextResponse }> {
  try {
    const data = await req.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      res: apiError('invalid_json', 'Request body must be valid JSON', 400),
    };
  }
}

/** Strip secrets before returning a user over the API. */
export function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  emailVerifiedAt: Date | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt,
    status: user.status,
    createdAt: user.createdAt,
  };
}

export function clientIp(req: NextRequest): string | undefined {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    undefined
  );
}

/** Parse a YYYY-MM-DD value into a UTC-midnight Date (null when invalid). */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as YYYY-MM-DD (UTC). */
export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC) of the week containing `d`. */
export function startOfWeekMonday(d: Date): Date {
  const base = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dow = base.getUTCDay(); // 0=Sun
  const delta = (dow + 6) % 7; // days since Monday
  return new Date(base.getTime() - delta * 24 * 3600 * 1000);
}

export function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  // Query params arrive as string|null; Number(null) and Number('') are both
  // 0 (finite), so treat missing/blank as "use the fallback" explicitly.
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
