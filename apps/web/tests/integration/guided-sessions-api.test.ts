/**
 * Guided (yoga) workout sessions (V22 Phase B).
 * DB-backed — skipped gracefully when no PostgreSQL is reachable or the
 * guided catalog has not been seeded. Route handlers are imported directly
 * and called with real requests against the real database, following the
 * existing integration patterns.
 *
 * Verifies the additive POST/PATCH extensions:
 *  - unauthenticated create -> 401
 *  - yoga create with an unknown sequence slug -> 404
 *  - create -> complete stores kind/sourceSlug/durationSeconds
 *  - calories are computed SERVER-SIDE from the sequence MET value and the
 *    user's latest weight measurement (kg as-is, lb converted at 0.453592),
 *    and stay null when no usable weight exists
 *  - ownership: another user cannot PATCH the session (404)
 *  - strength sessions behave exactly as before (guided fields ignored)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as sessionsPOST } from '@/app/api/workouts/sessions/route';
import { PATCH as sessionPATCH } from '@/app/api/workouts/sessions/[id]/route';
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
  HAS_DB && (await prisma.yogaSequence.count().catch(() => 0)) >= 7;
const AERO_SEEDED =
  HAS_DB && (await prisma.aerobicRoutine.count().catch(() => 0)) >= 6;

const SLUG = 'beginner-yoga-foundations';
const AERO_SLUG = 'beginner-aerobics-starter';

async function createYogaSession(token: string) {
  const res = await sessionsPOST(
    authed(
      jsonRequest('http://localhost/api/workouts/sessions', 'POST', {
        kind: 'yoga',
        sourceSlug: SLUG,
      }),
      token,
    ),
  );
  return res;
}

async function addWeight(userId: string, value: number, unit: string) {
  await prisma.measurement.create({
    data: { userId, type: 'weight', value, unit },
  });
}

describe.skipIf(!SEEDED)('guided yoga sessions (seeded scratch DB)', () => {
  beforeAll(async () => {
    // Warm the sequence lookup used across tests.
    const seq = await prisma.yogaSequence.findUnique({ where: { slug: SLUG } });
    expect(seq).not.toBeNull();
  });

  afterAll(async () => {
    await cleanupUsers();
  });

  it('rejects unauthenticated session creation with 401', async () => {
    const res = await sessionsPOST(
      jsonRequest('http://localhost/api/workouts/sessions', 'POST', {
        kind: 'yoga',
        sourceSlug: SLUG,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for a yoga session with an unknown sequence slug', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided'),
    );
    const res = await sessionsPOST(
      authed(
        jsonRequest('http://localhost/api/workouts/sessions', 'POST', {
          kind: 'yoga',
          sourceSlug: 'no-such-sequence',
        }),
        token,
      ),
    );
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error.code).toBe('not_found');
  });

  it('requires sourceSlug for guided sessions (400)', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided'),
    );
    const res = await sessionsPOST(
      authed(
        jsonRequest('http://localhost/api/workouts/sessions', 'POST', { kind: 'yoga' }),
        token,
      ),
    );
    expect(res.status).toBe(400);
  });

  it('create -> complete stores kind/sourceSlug/duration and computes calories from a kg weight', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided'),
    );
    await addWeight(userId, 70, 'kg');

    const createRes = await createYogaSession(token);
    expect(createRes.status).toBe(201);
    const created = (await readJson(createRes)).session;
    const sequence = await prisma.yogaSequence.findUnique({ where: { slug: SLUG } });
    expect(created.kind).toBe('yoga');
    expect(created.sourceSlug).toBe(SLUG);
    expect(created.name).toBe(sequence!.title);
    expect(created.status).toBe('in_progress');

    const patchRes = await sessionPATCH(
      authed(
        jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
          status: 'completed',
          durationSeconds: 1800,
        }),
        token,
      ),
      { params: { id: created.id } },
    );
    expect(patchRes.status).toBe(200);
    const updated = (await readJson(patchRes)).session;
    expect(updated.status).toBe('completed');
    expect(updated.durationSeconds).toBe(1800);
    // Exact MET formula: round(met x 70kg x 1800s / 3600).
    const expected = Math.round(sequence!.metValue * 70 * (1800 / 3600));
    expect(updated.caloriesEstimateKcal).toBe(expected);

    const stored = await prisma.workoutSession.findUnique({ where: { id: created.id } });
    expect(stored?.durationSeconds).toBe(1800);
    expect(stored?.caloriesEstimateKcal).toBe(expected);
  });

  it('leaves calories null when the user has no weight measurement', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided'),
    );
    const created = (await readJson(await createYogaSession(token))).session;
    const patchRes = await sessionPATCH(
      authed(
        jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
          status: 'completed',
          durationSeconds: 900,
        }),
        token,
      ),
      { params: { id: created.id } },
    );
    expect(patchRes.status).toBe(200);
    const updated = (await readJson(patchRes)).session;
    expect(updated.durationSeconds).toBe(900);
    expect(updated.caloriesEstimateKcal).toBeNull();
  });

  it('converts an lb weight measurement at 0.453592 kg per pound', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided'),
    );
    await addWeight(userId, 154, 'lb');
    const sequence = await prisma.yogaSequence.findUnique({ where: { slug: SLUG } });

    const created = (await readJson(await createYogaSession(token))).session;
    const patchRes = await sessionPATCH(
      authed(
        jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
          status: 'completed',
          durationSeconds: 1800,
        }),
        token,
      ),
      { params: { id: created.id } },
    );
    const updated = (await readJson(patchRes)).session;
    const expected = Math.round(sequence!.metValue * (154 * 0.453592) * (1800 / 3600));
    expect(updated.caloriesEstimateKcal).toBe(expected);
  });

  it('rejects a client-supplied calorie value (schema has no such field)', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided'),
    );
    await addWeight(userId, 70, 'kg');
    const created = (await readJson(await createYogaSession(token))).session;
    const patchRes = await sessionPATCH(
      authed(
        jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
          status: 'completed',
          durationSeconds: 1800,
          // Attempted smuggle: zod strips unknown keys, and the value must
          // never reach the row — the server computes its own estimate.
          caloriesEstimateKcal: 99999,
        }),
        token,
      ),
      { params: { id: created.id } },
    );
    expect(patchRes.status).toBe(200);
    const updated = (await readJson(patchRes)).session;
    expect(updated.caloriesEstimateKcal).not.toBe(99999);
    const sequence = await prisma.yogaSequence.findUnique({ where: { slug: SLUG } });
    expect(updated.caloriesEstimateKcal).toBe(
      Math.round(sequence!.metValue * 70 * (1800 / 3600)),
    );
  });

  it("returns 404 when another user tries to complete someone else's session", async () => {
    const owner = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-guided'));
    const stranger = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-guided'));
    const created = (await readJson(await createYogaSession(owner.token))).session;
    const res = await sessionPATCH(
      authed(
        jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
          status: 'completed',
          durationSeconds: 600,
        }),
        stranger.token,
      ),
      { params: { id: created.id } },
    );
    expect(res.status).toBe(404);
    const stored = await prisma.workoutSession.findUnique({ where: { id: created.id } });
    expect(stored?.status).toBe('in_progress');
  });

  it('strength sessions behave exactly as before: guided fields ignored on completion', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided'),
    );
    await addWeight(userId, 70, 'kg');
    const createRes = await sessionsPOST(
      authed(
        jsonRequest('http://localhost/api/workouts/sessions', 'POST', {
          name: 'Strength day',
        }),
        token,
      ),
    );
    expect(createRes.status).toBe(201);
    const created = (await readJson(createRes)).session;
    expect(created.kind).toBe('strength');
    expect(created.sourceSlug).toBeNull();

    const patchRes = await sessionPATCH(
      authed(
        jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
          status: 'completed',
          durationSeconds: 1800,
        }),
        token,
      ),
      { params: { id: created.id } },
    );
    expect(patchRes.status).toBe(200);
    const updated = (await readJson(patchRes)).session;
    expect(updated.status).toBe('completed');
    expect(updated.durationSeconds).toBeNull();
    expect(updated.caloriesEstimateKcal).toBeNull();
  });
});

async function createAerobicsSession(token: string) {
  const res = await sessionsPOST(
    authed(
      jsonRequest('http://localhost/api/workouts/sessions', 'POST', {
        kind: 'aerobics',
        sourceSlug: AERO_SLUG,
      }),
      token,
    ),
  );
  return res;
}

describe.skipIf(!AERO_SEEDED)('guided aerobics sessions (seeded scratch DB)', () => {
  beforeAll(async () => {
    const routine = await prisma.aerobicRoutine.findUnique({ where: { slug: AERO_SLUG } });
    expect(routine).not.toBeNull();
  });

  afterAll(async () => {
    await cleanupUsers();
  });

  it('creates an aerobics session with a valid slug: kind/sourceSlug stored, name defaults to the routine title', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided-aero'),
    );
    const createRes = await createAerobicsSession(token);
    expect(createRes.status).toBe(201);
    const created = (await readJson(createRes)).session;
    const routine = await prisma.aerobicRoutine.findUnique({ where: { slug: AERO_SLUG } });
    expect(created.kind).toBe('aerobics');
    expect(created.sourceSlug).toBe(AERO_SLUG);
    expect(created.name).toBe(routine!.title);
    expect(created.status).toBe('in_progress');

    const stored = await prisma.workoutSession.findUnique({ where: { id: created.id } });
    expect(stored?.kind).toBe('aerobics');
    expect(stored?.sourceSlug).toBe(AERO_SLUG);
  });

  it('returns 404 for an aerobics session with an unknown routine slug', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided-aero'),
    );
    const res = await sessionsPOST(
      authed(
        jsonRequest('http://localhost/api/workouts/sessions', 'POST', {
          kind: 'aerobics',
          sourceSlug: 'no-such-routine',
        }),
        token,
      ),
    );
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error.code).toBe('not_found');
  });

  it('requires sourceSlug for aerobics sessions (400)', async () => {
    const { token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided-aero'),
    );
    const res = await sessionsPOST(
      authed(
        jsonRequest('http://localhost/api/workouts/sessions', 'POST', { kind: 'aerobics' }),
        token,
      ),
    );
    expect(res.status).toBe(400);
  });

  it('completion stores duration and computes calories server-side from the routine MET and a kg weight', async () => {
    const { userId, token } = await registerAndLogin(
      registerPOST,
      loginPOST,
      uniqueEmail('ff-guided-aero'),
    );
    await addWeight(userId, 70, 'kg');
    const routine = await prisma.aerobicRoutine.findUnique({ where: { slug: AERO_SLUG } });

    const created = (await readJson(await createAerobicsSession(token))).session;
    const patchRes = await sessionPATCH(
      authed(
        jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
          status: 'completed',
          durationSeconds: 1200,
          // Attempted smuggle: the server computes its own estimate.
          caloriesEstimateKcal: 99999,
        }),
        token,
      ),
      { params: { id: created.id } },
    );
    expect(patchRes.status).toBe(200);
    const updated = (await readJson(patchRes)).session;
    expect(updated.status).toBe('completed');
    expect(updated.durationSeconds).toBe(1200);
    const expected = Math.round(routine!.metValue * 70 * (1200 / 3600));
    expect(updated.caloriesEstimateKcal).toBe(expected);
    expect(updated.caloriesEstimateKcal).not.toBe(99999);

    const stored = await prisma.workoutSession.findUnique({ where: { id: created.id } });
    expect(stored?.durationSeconds).toBe(1200);
    expect(stored?.caloriesEstimateKcal).toBe(expected);
  });

  it("returns 404 when another user tries to complete someone else's aerobics session", async () => {
    const owner = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-guided-aero'));
    const stranger = await registerAndLogin(registerPOST, loginPOST, uniqueEmail('ff-guided-aero'));
    const created = (await readJson(await createAerobicsSession(owner.token))).session;
    const res = await sessionPATCH(
      authed(
        jsonRequest(`http://localhost/api/workouts/sessions/${created.id}`, 'PATCH', {
          status: 'completed',
          durationSeconds: 600,
        }),
        stranger.token,
      ),
      { params: { id: created.id } },
    );
    expect(res.status).toBe(404);
    const stored = await prisma.workoutSession.findUnique({ where: { id: created.id } });
    expect(stored?.status).toBe('in_progress');
  });
});
