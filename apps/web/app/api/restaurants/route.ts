import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const manualSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  city: z.string().trim().min(1, 'City is required').max(120),
  address: z.string().trim().max(500).optional().default(''),
});

/**
 * POST /api/restaurants — manually add a restaurant (provider:'manual').
 * This is the fallback path when no Places provider is configured, so the
 * feature stays useful without an API key. Menus attach to it in Phase D.
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  const rl = checkRateLimit(`restaurants:create:${s.user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return apiError('rate_limited', 'Too many requests — please wait a moment.', 429);
  }

  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  const result = manualSchema.safeParse(parsed.data);
  if (!result.success) {
    return apiError('validation_error', zodMessage(result.error), 400);
  }

  const r = await prisma.restaurant.create({
    data: {
      provider: 'manual',
      providerPlaceId: null,
      name: result.data.name,
      city: result.data.city,
      address: result.data.address || null,
      country: null,
      lastCheckedAt: new Date(),
    },
  });

  return apiOk(
    {
      restaurant: {
        id: r.id,
        provider: r.provider,
        name: r.name,
        address: r.address,
        city: r.city,
        country: r.country,
        latitude: r.latitude,
        longitude: r.longitude,
        rating: r.rating,
        priceLevel: r.priceLevel,
        website: r.website,
        menuUrl: r.menuUrl,
      },
    },
    201,
  );
}
