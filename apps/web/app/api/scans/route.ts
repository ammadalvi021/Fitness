import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { analyzeFoodImage } from '@fitfusion/ai';
import type { FoodScanItem } from '@fitfusion/ai';
import { requireUser } from '@/lib/auth';
import { IMAGE_MIMES, UploadError, saveUpload } from '@/lib/storage';
import { apiError, apiOk, clampInt } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const FOOD_SCAN_DISCLAIMER_FALLBACK =
  "Estimates only — a photo can't show exact portions, oils, or hidden ingredients.";

function toScanItems(items: FoodScanItem[]) {
  return items.map((i) => ({
    name: i.name,
    portion: i.portion,
    servings: 1,
    kcal: i.kcalBest,
    kcalLow: i.kcalLow,
    kcalHigh: i.kcalHigh,
    proteinG: i.proteinG,
    carbsG: i.carbsG,
    fatG: i.fatG,
    fiberG: i.fiberG ?? 0,
    confidence: i.confidence,
    assumptions: i.assumptions ?? [],
  }));
}

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 20, 1, 100);
  const scans = await prisma.foodScan.findMany({
    where: { userId: s.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return apiOk({ scans });
}

/**
 * Upload a food photo (multipart `image` field, ≤ UPLOAD_MAX_MB).
 * - AI not configured -> FoodScan {status:'not_configured'}, 200 {scan, aiConfigured:false}
 * - AI ok            -> FoodScan {status:'review', items},    200 {scan, aiConfigured:true}
 * - AI error         -> FoodScan {status:'failed'},           502 (no fabricated items)
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError('invalid_request', 'Expected multipart form data with an "image" field', 400);
  }
  const file = form.get('image');
  if (!(file instanceof File)) {
    return apiError('validation_error', 'Missing "image" file in form data', 400);
  }
  if (!IMAGE_MIMES.includes(file.type)) {
    return apiError('unsupported_media_type', `Unsupported image type: ${file.type || 'unknown'}`, 415);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let upload;
  try {
    upload = await saveUpload(buffer, { mime: file.type, prefix: 'scans' });
  } catch (e) {
    if (e instanceof UploadError) {
      return apiError(e.code, e.message, e.status);
    }
    throw e;
  }

  const result = await analyzeFoodImage(buffer.toString('base64'), file.type);

  if (result.status === 'not_configured') {
    const scan = await prisma.foodScan.create({
      data: {
        userId: s.user.id,
        imageUrl: upload.url,
        items: [],
        status: 'not_configured',
        provider: null,
      },
    });
    return apiOk({
      scan,
      aiConfigured: false,
      disclaimer: result.disclaimer ?? FOOD_SCAN_DISCLAIMER_FALLBACK,
    });
  }

  if (result.status === 'error') {
    await prisma.foodScan.create({
      data: {
        userId: s.user.id,
        imageUrl: upload.url,
        items: [],
        status: 'failed',
        provider: result.model,
      },
    });
    return apiError('ai_error', result.error ?? 'Food scan failed', 502);
  }

  const scan = await prisma.foodScan.create({
    data: {
      userId: s.user.id,
      imageUrl: upload.url,
      items: toScanItems(result.items),
      status: 'review',
      provider: result.model,
    },
  });
  return apiOk({
    scan,
    aiConfigured: true,
    disclaimer: result.disclaimer,
    overallConfidence: result.overallConfidence,
  });
}
