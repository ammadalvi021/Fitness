import { aiStatus } from '@fitfusion/ai';
import { branding } from '../../../../../config/branding';
import { PLANS } from '../../../../../config/plans';
import { billingStatus } from '@/lib/billing';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Public runtime configuration: branding, plans, AI + billing status. */
export async function GET() {
  return apiOk({
    branding,
    plans: PLANS,
    ai: aiStatus(),
    billing: billingStatus(),
  });
}
