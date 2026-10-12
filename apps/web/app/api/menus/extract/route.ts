import { NextRequest, NextResponse } from 'next/server';
import { analyzeFoodImage } from '@fitfusion/ai';
import { requireUser } from '@/lib/auth';
import { IMAGE_MIMES, UploadError, saveUpload } from '@/lib/storage';
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
    upload = await saveUpload(buffer, { mime: file.type, prefix: 'menus' });
  } catch (e) {
    if (e instanceof UploadError) {
      return apiError(e.code, e.message, e.status);
    }
    throw e;
  }

  const result = await analyzeFoodImage(buffer.toString('base64'), file.type, {
    hints: EXTRACT_HINTS,
  });

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
