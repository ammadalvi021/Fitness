/**
 * Server-side session auth for FitFusion AI.
 *
 * - Session cookie name: `ff_session` (opaque random token).
 * - Only the sha256 hash of the token is stored (Session.tokenHash).
 * - Uses `req.cookies` / `res.cookies` only (no `next/headers`), so route
 *   handlers stay unit-testable.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import type { Profile, Subscription, User } from '@fitfusion/db';
import { kgFromLb } from '@fitfusion/core';
import { planIncludes } from '../../../config/plans';
import type { PlanId } from '../../../config/plans';
import { subscriptionGrantsPaidAccess } from '@/lib/billing';

export const SESSION_COOKIE = 'ff_session';

/**
 * Profile as exposed in a session. Weight is tracked in `Measurement` rows
 * (onboarding records the initial weight there), so the latest weight is
 * attached here as `weightKg` (converted to kilograms from the measurement's
 * stored unit) for target calculations. It is NOT a Profile table
 * column — never write it back to `prisma.profile`.
 */
export type SessionProfile = Profile & { weightKg?: number | null };

export interface SessionContext {
  user: User;
  profile: SessionProfile | null;
  subscription: Subscription | null;
}

/** sha256 hex digest (used for session + verification token hashes). */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Cryptographically random token (hex). Default 32 bytes -> 64 hex chars. */
export function createToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function sessionTtlDays(): number {
  const n = Number(process.env.SESSION_TTL_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

function baseCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/**
 * Create a session row and return the raw token + cookie options.
 * The raw token is only ever sent to the client; the DB stores its hash.
 */
export async function createSession(
  userId: string,
  opts: { userAgent?: string; ip?: string } = {},
): Promise<{ token: string; cookieOptions: ReturnType<typeof baseCookieOptions> }> {
  const ttlDays = sessionTtlDays();
  const token = createToken(32);
  const now = new Date();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + ttlDays * 24 * 3600 * 1000),
      lastSeenAt: now,
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
    },
  });
  return { token, cookieOptions: baseCookieOptions(ttlDays * 24 * 3600) };
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, baseCookieOptions(sessionTtlDays() * 24 * 3600));
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { ...baseCookieOptions(0), maxAge: 0 });
}

/**
 * Convert a weight Measurement's value to kilograms using its stored `unit`.
 *
 * Supported units (case-insensitive, trimmed):
 *   kg, kgs, kilogram, kilograms  -> returned as-is
 *   lb, lbs, pound, pounds         -> converted via kgFromLb
 *
 * Returns null for any unrecognized unit. The caller must NOT guess — an
 * unknown unit means `weightKg` is simply not attached, and the unit is
 * logged server-side so the bad data stays visible.
 */
function measurementWeightKg(m: { value: number; unit: string }): number | null {
  const unit = (m.unit || '').trim().toLowerCase();
  if (
    unit === 'kg' ||
    unit === 'kgs' ||
    unit === 'kilogram' ||
    unit === 'kilograms'
  ) {
    return m.value;
  }
  if (
    unit === 'lb' ||
    unit === 'lbs' ||
    unit === 'pound' ||
    unit === 'pounds'
  ) {
    return kgFromLb(m.value);
  }
  console.warn(
    `[auth] unrecognized weight unit "${m.unit}" — weightKg not attached`,
  );
  return null;
}

/**
 * Resolve the session user from the `ff_session` cookie.
 * Returns null when there is no cookie, the token is unknown, or the
 * session has expired (expired sessions are deleted). Touches lastSeenAt.
 * A Subscription row is lazily ensured so downstream code can rely on it.
 */
export async function getSessionUser(
  req: NextRequest,
): Promise<SessionContext | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== 'active') return null;
  // Touch lastSeenAt without blocking the request.
  void prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
  });
  // Weight lives in measurements; expose the latest as weightKg (converted
  // to kilograms via its stored unit) so calorie / macro target calculations
  // (which read profile.weightKg) work. Unknown units are never guessed —
  // measurementWeightKg returns null and weightKg is left unset.
  let sessionProfile: SessionProfile | null = profile;
  if (profile) {
    const latestWeight = await prisma.measurement.findFirst({
      where: { userId: user.id, type: 'weight' },
      orderBy: { recordedAt: 'desc' },
    });
    if (latestWeight) {
      const kg = measurementWeightKg({
        value: latestWeight.value,
        unit: latestWeight.unit,
      });
      if (kg !== null) sessionProfile = { ...profile, weightKg: kg };
    }
  }
  const subscription = await prisma.subscription.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, planId: 'free', status: 'active' },
  });
  return { user, profile: sessionProfile, subscription };
}

/**
 * Guard helper. Usage:
 *   const s = await requireUser(req);
 *   if (s instanceof NextResponse) return s;
 */
export async function requireUser(
  req: NextRequest,
): Promise<SessionContext | NextResponse> {
  const s = await getSessionUser(req);
  if (!s) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Authentication required' } },
      { status: 401 },
    );
  }
  return s;
}

/**
 * Plan-gating guard. Returns 403 `{code:'plan_required'}` when the user's
 * plan rank is below the required plan, or when a paid planId is held with
 * an ineligible status (e.g. past-due grace expired) — access-time
 * enforcement so a stale paid row can't grant features between webhooks.
 */
export async function requirePlan(
  req: NextRequest,
  planId: PlanId,
): Promise<SessionContext | NextResponse> {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const current = (s.subscription?.planId ?? 'free') as PlanId;
  if (!planIncludes(current, planId)) {
    return NextResponse.json(
      {
        error: {
          code: 'plan_required',
          message: `This feature requires the "${planId}" plan or higher`,
        },
      },
      { status: 403 },
    );
  }
  if (
    planId !== 'free' &&
    !subscriptionGrantsPaidAccess({
      planId: current,
      status: s.subscription?.status ?? 'active',
      pastDueSince: s.subscription?.pastDueSince ?? null,
    })
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'plan_required',
          message: `This feature requires the "${planId}" plan or higher`,
        },
      },
      { status: 403 },
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// Email-verification / password-reset tokens (stored hashed, single-use)
// ---------------------------------------------------------------------------

export type VerificationTokenType = 'email_verify' | 'password_reset';

function verificationTtlHours(type: VerificationTokenType): number {
  return type === 'email_verify' ? 24 : 1;
}

/** Create a token row; returns the RAW token (send it to the user). */
export async function createVerificationToken(
  userId: string,
  type: VerificationTokenType,
): Promise<string> {
  const token = createToken(32);
  await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      type,
      expiresAt: new Date(Date.now() + verificationTtlHours(type) * 3600 * 1000),
    },
  });
  return token;
}

/**
 * Look up a token and mark it used. Returns the row, or null when the
 * token is unknown, of the wrong type, already used, or expired.
 */
export async function consumeVerificationToken(
  token: string,
  type: VerificationTokenType,
) {
  const row = await prisma.verificationToken.findUnique({
    where: { tokenHash: sha256(token) },
  });
  if (
    !row ||
    row.type !== type ||
    row.usedAt ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }
  await prisma.verificationToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return row;
}
