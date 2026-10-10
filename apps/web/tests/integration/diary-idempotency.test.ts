/**
 * (b) diary idempotency: two POSTs with the same Idempotency-Key
 * create exactly ONE row.
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@fitfusion/db';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as diaryPOST } from '@/app/api/diary/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

describe('diary idempotency', () => {
  afterAll(cleanupUsers);

  it('two POSTs with the same Idempotency-Key create exactly one row', async () => {
    const email = uniqueEmail('ff-idem');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const key = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      date: '2026-10-09',
      mealType: 'lunch',
      customName: 'Idempotency test bowl',
      servings: 1,
      kcal: 450,
      proteinG: 25,
    };

    const first = await diaryPOST(
      authed(
        jsonRequest('http://localhost/api/diary', 'POST', payload, { 'Idempotency-Key': key }),
        token,
      ),
    );
    expect(first.status).toBe(201);
    const firstBody = await readJson(first);
    expect(firstBody.entry.id).toBeTruthy();
    expect(firstBody.entry.kcal).toBe(450);

    // Exact same request again -> replay, no duplicate row.
    const second = await diaryPOST(
      authed(
        jsonRequest('http://localhost/api/diary', 'POST', payload, { 'Idempotency-Key': key }),
        token,
      ),
    );
    expect(second.status).toBe(200);
    const secondBody = await readJson(second);
    expect(secondBody.entry.id).toBe(firstBody.entry.id);
    expect(secondBody.idempotentReplay).toBe(true);

    const count = await prisma.diaryEntry.count({
      where: { userId, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it('recomputes nutrients server-side from Food (never trusts client totals)', async () => {
    const email = uniqueEmail('ff-food');
    const { userId, token } = await registerAndLogin(registerPOST, loginPOST, email);
    const food = await prisma.food.findFirstOrThrow();

    const res = await diaryPOST(
      authed(
        jsonRequest('http://localhost/api/diary', 'POST', {
          date: '2026-10-09',
          mealType: 'breakfast',
          foodId: food.id,
          servings: 2,
          kcal: 99999, // malicious/wrong client total — must be ignored
          proteinG: 99999,
        }),
        token,
      ),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.entry.kcal).toBeCloseTo(food.kcal * 2, 1);
    expect(body.entry.proteinG).toBeCloseTo(food.proteinG * 2, 1);

    await prisma.diaryEntry.deleteMany({ where: { userId } });
  });
});
