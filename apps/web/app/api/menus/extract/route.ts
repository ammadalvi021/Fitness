import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { analyzeFoodImage } from '@fitfusion/ai';
import { requireUser } from '@/lib/auth';
import { UploadError } from '@/lib/storage';
import { extractValidatedImage } from '@/lib/image-validate';
import { saveOwnedUpload, tempRetentionMs } from '@/lib/uploads';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const EXTRACT_HINTS =
  'This is a photo of a RESTAURANT MENU (or an order / receipt screenshot), not a photo of food. ' +
  'Extract each dish/item name as it appears on the menu, in order. ' +
  'Do NOT estimate nutrition from the menu text — only identify the item names and any visible descriptions or prices. ' +
  'If text is blurry or unreadable, set confidence "low" and note it in assumptions. ' +
  'Never invent items that are not on the menu; put uncertain reads in "alternatives".';

/**
 * Upload a menu photo or order screenshot (multipart `image` field).
 * Returns the AI-extracted item names for the user to review and confirm —
 * nothing is written to any restaurant menu here.
 *
 * Hardening (v21.8 P4): same upload preamble as the food scanner — size cap
 * enforced before buffering (413), magic-byte + dimension validation
 * (spoofed types → 415, corrupt bytes → 400), and the AI call wrapped so a
 * throw becomes a clean 502 instead of an unhandled error.
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
    // Menu extracts are transient by retention policy: the extracted text
    // is returned to the client and no record keeps the image, so it
    // becomes purge-eligible after the configured temp window.
    upload = await saveOwnedUpload(prisma, s.user.id, buffer, {
      mime,
      prefix: 'menus',
      purpose: 'menu_extract',
      ttlMs: tempRetentionMs(),
    });
  } catch (e) {
    if (e instanceof UploadError) {
      return apiError(e.code, e.message, e.status);
    }
    throw e;
  }

  let result;
  try {
    result = await analyzeFoodImage(buffer.toString('base64'), mime, {
      hints: EXTRACT_HINTS,
    });
  } catch {
    // The upload is already transient (ttlMs above), so no orphan risk —
    // just return a clean error instead of an unhandled throw.
    return apiError('ai_error', 'Menu extraction failed', 502);
  }

  if (result.status === 'not_configured') {
    return apiOk({
      extracted: [],
      aiConfigured: false,
      imageUrl: upload.url,
      disclaimer: result.disclaimer,
    });
  }
  if (result.status === 'error') {
    return apiError('ai_error', result.error ?? 'Menu extraction failed', 502);
  }

  // Honesty: only names/descriptions/confidence/assumptions are surfaced.
  // Nutrition ranges from the vision model are NOT returned for menu text —
  // the user matches items to real food records (or marks them unavailable)
  // in the confirm step instead.
  return apiOk({
    extracted: result.items.map((i) => ({
      name: i.name,
      description: i.portion || null,
      confidence: i.confidence,
      assumptions: i.assumptions ?? [],
      alternatives: i.alternatives ?? [],
    })),
    aiConfigured: true,
    imageUrl: upload.url,
    disclaimer:
      'Extraction reads the menu text only — nutrition is never guessed from a menu photo.',
    overallConfidence: result.overallConfidence,
  });
}
