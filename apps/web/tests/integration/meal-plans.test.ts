/**
 * Phase 4 regression: meal-plan generation under the new billing contract.
 *
 * Paid plans are 402 in `none` mode, so these tests run with
 * BILLING_PROVIDER=sandbox (clearly-labeled TEST-ONLY upgrades) and restore
 * the env afterwards. AI keys stay neutralized by tests/setup.ts, so
 * generation deterministically uses the template path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as onboardingPOST } from '@/app/api/onboarding/route';
import { POST as subscriptionsPOST } from '@/app/api/subscriptions/route';
import { POST as mealGeneratePOST } from '@/app/api/meals/plans/generate/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  trackUser,
  uniqueEmail,
} from './helpers';

const savedProvider = process.env.BILLING_PROVIDER;
beforeAll(() => {
  process.env.BILLING_PROVIDER = 'sandbox';
});
afterAll(() => {
  if (savedProvider === undefined) delete process.env.BILLING_PROVIDER;
  else process.env.BILLING_PROVIDER = savedProvider;
  return cleanupUsers();
});

function ingredientNames(plan: any): string[] {
  const names: string[] = [];
  for (const day of plan.days ?? []) {
    for (const meal of day.meals ?? []) {
      for (const ing of meal.ingredients ?? []) {
        if (ing?.name) names.push(String(ing.name));
      }
    }
  }
  return names;
}

describe('meal plan generation (sandbox paid upgrade)', () => {
  it('generates a 7-day template plan with calorie targets', async () => {
    const email = uniqueEmail('ff-meal7');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    await onboardingPOST(
      authed(
        jsonRequest('http://localhost/api/onboarding', 'POST', { goal: 'lose', weightKg: 72 }),
        token,
      ),
    );
    const sel = await subscriptionsPOST(
      authed(jsonRequest('http://localhost/api/subscriptions', 'POST', { planId: 'diet' }), token),
    );
    expect(sel.status).toBe(200);
    expect((await readJson(sel)).testMode).toBe(true);

    const gen = await mealGeneratePOST(
      authed(jsonRequest('http://localhost/api/meals/plans/generate', 'POST', {}), token),
    );
    expect(gen.status).toBe(201);
    const body = await readJson(gen);
    expect(body.plan.days.length).toBe(7);
    expect(body.plan.generatedBy).toBe('template'); // AI not configured -> honest fallback
    expect(body.targets.calorieTarget).toBeGreaterThan(0);
    expect(ingredientNames(body.plan).length).toBeGreaterThan(0);
  });

  it('allergy exclusion is honored: no almond in any generated meal', async () => {
    const email = uniqueEmail('ff-allergy');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    trackUser(userId);
    await onboardingPOST(
      authed(
        jsonRequest('http://localhost/api/onboarding', 'POST', { goal: 'lose', weightKg: 72 }),
        token,
      ),
    );
    // 'almond' matches by case-insensitive substring ('Almonds' in the
    // oatmeal template), so the generator must filter those meals out.
    await prisma.profile.upsert({
      where: { userId },
      update: { allergies: ['almond'] },
      create: { userId, allergies: ['almond'] },
    });
    const sel = await subscriptionsPOST(
      authed(jsonRequest('http://localhost/api/subscriptions', 'POST', { planId: 'diet' }), token),
    );
    expect(sel.status).toBe(200);

    const gen = await mealGeneratePOST(
      authed(jsonRequest('http://localhost/api/meals/plans/generate', 'POST', {}), token),
    );
    expect(gen.status).toBe(201);
    const body = await readJson(gen);
    expect(body.plan.days.length).toBe(7);
    const names = ingredientNames(body.plan);
    expect(names.length).toBeGreaterThan(0);
    const offenders = names.filter((n) => n.toLowerCase().includes('almond'));
    expect(offenders).toEqual([]);
    // the route's own post-validation must not flag allergy violations either
    const allergyWarnings = (body.warnings as string[]).filter((w) =>
      w.toLowerCase().includes('allerg'),
    );
    expect(allergyWarnings).toEqual([]);
  });
});
