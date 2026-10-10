/**
 * (c) BMI calculator public endpoint returns a classification (no auth).
 * (e) plan gating: free user cannot generate a workout plan (403).
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { GET as bmiGET, POST as bmiPOST } from '@/app/api/calculators/bmi/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as workoutGeneratePOST } from '@/app/api/workouts/plans/generate/route';
import { POST as mealGeneratePOST } from '@/app/api/meals/plans/generate/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

describe('public BMI calculator', () => {
  it('GET returns endpoint info without auth', async () => {
    const res = await bmiGET();
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.info.note).toContain('screening measure');
  });

  it('POST returns BMI + adult classification without auth', async () => {
    const res = await bmiPOST(
      jsonRequest('http://localhost/api/calculators/bmi', 'POST', {
        weight: 70,
        height: 175,
        units: 'metric',
        ageYears: 30,
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.bmi).toBeCloseTo(22.9, 1);
    expect(body.classificationKey).toBe('healthy');
    expect(body.isMinor).toBe(false);
    expect(body.screeningNote).toContain('screening measure');
  });

  it('POST supports imperial units', async () => {
    const res = await bmiPOST(
      jsonRequest('http://localhost/api/calculators/bmi', 'POST', {
        weight: 154,
        height: 69,
        units: 'imperial',
        ageYears: 30,
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.bmi).toBeGreaterThan(20);
    expect(body.bmi).toBeLessThan(25);
    expect(body.classificationKey).toBe('healthy');
  });

  it('POST for a minor returns no adult classification', async () => {
    const res = await bmiPOST(
      jsonRequest('http://localhost/api/calculators/bmi', 'POST', {
        weight: 40,
        height: 150,
        units: 'metric',
        ageYears: 12,
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.isMinor).toBe(true);
    expect(body.classificationKey).toBeNull();
    expect(body.pediatricGuidance).toBeTruthy();
  });

  it('POST rejects invalid input with 400', async () => {
    const res = await bmiPOST(
      jsonRequest('http://localhost/api/calculators/bmi', 'POST', {
        weight: -5,
        height: 175,
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('plan gating', () => {
  afterAll(cleanupUsers);

  it('free user cannot generate a workout plan (403 plan_required)', async () => {
    const email = uniqueEmail('ff-gate');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await workoutGeneratePOST(
      authed(jsonRequest('http://localhost/api/workouts/plans/generate', 'POST', {}), token),
    );
    expect(res.status).toBe(403);
    expect((await readJson(res)).error.code).toBe('plan_required');
  });

  it('free user cannot generate a meal plan (403 plan_required)', async () => {
    const email = uniqueEmail('ff-gate2');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await mealGeneratePOST(
      authed(jsonRequest('http://localhost/api/meals/plans/generate', 'POST', {}), token),
    );
    expect(res.status).toBe(403);
    expect((await readJson(res)).error.code).toBe('plan_required');
  });

  it('unauthenticated workout-plan generate returns 401', async () => {
    const res = await workoutGeneratePOST(
      jsonRequest('http://localhost/api/workouts/plans/generate', 'POST', {}),
    );
    expect(res.status).toBe(401);
  });
});
