import { PLANS } from '../../../../../config/plans';
import { apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Public plan catalog. */
export async function GET() {
  return apiOk({ plans: PLANS });
}
