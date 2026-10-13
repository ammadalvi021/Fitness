/**
 * V20 Feature 4 — recipe URL importer.
 * All network and AI calls are mocked — no real HTTP, no real DNS, no AI key.
 * Route-level tests: unauthenticated (no DB needed) + authenticated
 * validation (DB-backed, skipped gracefully when PostgreSQL is unreachable).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { RecipeImportResponseSchema } from '@fitfusion/ai';
import {
  assertUrlSafe,
  extractReadableText,
  failureHttpStatus,
  fetchRecipeHtml,
  importRecipeFromUrl,
  isBlockedIp,
  RecipeImportError,
  type ImportFetch,
} from '@/lib/recipe-import';
import {
  buildCustomRecipePayload,
  guessGrams,
  recipeToReview,
  validateReview,
  type ImportedRecipe,
} from '@/lib/recipe-import-shared';
import { POST as importPOST } from '@/app/api/recipes/import/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import {
  authed,
  cleanupUsers,
  jsonRequest,
  readJson,
  registerAndLogin,
  uniqueEmail,
} from './helpers';
import { dbAvailable } from './db-guard';

const HAS_DB = await dbAvailable();

/* ------------------------------ mocks ------------------------------ */

const PUBLIC_IP = ['93.184.216.34'];
const publicResolve = async () => PUBLIC_IP;
const privateResolve = async () => ['10.9.8.7'];

function htmlResponse(
  html: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

const SAMPLE_HTML = `
<html><head><title>Best Moong Daal Recipe</title>
<script>window.ads = [];</script>
<style>body { color: red; }</style>
</head><body>
<header>Site navigation and ads</header>
<h1>Moong Daal Tadka</h1>
<p>A comforting yellow lentil dish, ready in 30 minutes. Serves 4.</p>
<h2>Ingredients</h2>
<ul><li>1 cup yellow moong daal</li><li>4 cups water</li><li>1 tsp salt</li></ul>
<h2>Instructions</h2>
<ol><li>Rinse the daal.</li><li>Boil until soft.</li><li>Add tarka and serve.</li></ol>
</body></html>`;

const mockRecipe: ImportedRecipe = {
  title: 'Moong Daal Tadka',
  servings: 4,
  sourceUrl: 'https://example.com/moong-daal',
  ingredients: [
    { name: 'Yellow moong daal', quantity: 1, unit: 'cup' },
    { name: 'Water', quantity: 4, unit: 'cups' },
    { name: 'Salt', quantity: 1, unit: 'tsp' },
  ],
  instructions: ['Rinse the daal.', 'Boil until soft.', 'Add tarka and serve.'],
};

const okDeps = (
  parseImpl?: NonNullable<Parameters<typeof importRecipeFromUrl>[1]>['parseImpl'],
) => ({
  fetchImpl: (async () => htmlResponse(SAMPLE_HTML)) as ImportFetch,
  resolveHost: publicResolve,
  ...(parseImpl ? { parseImpl } : {}),
});

/* ------------------------------ SSRF guards ------------------------------ */

describe('recipe-import SSRF guards', () => {
  it('blocks private / loopback / link-local / special IP literals', () => {
    for (const ip of [
      '10.0.0.5',
      '172.16.4.9',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fc00::9',
      'ff02::1',
      '::ffff:10.0.0.1',
      '::ffff:127.0.0.1',
      '224.0.0.1',
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it('allows real public IPs', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertUrlSafe(new URL('ftp://example.com/x'), publicResolve)).rejects.toThrow(
      RecipeImportError,
    );
    await expect(
      assertUrlSafe(new URL('javascript:alert(1)'), publicResolve),
    ).rejects.toThrow(RecipeImportError);
    await expect(
      assertUrlSafe(new URL('file:///etc/passwd'), publicResolve),
    ).rejects.toThrow(RecipeImportError);
  });

  it('rejects credentials embedded in the URL', async () => {
    await expect(
      assertUrlSafe(new URL('https://user:pass@example.com/'), publicResolve),
    ).rejects.toThrow(RecipeImportError);
  });

  it('rejects hostnames resolving to private IPs', async () => {
    await expect(
      assertUrlSafe(new URL('https://internal.example/'), privateResolve),
    ).rejects.toThrow(RecipeImportError);
  });

  it('rejects unresolvable hostnames', async () => {
    const failing = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertUrlSafe(new URL('https://nope.invalid/'), failing)).rejects.toThrow(
      RecipeImportError,
    );
  });

  it('allows a public http(s) URL', async () => {
    await expect(
      assertUrlSafe(new URL('https://example.com/recipe'), publicResolve),
    ).resolves.toBeUndefined();
  });
});

/* ------------------------------ fetch caps ------------------------------ */

describe('recipe-import fetch caps', () => {
  it('caps redirects at 3 (each hop re-guarded)', async () => {
    let calls = 0;
    const looping: ImportFetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: '/next' },
      });
    const guarded: ImportFetch = async (url, init) => {
      calls += 1;
      // prove the guard ran per hop: re-resolve check happens inside
      return looping(url, init);
    };
    const result = await importRecipeFromUrl('https://example.com/start', {
      fetchImpl: guarded,
      resolveHost: publicResolve,
      parseImpl: async () => ({ status: 'error', code: 'no_recipe', error: 'x' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('too_many_redirects');
      expect(result.message).toMatch(/redirect/i);
    }
    expect(calls).toBe(4); // initial + 3 redirects
  });

  it('re-checks redirect targets against the SSRF guard', async () => {
    const evil: ImportFetch = async (url) =>
      url.includes('start')
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/x' } })
        : htmlResponse(SAMPLE_HTML);
    // Redirect target resolves to link-local: use a resolver that answers
    // private for the metadata IP.
    const mixedResolve = async (host: string) =>
      host === '169.254.169.254' ? ['169.254.169.254'] : PUBLIC_IP;
    const result = await importRecipeFromUrl('https://example.com/start', {
      fetchImpl: evil,
      resolveHost: mixedResolve,
      parseImpl: async () => ({ status: 'error', code: 'no_recipe', error: 'x' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('blocked_url');
  });

  it('rejects bodies over ~1.5 MB', async () => {
    const big = 'x'.repeat(1_600_000);
    const result = await importRecipeFromUrl('https://example.com/big', {
      fetchImpl: (async () => htmlResponse(`<html><body>${big}</body></html>`)) as ImportFetch,
      resolveHost: publicResolve,
      parseImpl: async () => ({ status: 'error', code: 'no_recipe', error: 'x' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('too_large');
      expect(failureHttpStatus(result.code)).toBe(502);
    }
  });

  it('rejects non-HTML content types', async () => {
    const result = await importRecipeFromUrl('https://example.com/doc.pdf', {
      fetchImpl: (async () =>
        new Response('%PDF-1.4', {
          headers: { 'content-type': 'application/pdf' },
        })) as ImportFetch,
      resolveHost: publicResolve,
      parseImpl: async () => ({ status: 'error', code: 'no_recipe', error: 'x' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_html');
      expect(failureHttpStatus(result.code)).toBe(422);
    }
  });

  it('treats unreachable hosts and timeouts as friendly errors', async () => {
    const down: ImportFetch = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const r1 = await importRecipeFromUrl('https://example.com/x', {
      fetchImpl: down,
      resolveHost: publicResolve,
      parseImpl: async () => ({ status: 'error', code: 'no_recipe', error: 'x' }),
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.code).toBe('unreachable');
      expect(r1.message).toMatch(/couldn't reach/i);
      expect(failureHttpStatus(r1.code)).toBe(502);
    }

    const hanging: ImportFetch = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const r2 = await importRecipeFromUrl('https://example.com/slow', {
      fetchImpl: hanging,
      resolveHost: publicResolve,
      timeoutMs: 50,
      parseImpl: async () => ({ status: 'error', code: 'no_recipe', error: 'x' }),
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('unreachable');
  });

  it('sends a browser-ish User-Agent', async () => {
    let seenUA = '';
    const spy: ImportFetch = async (_url, init) => {
      seenUA = (init.headers as Record<string, string>)['User-Agent'] ?? '';
      return htmlResponse(SAMPLE_HTML);
    };
    await fetchRecipeHtml('https://example.com/x', {
      fetchImpl: spy,
      resolveHost: publicResolve,
    });
    expect(seenUA).toMatch(/Mozilla\/5\.0/);
  });
});

/* ------------------------------ text extraction ------------------------------ */

describe('extractReadableText', () => {
  it('strips scripts/styles and decodes entities', () => {
    const text = extractReadableText(SAMPLE_HTML);
    expect(text).toContain('Moong Daal Tadka');
    expect(text).toContain('A comforting yellow lentil dish');
    expect(text).not.toContain('window.ads');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('Site navigation and ads');
    expect(extractReadableText('<p>Fish &amp; chips &#8212; tasty</p>')).toContain(
      'Fish & chips — tasty',
    );
  });
});

/* ------------------------------ pipeline ------------------------------ */

describe('importRecipeFromUrl pipeline', () => {
  it('returns the parsed recipe on the happy path', async () => {
    const result = await importRecipeFromUrl(
      'https://example.com/moong-daal',
      okDeps(async () => ({ status: 'ok', recipe: mockRecipe })),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.title).toBe('Moong Daal Tadka');
      expect(result.recipe.ingredients).toHaveLength(3);
      expect(result.recipe.servings).toBe(4);
      expect(result.recipe.instructions).toHaveLength(3);
      expect(result.recipe.sourceUrl).toBe('https://example.com/moong-daal');
    }
  });

  it('empty page → 422 empty_page', async () => {
    const result = await importRecipeFromUrl(
      'https://example.com/blank',
      okDeps(async () => ({ status: 'ok', recipe: mockRecipe })),
    );
    // SAMPLE_HTML has text; override with an empty page:
    const empty = await importRecipeFromUrl('https://example.com/blank', {
      fetchImpl: (async () => htmlResponse('<html><body>   </body></html>')) as ImportFetch,
      resolveHost: publicResolve,
      parseImpl: async () => ({ status: 'ok', recipe: mockRecipe }),
    });
    expect(result.ok).toBe(true); // sanity: sample page is NOT empty
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.code).toBe('empty_page');
      expect(failureHttpStatus(empty.code)).toBe(422);
      expect(empty.message).toMatch(/no readable text/i);
    }
  });

  it('page with no recipe → friendly no_recipe error', async () => {
    const result = await importRecipeFromUrl(
      'https://example.com/blog',
      okDeps(async () => ({
        status: 'error',
        code: 'no_recipe',
        error: 'No recipe found in the page text',
      })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no_recipe');
      expect(failureHttpStatus(result.code)).toBe(422);
      expect(result.message).toMatch(/no recipe found/i);
    }
  });

  it('malformed AI JSON → friendly parse_failed error (never fabricated)', async () => {
    const result = await importRecipeFromUrl(
      'https://example.com/weird',
      okDeps(async () => ({
        status: 'error',
        code: 'parse_failed',
        error: 'Could not parse the AI response as JSON',
      })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('parse_failed');
      expect(failureHttpStatus(result.code)).toBe(422);
      expect(result.message).not.toMatch(/moong|daal/i);
    }
  });

  it('AI throwing → parse_failed, never partial data', async () => {
    const result = await importRecipeFromUrl('https://example.com/x', {
      fetchImpl: (async () => htmlResponse(SAMPLE_HTML)) as ImportFetch,
      resolveHost: publicResolve,
      parseImpl: async () => {
        throw new Error('boom');
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('parse_failed');
  });

  it('unconfigured AI → ai_unavailable (503)', async () => {
    const result = await importRecipeFromUrl(
      'https://example.com/x',
      okDeps(async () => ({
        status: 'not_configured',
        error: 'AI provider is not configured',
      })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ai_unavailable');
      expect(failureHttpStatus(result.code)).toBe(503);
      expect(result.message).toMatch(/AI service/i);
    }
  });

  it('rejects an injected parser result that fails shape validation', async () => {
    const bad = { ...mockRecipe, title: '' } as unknown as ImportedRecipe;
    const result = await importRecipeFromUrl(
      'https://example.com/x',
      okDeps(async () => ({ status: 'ok', recipe: bad })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('parse_failed');
  });

  it('invalid URL string → invalid_url (400)', async () => {
    const result = await importRecipeFromUrl('not a url', {
      fetchImpl: (async () => htmlResponse(SAMPLE_HTML)) as ImportFetch,
      resolveHost: publicResolve,
      parseImpl: async () => ({ status: 'ok', recipe: mockRecipe }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_url');
      expect(failureHttpStatus(result.code)).toBe(400);
    }
  });

  it('RecipeImportResponseSchema accepts found:true and found:false', () => {
    expect(
      RecipeImportResponseSchema.safeParse({
        found: true,
        title: 'X',
        ingredients: [{ name: 'Rice', quantity: 1, unit: 'cup' }],
        servings: 2,
        instructions: ['Cook.'],
      }).success,
    ).toBe(true);
    expect(RecipeImportResponseSchema.safeParse({ found: false }).success).toBe(true);
    expect(
      RecipeImportResponseSchema.safeParse({ found: true, title: '', ingredients: [] })
        .success,
    ).toBe(false);
  });
});

/* ------------------------------ review → save ------------------------------ */

describe('review-then-save', () => {
  it('prefills grams approximately from quantity × unit', () => {
    expect(guessGrams(1, 'cup')).toBe(240);
    expect(guessGrams(2, 'tbsp')).toBe(30);
    expect(guessGrams(1, 'g')).toBe(1);
    expect(guessGrams(0.5, 'kg')).toBe(500);
    expect(guessGrams(null, 'cup')).toBeNull();
    expect(guessGrams(1, null)).toBeNull();
    expect(guessGrams(1, 'bunches')).toBeNull();
    expect(guessGrams(0, 'cup')).toBeNull();
  });

  it('recipeToReview prefills editable grams', () => {
    const review = recipeToReview(mockRecipe);
    expect(review.title).toBe('Moong Daal Tadka');
    expect(review.servings).toBe('4');
    expect(review.ingredients[0].grams).toBe('240');
    expect(review.ingredients[1].grams).toBe('960');
    expect(review.ingredients[2].grams).toBe('5');
    expect(review.instructions).toContain('Boil until soft.');
  });

  it('validateReview catches missing title / no complete rows / bad servings', () => {
    const base = recipeToReview(mockRecipe);
    expect(validateReview(base)).toBeNull();
    expect(validateReview({ ...base, title: '  ' })).toMatch(/title/i);
    const noRows = {
      ...base,
      ingredients: base.ingredients.map((r) => ({ ...r, grams: '' })),
    };
    expect(validateReview(noRows)).toMatch(/at least one ingredient/i);
    expect(validateReview({ ...base, servings: '0' })).toMatch(/servings/i);
  });

  it('buildCustomRecipePayload preserves user edits verbatim', () => {
    const review = recipeToReview(mockRecipe);
    // The user edits everything on the review screen:
    review.title = 'Ammi’s Moong Daal';
    review.servings = '6';
    review.ingredients[0].grams = '250'; // corrected the approximation
    review.ingredients[1].grams = ''; // cleared → row dropped from save
    review.instructions = 'Boil the daal.\nAdd tarka and serve hot.';
    review.dietCategory = 'non_vegetarian';

    const payload = buildCustomRecipePayload(review);
    expect(payload.name).toBe('Ammi’s Moong Daal');
    expect(payload.portions).toBe(6);
    expect(payload.dietCategory).toBe('non_vegetarian');
    expect(payload.ingredients).toEqual([
      { name: 'Yellow moong daal', grams: 250 },
      { name: 'Salt', grams: 5 },
    ]);
    expect(payload.instructions).toEqual([
      'Boil the daal.',
      'Add tarka and serve hot.',
    ]);
  });
});

/* ------------------------------ route ------------------------------ */

describe('POST /api/recipes/import', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const req = jsonRequest('http://localhost/api/recipes/import', 'POST', {
      url: 'https://example.com/x',
    });
    const res = await importPOST(req as NextRequest);
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.error.code).toBe('unauthorized');
  });

  describe.skipIf(!HAS_DB)('authenticated', () => {
    let token = '';
    afterAll(async () => {
      await cleanupUsers();
    });

    it('validates a missing url with 400', async () => {
      ({ token } = await registerAndLogin(
        registerPOST,
        loginPOST,
        uniqueEmail('ff-v20ri'),
      ));
      const req = authed(
        jsonRequest('http://localhost/api/recipes/import', 'POST', { url: '' }),
        token,
      );
      const res = await importPOST(req as NextRequest);
      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body.error.code).toBe('validation_error');
    });
  });
});
