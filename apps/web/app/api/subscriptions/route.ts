import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { billingStatus, selectPlan, BillingError } from '@/lib/billing';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const SelectPlanSchema = z.object({ planId: z.string().min(1) });

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const subscription =
    s.subscription ??
    (await prisma.subscription.upsert({
      where: { userId: s.user.id },
      update: {},
      create: { userId: s.user.id, planId: 'free', status: 'active' },
    }));
  return apiOk({ subscription, billing: billingStatus() });
}

/**
 * Record a plan selection. Billing only ever happens through a configured
 * provider — see the `charged` / `testMode` / `note` fields in the response.
 * Paid plans require Stripe checkout (HTTP 402 `payment_required`); they are
 * never granted by this endpoint.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = SelectPlanSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }
  try {
    const result = await selectPlan(s.user.id, parsed.data.planId);
    return apiOk(result);
  } catch (e) {
    if (e instanceof BillingError) {
      return apiError(e.code, e.message, e.status);
    }
    const code = e instanceof Error ? e.message : 'unknown';
    if (code === 'unknown_plan') {
      return apiError('unknown_plan', `Unknown plan id: ${parsed.data.planId}`, 400);
    }
    if (code === 'plan_unavailable') {
      return apiError('plan_unavailable', 'This plan is not currently available', 400);
    }
    throw e;
  }
}
