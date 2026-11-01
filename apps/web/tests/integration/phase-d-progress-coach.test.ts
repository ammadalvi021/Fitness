/**
 * Phase D: progress extension + coach context (guided workouts).
 * DB-backed — skipped gracefully when no PostgreSQL is reachable.
 * Route handlers are imported directly and called with real requests
 * against the real database, following existing integration patterns.
 *
 * Seeded sessions (startedAt = now, for a fresh user):
 *  - strength completed (durationSeconds null, caloriesEstimateKcal null)
 *  - yoga completed (1800s, 150 kcal)
 *  - aerobics completed (1200s, caloriesEstimateKcal null)
 *  - yoga in_progress (3600s, 999 kcal — excluded from completed totals)
 *
 * Expected completed totals: activeMinutes 50 (1800+1200s), kcal 150.
 * Guided counts in the coach sentence count guided sessions of ANY
 * status (2 yoga incl. the in-progress one, 1 aerobics), while guided
 * minutes/kcal count COMPLETED guided sessions only (50 min, ~150 kcal).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as progressGET } from '@/app/api/progress/route';
import { buildCoachContext } from '@/lib/coach-context';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  trackUser,
  uniqueEmail,
} from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

async function seedUser() {
  const { userId, token } = await registerAndLogin(
    registerPOST,
    loginPOST,
    uniqueEmail('ff-phase-d'),
  );
  const now = new Date();
  const sessions = [
    { kind: 'strength', status: 'completed', durationSeconds: null, caloriesEstimateKcal: null },
    { kind: 'yoga', status: 'completed', durationSeconds: 1800, caloriesEstimateKcal: 150 },
    { kind: 'aerobics', status: 'completed', durationSeconds: 1200, caloriesEstimateKcal: null },
    { kind: 'yoga', status: 'in_progress', durationSeconds: 3600, caloriesEstimateKcal: 999 },
  ] as const;
  for (const s of sessions) {
    await prisma.workoutSession.create({
      data: {
        userId,
        name: `${s.kind} session`,
        kind: s.kind,
        status: s.status,
        startedAt: now,
        durationSeconds: s.durationSeconds,
        caloriesEstimateKcal: s.caloriesEstimateKcal,
      },
    });
  }
  await prisma.measurement.create({
    data: { userId, type: 'weight', value: 80, unit: 'kg', recordedAt: now },
  });
  const profile = await prisma.profile.upsert({
    where: { userId },
    update: { workoutTypes: ['yoga', 'aerobics'] },
    create: { userId, workoutTypes: ['yoga', 'aerobics'] },
  });
  return { userId, token, now, profile };
}

describe.skipIf(!HAS_DB)('phase D progress + coach context (scratch DB)', () => {
  afterAll(async () => {
    await cleanupUsers();
  });

  it('GET /api/progress exposes additive active-minutes / calories / byKind totals', async () => {
    const { token, now } = await seedUser();
    const res = await progressGET(
      authed(jsonRequest('http://localhost/api/progress?days=30', 'GET'), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);

    // Pre-existing fields stay present and well-formed.
    expect(body.days).toBe(30);
    expect(Array.isArray(body.weights)).toBe(true);
    expect(body.weights.length).toBe(1);
    expect(body.weights[0].value).toBe(80);
    expect(Array.isArray(body.nutritionByDay)).toBe(true);
    expect(Array.isArray(body.waterByDay)).toBe(true);

    // Additive workouts fields (completed-only minutes/calories).
    expect(body.workouts.total).toBe(4);
    expect(body.workouts.completed).toBe(3);
    expect(body.workouts.activeMinutes).toBe(50);
    expect(body.workouts.estimatedCaloriesKcal).toBe(150);
    expect(body.workouts.byKind.yoga).toEqual({
      sessions: 2,
      completed: 1,
      activeMinutes: 30,
      estimatedCaloriesKcal: 150,
    });
    expect(body.workouts.byKind.aerobics).toEqual({
      sessions: 1,
      completed: 1,
      activeMinutes: 20,
      estimatedCaloriesKcal: 0,
    });
    expect(body.workouts.byKind.strength).toEqual({
      sessions: 1,
      completed: 1,
      activeMinutes: 0,
      estimatedCaloriesKcal: 0,
    });

    const today = now.toISOString().slice(0, 10);
    const todayEntry = (body.workouts.byDay as Array<Record<string, unknown>>).find(
      (d) => d.date === today,
    );
    expect(todayEntry).toBeDefined();
    expect(todayEntry!.count).toBe(4);
    expect(todayEntry!.activeMinutes).toBe(50);
  });

  it('coach context includes workout types and the guided summary (completed-only minutes/kcal)', async () => {
    const { userId, profile } = await seedUser();
    const ctx = await buildCoachContext(userId, profile);
    expect(ctx).toContain('workout types: yoga, aerobics');
    expect(ctx).toContain('Workouts in the last 7 days: 4.');
    // Guided counts are any-status (2 yoga incl. in-progress, 1 aerobics);
    // minutes/kcal are completed-only (1800+1200s = 50 min, 150 kcal —
    // the in-progress 3600s / 999 kcal are excluded).
    expect(ctx).toContain('Guided workouts in the last 7 days: 2 yoga, 1 aerobics');
    expect(ctx).toContain('50 active minutes');
    expect(ctx).toContain('~150 estimated kcal burned');
    expect(ctx).toContain('Latest weight: 80 kg.');
  });

  it('coach context returns empty string when coach_personalization consent is opted out', async () => {
    const { userId } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-phase-d-optout'),
    );
    trackUser(userId);
    await prisma.consent.create({
      data: {
        userId,
        type: 'coach_personalization',
        granted: false,
        grantedAt: new Date(),
        textVersion: 'test',
      },
    });
    const profile = await prisma.profile.upsert({
      where: { userId },
      update: { workoutTypes: ['yoga'] },
      create: { userId, workoutTypes: ['yoga'] },
    });
    const ctx = await buildCoachContext(userId, profile);
    expect(ctx).toBe('');
  });
});
