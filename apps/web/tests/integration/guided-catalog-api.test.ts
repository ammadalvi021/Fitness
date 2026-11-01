/**
 * Yoga & Aerobics catalog APIs (V22 Phase A).
 * DB-backed — skipped gracefully when no PostgreSQL is reachable, or when
 * the guided catalog has not been seeded yet (run `npm run db:seed` first).
 * Route handlers are imported directly and called with real requests
 * against the real database, following the existing integration patterns.
 */
import { describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { sequenceDurationSeconds } from '@fitfusion/core';
import { GET as posesGET } from '@/app/api/yoga/poses/route';
import { GET as sequencesGET } from '@/app/api/yoga/sequences/route';
import { GET as sequenceDetailGET } from '@/app/api/yoga/sequences/[slug]/route';
import { GET as routinesGET } from '@/app/api/aerobics/routines/route';
import { GET as routineDetailGET } from '@/app/api/aerobics/routines/[slug]/route';
import { jsonRequest, readJson } from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();
// The suite verifies the SEEDED catalog: it skips (visibly) unless the
// database is reachable AND the guided catalog has been seeded into it.
const SEEDED =
  HAS_DB && (await prisma.yogaPose.count().catch(() => 0)) >= 25;

describe.skipIf(!SEEDED)('guided catalog APIs (seeded scratch DB)', () => {
  it('poses list returns all 25 seeded poses', async () => {
    const res = await posesGET(jsonRequest('http://test/api/yoga/poses', 'GET'));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.total).toBe(25);
    expect(body.poses).toHaveLength(25);
    const mountain = body.poses.find((p: any) => p.slug === 'mountain-pose');
    expect(mountain.sanskritName).toBe('Tadasana');
    expect(mountain.mediaStatus).toBe('placeholder');
  });

  it('poses list filters by difficulty and search text', async () => {

    const adv = await readJson(
      await posesGET(jsonRequest('http://test/api/yoga/poses?difficulty=advanced', 'GET')),
    );
    expect(adv.total).toBe(1);
    expect(adv.poses[0].slug).toBe('warrior-iii');

    const search = await readJson(
      await posesGET(jsonRequest('http://test/api/yoga/poses?q=Savasana', 'GET')),
    );
    expect(search.total).toBe(1);
    expect(search.poses[0].slug).toBe('corpse-pose');
  });

  it('sequences list returns 7 sequences, each with poses and duration > 0', async () => {

    const res = await sequencesGET(jsonRequest('http://test/api/yoga/sequences', 'GET'));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.total).toBe(7);
    expect(body.sequences).toHaveLength(7);
    const categories = body.sequences.map((s: any) => s.category).sort();
    expect(categories).toEqual(
      [
        'balance',
        'beginner',
        'flexibility',
        'full-body',
        'morning',
        'relaxation-breathing',
        'strength',
      ].sort(),
    );
    for (const s of body.sequences) {
      expect(s.poseCount, s.slug).toBeGreaterThan(0);
      expect(s.totalDurationSeconds, s.slug).toBeGreaterThan(0);
    }
  });

  it('sequence detail preserves pose order and the "each" side', async () => {

    const res = await sequenceDetailGET(
      jsonRequest('http://test/api/yoga/sequences/balance-stability-flow', 'GET'),
      { params: { slug: 'balance-stability-flow' } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const poses = body.sequence.poses;
    expect(poses.map((p: any) => p.order)).toEqual(poses.map((_: any, i: number) => i + 1));
    const tree = poses.find((p: any) => p.pose.slug === 'tree-pose');
    expect(tree.side).toBe('each');
    expect(tree.pose.sanskritName).toBe('Vrksasana');
    expect(Array.isArray(tree.pose.instructions)).toBe(true);
    // Duration matches the shared core maths (side "each" holds count twice).
    expect(body.sequence.totalDurationSeconds).toBe(sequenceDurationSeconds(poses));
    expect(body.sequence.poseCount).toBe(poses.length);
  });

  it('relaxation sequence carries the long closing holds', async () => {

    const body = await readJson(
      await sequenceDetailGET(
        jsonRequest('http://test/api/yoga/sequences/relaxation-and-breathing', 'GET'),
        { params: { slug: 'relaxation-and-breathing' } },
      ),
    );
    const bySlug = new Map<string, any>(
      body.sequence.poses.map((p: any) => [p.pose.slug, p] as [string, any]),
    );
    expect(bySlug.get('corpse-pose').holdSeconds).toBe(180);
    expect(bySlug.get('legs-up-the-wall').holdSeconds).toBe(120);
    expect(bySlug.get('easy-pose').holdSeconds).toBe(120);
  });

  it('routines list returns 6 routines with phase breakdowns', async () => {

    const res = await routinesGET(jsonRequest('http://test/api/aerobics/routines', 'GET'));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.total).toBe(6);
    for (const r of body.routines) {
      expect(r.stepCount, r.slug).toBeGreaterThan(0);
      expect(r.totalDurationSeconds, r.slug).toBeGreaterThan(0);
      expect(r.phases.warmup, r.slug).toBeGreaterThanOrEqual(3);
      expect(r.phases.main, r.slug).toBeGreaterThanOrEqual(6);
      expect(r.phases.cooldown, r.slug).toBe(3);
      expect(r.phases.warmup + r.phases.main + r.phases.cooldown).toBe(r.stepCount);
    }
  });

  it('routine detail orders steps warmup → main → cooldown', async () => {

    const res = await routineDetailGET(
      jsonRequest('http://test/api/aerobics/routines/full-body-aerobics-blast', 'GET'),
      { params: { slug: 'full-body-aerobics-blast' } },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const steps = body.routine.steps;
    const phaseRank: Record<string, number> = { warmup: 0, main: 1, cooldown: 2 };
    for (let i = 1; i < steps.length; i++) {
      expect(phaseRank[steps[i].phase]).toBeGreaterThanOrEqual(phaseRank[steps[i - 1].phase]);
      if (steps[i].phase === steps[i - 1].phase) {
        expect(steps[i].order).toBeGreaterThan(steps[i - 1].order);
      }
    }
    expect(steps[0].phase).toBe('warmup');
    expect(steps[steps.length - 1].phase).toBe('cooldown');
    expect(body.routine.totalDurationSeconds).toBe(1800);
    // Every main step of a non-low-impact routine offers a low-impact option.
    for (const s of steps.filter((x: any) => x.phase === 'main')) {
      expect(s.lowImpactAlternative, s.name).toBeTruthy();
    }
  });

  it('unknown sequence and routine slugs return 404', async () => {

    const seqRes = await sequenceDetailGET(
      jsonRequest('http://test/api/yoga/sequences/no-such-sequence', 'GET'),
      { params: { slug: 'no-such-sequence' } },
    );
    expect(seqRes.status).toBe(404);
    expect((await readJson(seqRes)).error.code).toBe('not_found');

    const rtnRes = await routineDetailGET(
      jsonRequest('http://test/api/aerobics/routines/no-such-routine', 'GET'),
      { params: { slug: 'no-such-routine' } },
    );
    expect(rtnRes.status).toBe(404);
    expect((await readJson(rtnRes)).error.code).toBe('not_found');
  });
});
