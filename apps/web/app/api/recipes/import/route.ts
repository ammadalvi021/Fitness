import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson } from '@/lib/server-api';
import { failureHttpStatus, importRecipeFromUrl } from '@/lib/recipe-import';

export const dynamic = 'force-dynamic';

/**
 * POST /api/recipes/import — import a recipe from a public web URL.
 * Body: { url: string }
 *
 * The pipeline SSRF-guards the fetch (http/https only, DNS-resolved
 * private-IP rejection on every redirect hop, 1.5 MB / 15 s / 3-redirect
 * caps), extracts readable text, and parses it with the AI provider.
 * Success → 200 { recipe: {title, ingredients[], servings, instructions[],
 * sourceUrl} }. Content/AI failures → 422 with a friendly message.
 * The client then shows a review screen and saves via the EXISTING
 * POST /api/recipes custom-recipe path (private to the user).
 */
export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const url = (body.data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string' || !url.trim()) {
    return apiError(
      'validation_error',
      'Paste a recipe URL to import.',
      400,
    );
  }

  const result = await importRecipeFromUrl(url.trim());
  if (!result.ok) {
    return apiError(
      result.code,
      result.message,
      failureHttpStatus(result.code),
    );
  }
  return apiOk({ recipe: result.recipe });
}
