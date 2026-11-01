/**
 * Phase D — weekly-plan MIXING (guided yoga/aerobics days in generated plans).
 * DB-backed — skipped gracefully when no PostgreSQL is reachable or the
 * guided catalogs have not been seeded (same guard pattern as
 * guided-sessions-api.test.ts). Route handlers are imported directly and
 * called with real requests against the real database.
 *
 * Verifies:
 *  (a) STRENGTH-ONLY PIN: workoutTypes [] generates days deep-equal to an
 *      explicit ['strength'] profile, and every day is rest|workout.
 *  (b) MIXED ['strength','yoga']: odd workout sessions are guided yoga days
 *      (slug exists in the catalog, no exercises field), even sessions stay
 *      strength workouts; regeneration is deterministic (deep-equal days).
 *  (c) GUIDED-ONLY ['yoga','aerobics']: every non-rest day is guided, with
 *      at least one day of each kind (kinds cycle yoga, aerobics, ...).
 *  (d) Notes: mixed plans gain exactly one additive guided note;
 *      strength-only notes equal the 3 baseline notes byte-for-byte.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { selectPlan } from '@/lib/billing';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as workoutGeneratePOST } from '@/app/api/workouts/plans/generate/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();
const SEEDED =
  HAS_DB &&
  (await prisma.yogaSequence.count().catch(() => 0)) >= 7 &&
  (await prisma.aerobicRoutine.count().catch(() => 0)) >= 6 &&
  (await prisma.exercise.count().catch(() => 0)) > 0;

const BASELINE_NOTES = [
  'Stop exercising and seek medical attention if you feel chest pain, dizziness, or unusual shortness of breath.',
  'Schedule: 4 workout day(s), 3 rest day(s).',
  'Progress gradually — increase load or reps only when the current scheme feels manageable.',
];

async function setProfile(userId: string, workoutTypes: string[]): Promise<void> {
  const fields = {
    workoutDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
    workoutMinutesPerDay: 45,
    fitnessExperience: 'beginner',
    equipment: [] as string[],
    workoutTypes,
  };
  await prisma.profile.upsert({
    where: { userId },
    create: { userId, ...fields },
    update: fields,
  });
}

async function makeUser(workoutTypes: string[]): Promise<{ userId: string; token: string }> {
  const { userId, token } = await registerAndLogin(
    registerPOST,
    loginPOST,
    uniqueEmail('ff-phase-d'),
  );
  await selectPlan(userId, 'diet_exercise');
  await setProfile(userId, workoutTypes);
  return { userId, token };
}

async function generate(token: string): Promise<any> {
  const res = await workoutGeneratePOST(
    authed(jsonRequest('http://localhost/api/workouts/plans/generate', 'POST', {}), token),
  );
  expect(res.status).toBe(201);
  return readJson(res);
}

describe.skipIf(!SEEDED)('phase D plan mixing (seeded scratch DB)', () => {
  // selectPlan grants paid plans only in sandbox (TEST-ONLY) mode — same
  // pattern as extended-flows.test.ts. Billing itself is untouched.
  const savedProvider = process.env.BILLING_PROVIDER;
  beforeAll(() => {
    process.env.BILLING_PROVIDER = 'sandbox';
  });
  afterAll(async () => {
    if (savedProvider === undefined) delete process.env.BILLING_PROVIDER;
    else process.env.BILLING_PROVIDER = savedProvider;
    await cleanupUsers();
  });

  it('(a) strength-only pin: [] and [strength] generate identical rest/workout days', async () => {
    const empty = await makeUser([]);
    const bodyA = await generate(empty.token);
    const daysA = bodyA.plan.days;
    expect(daysA).toHaveLength(7);
    for (const d of daysA) {
      expect(['rest', 'workout']).toContain(d.type);
    }

    const explicit = await makeUser(['strength']);
    const bodyB = await generate(explicit.token);
    expect(bodyB.plan.days).toEqual(daysA);
  });

  it('(b) mixed [strength, yoga]: guided yoga days alternate with strength days, deterministically', async () => {
    const { token } = await makeUser(['strength', 'yoga']);
    const body = await generate(token);
    const days = body.plan.days;

    const yogaDays = days.filter((d: any) => d.type === 'yoga');
    const workoutDays = days.filter((d: any) => d.type === 'workout');
    expect(yogaDays.length).toBeGreaterThanOrEqual(1);
    expect(workoutDays.length).toBeGreaterThanOrEqual(1);
    for (const d of workoutDays) {
      expect(Array.isArray(d.exercises)).toBe(true);
      expect(d.exercises.length).toBeGreaterThan(0);
    }
    for (const d of yogaDays) {
      expect(d).not.toHaveProperty('exercises');
      expect(typeof d.sourceSlug).toBe('string');
      expect(typeof d.title).toBe('string');
      expect(d.durationSeconds).toBeGreaterThan(0);
      const seq = await prisma.yogaSequence.findUnique({ where: { slug: d.sourceSlug } });
      expect(seq).not.toBeNull();
      expect(seq!.title).toBe(d.title);
    }

    // Determinism: a second generation produces deep-equal days.
    const again = await generate(token);
    expect(again.plan.days).toEqual(days);
  });

  it('(c) guided-only [yoga, aerobics]: every non-rest day is guided, both kinds present', async () => {
    const { token } = await makeUser(['yoga', 'aerobics']);
    const body = await generate(token);
    const days = body.plan.days;
    const nonRest = days.filter((d: any) => d.type !== 'rest');
    expect(nonRest.length).toBe(4);
    for (const d of nonRest) {
      expect(['yoga', 'aerobics']).toContain(d.type);
      expect(d).not.toHaveProperty('exercises');
    }
    const kinds = new Set(nonRest.map((d: any) => d.type));
    expect(kinds.has('yoga')).toBe(true);
    expect(kinds.has('aerobics')).toBe(true);
  });

  it('(d) notes: mixed plan gains a guided note; strength-only notes are the exact baseline', async () => {
    const mixed = await makeUser(['strength', 'yoga']);
    const mixedBody = await generate(mixed.token);
    expect(mixedBody.notes).toHaveLength(4);
    expect(mixedBody.notes.slice(0, 3)).toEqual(BASELINE_NOTES);
    expect(mixedBody.notes[3]).toMatch(/guided day\(s\)/);
    expect(mixedBody.notes[3]).toContain('yoga');

    const strength = await makeUser([]);
    const strengthBody = await generate(strength.token);
    expect(strengthBody.notes).toEqual(BASELINE_NOTES);
  });
});
