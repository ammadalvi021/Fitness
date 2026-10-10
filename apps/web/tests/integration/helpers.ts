/**
 * Shared helpers for API integration tests.
 * Route handlers are imported directly and called with real NextRequest
 * objects against the real PostgreSQL database.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';

export function uniqueEmail(prefix = 'ff-test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Attach a session cookie to a request (simulates a logged-in browser). */
export function authed(req: NextRequest, token: string): NextRequest {
  req.cookies.set('ff_session', token);
  return req;
}

export function sessionTokenFrom(res: NextResponse): string {
  const token = res.cookies.get('ff_session')?.value;
  if (!token) throw new Error('expected ff_session cookie in response');
  return token;
}

export async function readJson(res: NextResponse): Promise<any> {
  return res.json();
}

/** Delete the test user (cascades to all child rows). Track per file. */
const createdUserIds = new Set<string>();

export function trackUser(id: string): void {
  createdUserIds.add(id);
}

export async function cleanupUsers(): Promise<void> {
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  createdUserIds.clear();
}

/** Register + login; returns {userId, token}. */
export async function registerAndLogin(
  registerPOST: (req: NextRequest) => Promise<NextResponse>,
  loginPOST: (req: NextRequest) => Promise<NextResponse>,
  email: string,
  password = 'Test1234',
): Promise<{ userId: string; token: string }> {
  const regRes = await registerPOST(
    jsonRequest('http://localhost/api/auth/register', 'POST', {
      email,
      password,
      name: 'Test User',
    }),
  );
  if (regRes.status !== 201) {
    throw new Error(`register failed: ${regRes.status} ${JSON.stringify(await readJson(regRes))}`);
  }
  const regBody = await readJson(regRes);
  trackUser(regBody.user.id);

  const loginRes = await loginPOST(
    jsonRequest('http://localhost/api/auth/login', 'POST', { email, password }),
  );
  if (loginRes.status !== 200) {
    throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(await readJson(loginRes))}`);
  }
  return { userId: regBody.user.id, token: sessionTokenFrom(loginRes) };
}
