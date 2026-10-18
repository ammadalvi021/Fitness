import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { analyzeFoodImage } from '@fitfusion/ai';
import type { FoodScanItem } from '@fitfusion/ai';
import { requireUser } from '@/lib/auth';
import { UploadError } from '@/lib/storage';
import { extractValidatedImage } from '@/lib/image-validate';
import {
  markUploadTemporary,
  saveOwnedUpload,
  tempRetentionMs,
} from '@/lib/uploads';
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
 *
 * Hardening (v21.8 P4): the size cap is enforced BEFORE the full buffer is
 * allocated (Content-Length up front, then a capped stream read → 413), and
 * the bytes must carry real JPEG/PNG/WEBP magic with decodable dimensions —
 * `File.type` alone is not trusted (spoofed types → 415, corrupt bytes → 400).
 *
 * Failure hygiene: if the AI layer throws or the scan row cannot be
 * written, the already-saved upload is marked temporary (purge-eligible)
 * instead of being orphaned as a permanent file, and the client gets a
 * clean 5xx — never a partial success.
 *
 * - AI not configured -> FoodScan {status:'not_configured'}, 200 {scan, aiConfigured:false}
 * - AI ok            -> FoodScan {status:'review', items},    200 {scan, aiConfigured:true}
 * - AI error         -> FoodScan {status:'failed'},           502 (no fabricated items)
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;

  let input;
  try {
    input = await extractValidatedImage(req, 'image');
  } catch (e) {
    if (e instanceof UploadError) {
      return apiError(e.code, e.message, e.status);
    }
    throw e;
  }
  const { buffer, mime } = input;

  let upload;
  try {
    upload = await saveOwnedUpload(prisma, s.user.id, buffer, {
      mime,
      prefix: 'scans',
      purpose: 'scan',
    });
  } catch (e) {
    if (e instanceof UploadError) {
      return apiError(e.code, e.message, e.status);
    }
    throw e;
  }

  let result;
  try {
    result = await analyzeFoodImage(buffer.toString('base64'), mime);
  } catch {
    // The AI layer threw instead of returning a status: don't orphan the
    // upload as a permanent file — mark it temporary for the purge job.
    await markUploadTemporary(prisma, upload.key, tempRetentionMs());
    return apiError('ai_error', 'Food scan failed', 502);
  }

  if (result.status === 'not_configured' || result.status === 'error') {
    // Transient by retention policy: a scan that produced no analysis has
    // no lasting user value, so it becomes purge-eligible after the
    // configured temp window (the failed scan row itself is kept for
    // context; its image disappears on the next retention sweep).
    await markUploadTemporary(prisma, upload.key, tempRetentionMs());
  }

  // Build the scan row first so every branch below shares one guarded write.
  type FoodScanCreateData = Parameters<typeof prisma.foodScan.create>[0]['data'];
  let scanData: FoodScanCreateData;
  let respond: (scan: unknown) => NextResponse;
  if (result.status === 'not_configured') {
    scanData = {
      userId: s.user.id,
      imageUrl: upload.url,
      items: [],
      status: 'not_configured',
      provider: null,
    };
    respond = (scan) =>
      apiOk({
        scan,
        aiConfigured: false,
        disclaimer: result.disclaimer ?? FOOD_SCAN_DISCLAIMER_FALLBACK,
      });
  } else if (result.status === 'error') {
    scanData = {
      userId: s.user.id,
      imageUrl: upload.url,
      items: [],
      status: 'failed',
      provider: result.model,
    };
    respond = () => apiError('ai_error', result.error ?? 'Food scan failed', 502);
  } else {
    scanData = {
      userId: s.user.id,
      imageUrl: upload.url,
      items: toScanItems(result.items),
      status: 'review',
      provider: result.model,
    };
    respond = (scan) =>
      apiOk({
        scan,
        aiConfigured: true,
        disclaimer: result.disclaimer,
        overallConfidence: result.overallConfidence,
      });
  }

  let scan;
  try {
    scan = await prisma.foodScan.create({ data: scanData });
  } catch {
    // The scan row could not be written: the upload has no owning record,
    // so mark it temporary rather than leaving a permanent orphan.
    await markUploadTemporary(prisma, upload.key, tempRetentionMs());
    return apiError('database_error', 'Could not save the food scan', 500);
  }
  return respond(scan);
}
