/**
 * Extended integration tests: plan-gated generation, scans, coach,
 * data export, and account deletion — exercising real runtime paths.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { selectPlan } from '@/lib/billing';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as meGET } from '@/app/api/auth/me/route';
import { POST as mealGeneratePOST } from '@/app/api/meals/plans/generate/route';
import { POST as workoutGeneratePOST } from '@/app/api/workouts/plans/generate/route';
import { POST as scansPOST, GET as scansGET } from '@/app/api/scans/route';
import { POST as confirmPOST } from '@/app/api/scans/[id]/confirm/route';
import { POST as convPOST } from '@/app/api/coach/conversations/route';
import { POST as msgPOST } from '@/app/api/coach/conversations/[id]/messages/route';
import { GET as uploadsGET } from '@/app/api/uploads/[key]/route';
import { POST as exportPOST } from '@/app/api/data-export/route';
import { GET as exportGET } from '@/app/api/data-export/[id]/route';
import { DELETE as accountDELETE } from '@/app/api/account/route';
import { POST as subscriptionsPOST } from '@/app/api/subscriptions/route';
import { POST as billingCancelPOST } from '@/app/api/billing/cancel/route';
import { GET as recipesGET } from '@/app/api/recipes/route';
import { GET as exercisesGET } from '@/app/api/exercises/route';
import { GET as foodsGET } from '@/app/api/foods/route';
import { GET as progressGET } from '@/app/api/progress/route';
import { POST as measurementsPOST, GET as measurementsGET } from '@/app/api/measurements/route';
import { POST as waterPOST, GET as waterGET } from '@/app/api/water/route';
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/settings/route';
import { POST as onboardingPOST } from '@/app/api/onboarding/route';
import { GET as configGET } from '@/app/api/config/route';
import { GET as healthGET } from '@/app/api/health/route';
import { POST as sessionsPOST } from '@/app/api/workouts/sessions/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  trackUser,
  uniqueEmail,
} from './helpers';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('public endpoints', () => {
  it('GET /api/health -> {ok:true}', async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect((await readJson(res)).ok).toBe(true);
  });

  it('GET /api/config exposes branding, plans, ai and billing status', async () => {
    const res = await configGET();
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.branding.appName).toBeTruthy();
    expect(body.plans.length).toBe(3);
    expect(body.ai.chat).toBe(false); // no AI keys in test env
    expect(body.billing.provider).toBe('none');
  });

  it('GET /api/recipes and /api/exercises return seeded data', async () => {
    const r = await recipesGET(new NextRequest('http://localhost/api/recipes?limit=5'));
    expect(r.status).toBe(200);
    expect((await readJson(r)).recipes.length).toBeGreaterThan(0);
    const e = await exercisesGET(new NextRequest('http://localhost/api/exercises?limit=5'));
    expect(e.status).toBe(200);
    expect((await readJson(e)).exercises.length).toBeGreaterThan(0);
  });
});

describe('paid flows (new billing contract)', () => {
  afterAll(cleanupUsers);

  // New contract: paid plans are REJECTED with 402 in `none`/`stripe` mode.
  // These flows exercise the `sandbox` happy path, which records a
  // clearly-labeled TEST-ONLY upgrade (testMode:true, charged:false).
  const savedProvider = process.env.BILLING_PROVIDER;
  beforeAll(() => {
    process.env.BILLING_PROVIDER = 'sandbox';
  });
  afterAll(() => {
    if (savedProvider === undefined) delete process.env.BILLING_PROVIDER;
    else process.env.BILLING_PROVIDER = savedProvider;
  });

  it('subscription select -> meal plan generate (template) -> regenerate -> shopping list', async () => {
    const email = uniqueEmail('ff-meals');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);

    // onboarding gives the user a weight so calorie targets can be computed
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
    const selBody = await readJson(sel);
    expect(selBody.charged).toBe(false);
    expect(selBody.testMode).toBe(true); // sandbox: TEST-ONLY, no real charge
    expect(selBody.note).toMatch(/no real charge/i);
    expect(selBody.subscription.planId).toBe('diet');

    const gen = await mealGeneratePOST(
      authed(jsonRequest('http://localhost/api/meals/plans/generate', 'POST', {}), token),
    );
    expect(gen.status).toBe(201);
    const genBody = await readJson(gen);
    expect(genBody.plan.days.length).toBe(7);
    expect(genBody.plan.generatedBy).toBe('template');
    expect(genBody.targets.calorieTarget).toBeGreaterThan(0);
    const planId = genBody.plan.id;

    // useAI=true with no AI keys -> honest template fallback
    const genAI = await mealGeneratePOST(
      authed(jsonRequest('http://localhost/api/meals/plans/generate', 'POST', { useAI: true }), token),
    );
    expect(genAI.status).toBe(201);
    const genAIBody = await readJson(genAI);
    expect(genAIBody.plan.generatedBy).toBe('template');
    expect(genAIBody.warnings.join(' ')).toContain('not configured');

    // regenerate a meal (dynamic import for the parameterized route)
    const { POST: regenPOST } = await import('@/app/api/meals/plans/[id]/regenerate-meal/route');
    const regen = await regenPOST(
      authed(
        jsonRequest('http://localhost/api/meals/plans/generate', 'POST', { dayIndex: 0, mealType: 'lunch' }),
        token,
      ),
      { params: { id: planId } },
    );
    expect(regen.status).toBe(200);

    const shop = await (await import('@/app/api/meals/shopping-list/route')).GET(
      authed(new NextRequest(`http://localhost/api/meals/shopping-list?planId=${planId}`), token),
    );
    expect(shop.status).toBe(200);
    const shopBody = await readJson(shop);
    expect(Object.keys(shopBody.shoppingList).length).toBeGreaterThan(0);

    // new billing contract: cancel via POST /api/billing/cancel
    const cancel = await billingCancelPOST(
      authed(new NextRequest('http://localhost/api/billing/cancel', { method: 'POST' }), token),
    );
    expect(cancel.status).toBe(200);
    const cancelBody = await readJson(cancel);
    expect(cancelBody.subscription.planId).toBe('free');
    expect(cancelBody.testMode).toBe(true); // sandbox label retained
    void userId;
  });

  it('workout plan generate includes safety copy and rest days', async () => {
    const email = uniqueEmail('ff-workouts');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    await selectPlan(userId, 'diet_exercise');

    const gen = await workoutGeneratePOST(
      authed(jsonRequest('http://localhost/api/workouts/plans/generate', 'POST', {}), token),
    );
    expect(gen.status).toBe(201);
    const body = await readJson(gen);
    expect(body.plan.days.length).toBe(7);
    const restDays = body.plan.days.filter((d: any) => d.type === 'rest');
    expect(restDays.length).toBeGreaterThan(0);
    expect(body.notes.join(' ')).toContain('Stop exercising and seek medical attention');

    // sessions + logs
    const sess = await sessionsPOST(
      authed(jsonRequest('http://localhost/api/workouts/sessions', 'POST', { name: 'Test session' }), token),
    );
    expect(sess.status).toBe(201);
    const sessionId = (await readJson(sess)).session.id;
    const exercise = await prisma.exercise.findFirstOrThrow();
    const { POST: logsPOST } = await import('@/app/api/workouts/sessions/[id]/logs/route');
    const log = await logsPOST(
      authed(
        jsonRequest('http://localhost/api/workouts/sessions/x/logs', 'POST', {
          exerciseId: exercise.id,
          sets: [{ reps: 10, weight: 20 }],
        }),
        token,
      ),
      { params: { id: sessionId } },
    );
    expect(log.status).toBe(201);
  });
});

describe('scans, coach, export, account', () => {
  afterAll(cleanupUsers);

  it('scan upload without AI keys -> not_configured (honest, no fabricated items)', async () => {
    const email = uniqueEmail('ff-scan');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const form = new FormData();
    form.append('image', new File([TINY_PNG], 'test.png', { type: 'image/png' }));
    const res = await scansPOST(
      authed(new NextRequest('http://localhost/api/scans', { method: 'POST', body: form }), token),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.scan.status).toBe('not_configured');
    expect(body.aiConfigured).toBe(false);
    expect(body.scan.items).toEqual([]);
    expect(body.disclaimer).toContain("Estimates only");

    // confirming a not_configured scan is rejected
    const confirm = await confirmPOST(
      authed(jsonRequest('http://localhost/api/scans/x/confirm', 'POST', { items: [] }), token),
      { params: { id: body.scan.id } },
    );
    expect(confirm.status).toBe(400);

    const list = await scansGET(authed(new NextRequest('http://localhost/api/scans'), token));
    expect(list.status).toBe(200);
    expect((await readJson(list)).scans.length).toBeGreaterThan(0);
  });

  it('coach without AI keys -> reply null, aiConfigured false', async () => {
    const email = uniqueEmail('ff-coach');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const conv = await convPOST(
      authed(jsonRequest('http://localhost/api/coach/conversations', 'POST', { title: 'Test' }), token),
    );
    expect(conv.status).toBe(201);
    const convId = (await readJson(conv)).conversation.id;
    const msg = await msgPOST(
      authed(
        jsonRequest('http://localhost/api/coach/conversations/x/messages', 'POST', { content: 'Hello coach' }),
        token,
      ),
      { params: { id: convId } },
    );
    expect(msg.status).toBe(200);
    const body = await readJson(msg);
    expect(body.reply).toBeNull();
    expect(body.aiConfigured).toBe(false);
    expect(body.userMessage.content).toBe('Hello coach');
  });

  it('data export produces a downloadable file; uploads require auth', async () => {
    const email = uniqueEmail('ff-export');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const res = await exportPOST(
      authed(new NextRequest('http://localhost/api/data-export', { method: 'POST' }), token),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.export.status).toBe('ready');
    expect(body.export.fileUrl).toMatch(/^\/api\/uploads\//);
    const key = body.export.fileUrl.replace('/api/uploads/', '');

    const dl = await uploadsGET(authed(new NextRequest(`http://localhost/api/uploads/${key}`), token), {
      params: { key },
    });
    expect(dl.status).toBe(200);
    const json = JSON.parse(await dl.text());
    expect(json.user.email).toBe(email);
    expect(json.user).not.toHaveProperty('passwordHash');

    // unauthenticated download -> 401
    const noAuth = await uploadsGET(new NextRequest(`http://localhost/api/uploads/${key}`), {
      params: { key },
    });
    expect(noAuth.status).toBe(401);

    // traversal attempt -> 400/404, never escapes the dir
    const trav = await uploadsGET(authed(new NextRequest('http://localhost/api/uploads/x'), token), {
      params: { key: '../../package.json' },
    });
    expect([400, 404]).toContain(trav.status);

    const meta = await exportGET(authed(new NextRequest('http://localhost/api/data-export/x'), token), {
      params: { id: body.export.id },
    });
    expect(meta.status).toBe(200);
  });

  it('misc endpoints: foods, water, measurements, settings, onboarding, progress', async () => {
    const email = uniqueEmail('ff-misc');
    const { token } = await registerAndLogin(registerPOST, loginPOST, email);
    const get = (fn: any, url: string) => fn(authed(new NextRequest(url), token));

    const foods = await get(foodsGET, 'http://localhost/api/foods?q=chicken&limit=5');
    expect(foods.status).toBe(200);
    expect((await readJson(foods)).foods.length).toBeGreaterThan(0);

    const w = await waterPOST(authed(jsonRequest('http://localhost/api/water', 'POST', { date: '2026-10-09', ml: 750 }), token));
    expect(w.status).toBe(200);
    expect((await readJson(await get(waterGET, 'http://localhost/api/water?date=2026-10-09'))).ml).toBe(750);

    const m = await measurementsPOST(authed(jsonRequest('http://localhost/api/measurements', 'POST', { type: 'weight', value: 70, unit: 'kg' }), token));
    expect(m.status).toBe(201);
    expect((await readJson(await get(measurementsGET, 'http://localhost/api/measurements?type=weight'))).measurements.length).toBeGreaterThan(0);

    const sg = await get(settingsGET, 'http://localhost/api/settings');
    expect(sg.status).toBe(200);
    const sp = await settingsPUT(authed(jsonRequest('http://localhost/api/settings', 'PUT', { dietPreference: 'vegetarian' }), token));
    expect(sp.status).toBe(200);
    expect((await readJson(sp)).settings.dietPreference).toBe('vegetarian');

    const ob = await onboardingPOST(authed(jsonRequest('http://localhost/api/onboarding', 'POST', { goal: 'lose', weightKg: 72 }), token));
    expect(ob.status).toBe(200);
    expect((await readJson(ob)).profile.onboardingCompletedAt).toBeTruthy();

    const pr = await get(progressGET, 'http://localhost/api/progress?days=7');
    expect(pr.status).toBe(200);
    const prBody = await readJson(pr);
    expect(prBody.weights.length).toBeGreaterThan(0);
    expect(prBody.waterByDay.length).toBeGreaterThan(0);
  });

  it('account DELETE wipes data after password verification', async () => {
    const email = uniqueEmail('ff-del');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email, 'Delete1234');
    trackUser(userId); // no-op after wipe (delete is idempotent via catch)

    const bad = await accountDELETE(
      authed(jsonRequest('http://localhost/api/account', 'DELETE', { password: 'Wrong1234' }), token),
    );
    expect(bad.status).toBe(401);

    const good = await accountDELETE(
      authed(jsonRequest('http://localhost/api/account', 'DELETE', { password: 'Delete1234' }), token),
    );
    expect(good.status).toBe(200);
    expect((await readJson(good)).deleted).toBe(true);

    const gone = await prisma.user.findUnique({ where: { id: userId } });
    expect(gone).toBeNull();

    const meAfter = await meGET(authed(new NextRequest('http://localhost/api/auth/me'), token));
    expect(meAfter.status).toBe(401);
  });
});
