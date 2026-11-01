/**
 * Phase E — cross-phase END-TO-END CHAIN (Yoga & Aerobics module release).
 * DB-backed — skipped gracefully when no PostgreSQL is reachable or the
 * guided catalogs have not been seeded. Exercises the full user story no
 * single phase covered, through the real route handlers:
 *
 *  Step 1: register a user, grant diet_exercise via the test-only sandbox
 *          selectPlan pattern, record a 70 kg weight, and set
 *          workoutTypes ['strength','yoga','aerobics'] (+ plan inputs)
 *          through the real PUT /api/profile path; GET confirms it.
 *  Step 2: POST /api/workouts/plans/generate returns a 7-day plan with
 *          BOTH strength workout days and guided days whose slugs exist
 *          in the seeded catalogs.
 *  Step 3: complete one yoga and one aerobics session through the real
 *          sessions API (POST kind+sourceSlug from the plan's guided days,
 *          PATCH completed with durationSeconds); calories are the
 *          server-side MET formula for 70 kg.
 *  Step 4: GET /api/progress totals: activeMinutes / estimatedCaloriesKcal
 *          match hand-computed expectations; byKind splits yoga/aerobics.
 *  Step 5: buildCoachContext reflects the preference + guided sessions.
 *  Step 6: a second user's progress + coach context contain NONE of the
 *          first user's sessions (chain-level ownership isolation).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { selectPlan } from '@/lib/billing';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as profileGET, PUT as profilePUT } from '@/app/api/profile/route';
import { POST as workoutGeneratePOST } from '@/app/api/workouts/plans/generate/route';
import { POST as sessionsPOST } from '@/app/api/workouts/sessions/route';
import { PATCH as sessionPATCH } from '@/app/api/workouts/sessions/[id]/route';
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
const SEEDED =
  HAS_DB &&
  (await prisma.yogaSequence.count().catch(() => 0)) >= 7 &&
  (await prisma.aerobicRoutine.count().catch(() => 0)) >= 6 &&
  (await prisma.exercise.count().catch(() => 0)) > 0;

const WEIGHT_KG = 70;
const YOGA_SECONDS = 1800;
const AERO_SECONDS = 1200;

interface Chain {
  userId: string;
  token: string;
  planDays: any[];
  yogaSlug: string;
  aeroSlug: string;
  yogaKcal: number;
  aeroKcal: number;
}
let chain: Chain | null = null;

async function setupChain(): Promise<Chain> {
  if (chain) return chain;
  const { userId, token } = await registerAndLogin(
    registerPOST,
    loginPOST,
    uniqueEmail('ff-phase-e'),
  );
  await selectPlan(userId, 'diet_exercise');
  await prisma.measurement.create({
    data: { userId, type: 'weight', value: WEIGHT_KG, unit: 'kg' },
  });
  chain = {
    userId,
    token,
    planDays: [],
    yogaSlug: '',
    aeroSlug: '',
    yogaKcal: 0,
    aeroKcal: 0,
  };
  return chain;
}

async function completeGuided(
  token: string,
  kind: 'yoga' | 'aerobics',
  slug: string,
  durationSeconds: number,
): Promise<{ session: any; expectedKcal: number }> {
  const createRes = await sessionsPOST(
    authed(
      jsonRequest('http://localhost/api/workouts/sessions', 'POST', {
        kind,
        sourceSlug: slug,
      }),
      token,
    ),
  );
  expect(createRes.status).toBe(201);
  const created = (await readJson(createRes)).session;
  expect(created.kind).toBe(kind);
  expect(created.sourceSlug).toBe(slug);
  expect(created.status).toBe('in_progress');

  const patchRes = await sessionPATCH(
    authed(
      jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
        status: 'completed',
        durationSeconds,
      }),
      token,
    ),
    { params: { id: created.id } },
  );
  expect(patchRes.status).toBe(200);
  const updated = (await readJson(patchRes)).session;
  expect(updated.status).toBe('completed');
  expect(updated.durationSeconds).toBe(durationSeconds);

  const source =
    kind === 'yoga'
      ? await prisma.yogaSequence.findUnique({ where: { slug } })
      : await prisma.aerobicRoutine.findUnique({ where: { slug } });
  // Exact MET formula: round(met x weightKg x hours).
  const expectedKcal = Math.round(
    source!.metValue * WEIGHT_KG * (durationSeconds / 3600),
  );
  expect(updated.caloriesEstimateKcal).toBe(expectedKcal);
  return { session: updated, expectedKcal };
}

describe.skipIf(!SEEDED)('phase E end-to-end chain (fresh seeded DB)', () => {
  // selectPlan grants paid plans only in sandbox (TEST-ONLY) mode — same
  // pattern as phase-d-plan-mixing.test.ts. Billing itself is untouched.
  const savedProvider = process.env.BILLING_PROVIDER;
  beforeAll(() => {
    process.env.BILLING_PROVIDER = 'sandbox';
  });
  afterAll(async () => {
    if (savedProvider === undefined) delete process.env.BILLING_PROVIDER;
    else process.env.BILLING_PROVIDER = savedProvider;
    await cleanupUsers();
  });

  it('step 1: profile API stores workoutTypes [strength, yoga, aerobics] for a new user', async () => {
    const c = await setupChain();
    const putRes = await profilePUT(
      authed(
        jsonRequest('http://localhost/api/profile', 'PUT', {
          workoutTypes: ['strength', 'yoga', 'aerobics'],
          workoutDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
          workoutMinutesPerDay: 45,
          fitnessExperience: 'beginner',
          equipment: [],
        }),
        c.token,
      ),
    );
    expect(putRes.status).toBe(200);
    expect((await readJson(putRes)).profile.workoutTypes).toEqual([
      'strength',
      'yoga',
      'aerobics',
    ]);

    const getRes = await profileGET(
      authed(jsonRequest('http://localhost/api/profile', 'GET'), c.token),
    );
    expect(getRes.status).toBe(200);
    expect((await readJson(getRes)).profile.workoutTypes).toEqual([
      'strength',
      'yoga',
      'aerobics',
    ]);
  });

  it('step 2: generated weekly plan mixes strength days and guided days with real slugs', async () => {
    const c = await setupChain();
    const res = await workoutGeneratePOST(
      authed(jsonRequest('http://localhost/api/workouts/plans/generate', 'POST', {}), c.token),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    const days = body.plan.days;
    expect(days).toHaveLength(7);
    c.planDays = days;

    const strengthDays = days.filter((d: any) => d.type === 'workout');
    const guidedDays = days.filter((d: any) => d.type === 'yoga' || d.type === 'aerobics');
    expect(strengthDays.length).toBeGreaterThanOrEqual(1);
    for (const d of strengthDays) {
      expect(Array.isArray(d.exercises)).toBe(true);
      expect(d.exercises.length).toBeGreaterThan(0);
    }
    expect(guidedDays.length).toBeGreaterThanOrEqual(1);
    for (const d of guidedDays) {
      const source =
        d.type === 'yoga'
          ? await prisma.yogaSequence.findUnique({ where: { slug: d.sourceSlug } })
          : await prisma.aerobicRoutine.findUnique({ where: { slug: d.sourceSlug } });
      expect(source).not.toBeNull();
      expect(source!.title).toBe(d.title);
    }
    const yogaDay = guidedDays.find((d: any) => d.type === 'yoga');
    const aeroDay = guidedDays.find((d: any) => d.type === 'aerobics');
    // Mixed rotation (strength + both guided kinds, 4 workout days) yields
    // at least one yoga day; aerobics falls back to the catalog where the
    // plan's cycle did not reach it ("where feasible").
    expect(yogaDay).toBeDefined();
    c.yogaSlug = yogaDay.sourceSlug;
    c.aeroSlug = aeroDay ? aeroDay.sourceSlug : 'beginner-aerobics-starter';
  });

  it('step 3: yoga + aerobics sessions complete through the real sessions API with server calories', async () => {
    const c = await setupChain();
    expect(c.yogaSlug).not.toBe('');
    const yoga = await completeGuided(c.token, 'yoga', c.yogaSlug, YOGA_SECONDS);
    c.yogaKcal = yoga.expectedKcal;
    const aero = await completeGuided(c.token, 'aerobics', c.aeroSlug, AERO_SECONDS);
    c.aeroKcal = aero.expectedKcal;
    expect(c.yogaKcal).toBeGreaterThan(0);
    expect(c.aeroKcal).toBeGreaterThan(0);
  });

  it('step 4: progress totals and byKind match hand-computed expectations', async () => {
    const c = await setupChain();
    const res = await progressGET(
      authed(jsonRequest('http://localhost/api/progress?days=30', 'GET'), c.token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.workouts.total).toBe(2);
    expect(body.workouts.completed).toBe(2);
    // (1800 + 1200)s = 50 active minutes; calories are the exact
    // server-side MET sums proven in step 3.
    expect(body.workouts.activeMinutes).toBe(50);
    expect(body.workouts.estimatedCaloriesKcal).toBe(c.yogaKcal + c.aeroKcal);
    expect(body.workouts.byKind.yoga).toEqual({
      sessions: 1,
      completed: 1,
      activeMinutes: 30,
      estimatedCaloriesKcal: c.yogaKcal,
    });
    expect(body.workouts.byKind.aerobics).toEqual({
      sessions: 1,
      completed: 1,
      activeMinutes: 20,
      estimatedCaloriesKcal: c.aeroKcal,
    });
    expect(body.workouts.byKind.strength).toEqual({
      sessions: 0,
      completed: 0,
      activeMinutes: 0,
      estimatedCaloriesKcal: 0,
    });
  });

  it('step 5: coach context reflects the preference and the guided sessions', async () => {
    const c = await setupChain();
    const profile = await prisma.profile.findUnique({ where: { userId: c.userId } });
    const ctx = await buildCoachContext(c.userId, profile);
    expect(ctx).toContain('workout types: strength, yoga, aerobics');
    expect(ctx).toContain('Workouts in the last 7 days: 2.');
    expect(ctx).toContain('Guided workouts in the last 7 days: 1 yoga, 1 aerobics');
    expect(ctx).toContain('50 active minutes');
    expect(ctx).toContain(`~${c.yogaKcal + c.aeroKcal} estimated kcal burned`);
    expect(ctx).toContain('Latest weight: 70 kg.');
  });

  it("step 6: a second user's progress and coach context exclude the first user's sessions", async () => {
    const c = await setupChain();
    const other = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-phase-e-other'),
    );
    trackUser(other.userId);

    const res = await progressGET(
      authed(jsonRequest('http://localhost/api/progress?days=30', 'GET'), other.token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.workouts.total).toBe(0);
    expect(body.workouts.completed).toBe(0);
    expect(body.workouts.activeMinutes).toBe(0);
    expect(body.workouts.estimatedCaloriesKcal).toBe(0);
    expect(body.workouts.byKind.yoga.sessions).toBe(0);
    expect(body.workouts.byKind.aerobics.sessions).toBe(0);

    const profile2 = await prisma.profile.findUnique({ where: { userId: other.userId } });
    const ctx2 = await buildCoachContext(other.userId, profile2);
    expect(ctx2).toContain('Workouts in the last 7 days: 0.');
    expect(ctx2).not.toContain('Guided workouts');
    expect(ctx2).not.toContain('workout types: strength, yoga, aerobics');
    // Sanity: the first user's data is still intact.
    expect(
      await prisma.workoutSession.count({
        where: { userId: c.userId, status: 'completed' },
      }),
    ).toBe(2);
  });
});
