/**
 * Recipe URL importer — server-side pipeline.
 *
 * SSRF-safe page fetch (scheme allow-list, DNS resolution + private-IP
 * rejection on every hop, redirect/size/time caps, browser-ish User-Agent),
 * lightweight HTML → text extraction, AI parsing via @fitfusion/ai.
 *
 * NEVER-FABRICATE RULE: every failure path returns a friendly error code —
 * the pipeline NEVER guesses ingredients, quantities, or steps.
 *
 * Server-only: imports node:dns and the AI package (reads AI_API_KEY).
 * Do NOT import from client components.
 */
import { lookup } from 'node:dns/promises';
import {
  parseRecipePageAI,
  RecipeImportResponseSchema,
  type RecipeImportParseResult,
} from '@fitfusion/ai';
import type { ImportedRecipe } from './recipe-import-shared';

export type { ImportedRecipe } from './recipe-import-shared';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Max page body accepted: ~1.5 MB. */
export const RECIPE_IMPORT_MAX_BYTES = 1_500_000;
/** Per-request timeout. */
export const RECIPE_IMPORT_TIMEOUT_MS = 15_000;
/** Max redirects followed (each hop re-checked by the SSRF guards). */
export const RECIPE_IMPORT_MAX_REDIRECTS = 3;
/** Readable-text budget handed to the AI. */
export const RECIPE_IMPORT_TEXT_BUDGET = 12_000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ */
/* Failure codes + friendly messages                                   */
/* ------------------------------------------------------------------ */

export type RecipeImportFailureCode =
  | 'invalid_url'
  | 'blocked_url'
  | 'unreachable'
  | 'too_many_redirects'
  | 'too_large'
  | 'not_html'
  | 'empty_page'
  | 'no_recipe'
  | 'parse_failed'
  | 'ai_unavailable';

export interface RecipeImportSuccess {
  ok: true;
  recipe: ImportedRecipe;
}
export interface RecipeImportFailure {
  ok: false;
  code: RecipeImportFailureCode;
  message: string;
}
export type RecipeImportResult = RecipeImportSuccess | RecipeImportFailure;

const FRIENDLY: Record<RecipeImportFailureCode, string> = {
  invalid_url:
    "That doesn't look like a valid web address. Paste a full URL starting with http:// or https://.",
  blocked_url:
    "That URL can't be imported — it uses an unsupported scheme or points to a private/internal address.",
  unreachable:
    "Couldn't reach that page. Check the URL and try again in a moment.",
  too_many_redirects:
    'That page redirected too many times. Try pasting the final destination URL.',
  too_large: 'That page is too large to import (over ~1.5 MB).',
  not_html:
    "That link didn't return a web page (expected HTML) — it may be a PDF, image, or download.",
  empty_page: 'That page had no readable text to import.',
  no_recipe:
    'No recipe found on that page. Try a page that lists ingredients and instructions.',
  parse_failed:
    "The AI couldn't make sense of this page as a recipe. Try a different page.",
  ai_unavailable:
    'Recipe importing needs the AI service, which isn’t configured on this server yet.',
};

/** HTTP status for a failure code (422 for content/parse problems, per spec). */
export function failureHttpStatus(code: RecipeImportFailureCode): number {
  switch (code) {
    case 'invalid_url':
    case 'blocked_url':
      return 400;
    case 'unreachable':
    case 'too_many_redirects':
    case 'too_large':
      return 502;
    case 'ai_unavailable':
      return 503;
    default:
      return 422;
  }
}

/* ------------------------------------------------------------------ */
/* SSRF guards: private / loopback / link-local IP rejection           */
/* ------------------------------------------------------------------ */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inCidr4(ipInt: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base);
  if (b === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (b & mask);
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this host"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local (incl. cloud metadata)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

/** Parse an IPv6 literal into a 128-bit bigint. Returns null when invalid. */
function ipv6ToBigint(ip: string): bigint | null {
  const addr = ip.split('%')[0]; // strip zone id
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  // Handle embedded IPv4 (e.g. ::ffff:1.2.3.4).
  const expand = (parts: string[]): string[] => {
    const out: string[] = [];
    for (const p of parts) {
      if (p.includes('.')) {
        const v4 = ipv4ToInt(p);
        if (v4 === null) return [];
        out.push(((v4 >>> 16) & 0xffff).toString(16));
        out.push((v4 & 0xffff).toString(16));
      } else {
        out.push(p);
      }
    }
    return out;
  };
  const l = expand(left);
  const r = expand(right);
  if (l.length === 0 && left.length > 0) return null;
  if (r.length === 0 && right.length > 0) return null;
  const missing = 8 - l.length - r.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...l, ...Array(Math.max(0, missing)).fill('0'), ...r];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
}

function inCidr6(ip: bigint, base: string, bits: number): boolean {
  const b = ipv6ToBigint(base);
  if (b === null) return false;
  const shift = 128n - BigInt(bits);
  return (ip >> shift) === (b >> shift);
}

const BLOCKED_V6: Array<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // IPv4/IPv6 translation
  ['100::', 64], // discard
  ['2001::', 23], // special-purpose
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];

/** True when the IP literal is private, loopback, link-local, or otherwise non-public. */
export function isBlockedIp(ip: string): boolean {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return BLOCKED_V4.some(([b, bits]) => inCidr4(v4, b, bits));
  const v6 = ipv6ToBigint(ip);
  if (v6 === null) return true; // not a parseable literal → treat as blocked
  // IPv4-mapped IPv6 (::ffff:a.b.c.d): check the embedded IPv4 too.
  if ((v6 >> 32n) === 0xffffn) {
    const embedded = Number(v6 & 0xffffffffn);
    if (BLOCKED_V4.some(([b, bits]) => inCidr4(embedded, b, bits))) return true;
  }
  return BLOCKED_V6.some(([b, bits]) => inCidr6(v6, b, bits));
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

const defaultResolveHost: ResolveHost = async (hostname) => {
  const addrs = await lookup(hostname, { all: true });
  return addrs.map((a) => a.address);
};

/**
 * SSRF gate for one URL: http/https only, no credentials in the URL, and
 * every DNS-resolved address must be public. Throws RecipeImportError on
 * any violation.
 */
export async function assertUrlSafe(
  url: URL,
  resolveHost: ResolveHost = defaultResolveHost,
): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RecipeImportError('blocked_url', FRIENDLY.blocked_url);
  }
  if (url.username || url.password) {
    throw new RecipeImportError('blocked_url', FRIENDLY.blocked_url);
  }
  if (!url.hostname) {
    throw new RecipeImportError('invalid_url', FRIENDLY.invalid_url);
  }
  let ips: string[];
  try {
    ips = await resolveHost(url.hostname);
  } catch {
    throw new RecipeImportError(
      'blocked_url',
      'That address couldn’t be resolved to a public server.',
    );
  }
  if (!ips.length || ips.some(isBlockedIp)) {
    throw new RecipeImportError('blocked_url', FRIENDLY.blocked_url);
  }
}

export class RecipeImportError extends Error {
  readonly code: RecipeImportFailureCode;
  constructor(code: RecipeImportFailureCode, message?: string) {
    super(message ?? FRIENDLY[code]);
    this.name = 'RecipeImportError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Capped fetch                                                        */
/* ------------------------------------------------------------------ */

export type ImportFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

async function readBodyCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > RECIPE_IMPORT_MAX_BYTES) {
      throw new RecipeImportError('too_large');
    }
    return new TextDecoder().decode(buf);
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > RECIPE_IMPORT_MAX_BYTES) {
        throw new RecipeImportError('too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Fetch a page's HTML with all safety caps. Follows up to
 * RECIPE_IMPORT_MAX_REDIRECTS redirects manually so every hop passes the
 * SSRF gate (fetch's built-in redirect handling would not).
 */
export async function fetchRecipeHtml(
  urlString: string,
  deps: {
    fetchImpl?: ImportFetch;
    resolveHost?: ResolveHost;
    timeoutMs?: number;
  } = {},
): Promise<{ html: string; finalUrl: string }> {
  const fetchImpl: ImportFetch = deps.fetchImpl ?? fetch;
  const resolveHost = deps.resolveHost ?? defaultResolveHost;
  const timeoutMs = deps.timeoutMs ?? RECIPE_IMPORT_TIMEOUT_MS;

  let current: URL;
  try {
    current = new URL(urlString);
  } catch {
    throw new RecipeImportError('invalid_url');
  }

  let redirects = 0;
  for (;;) {
    await assertUrlSafe(current, resolveHost);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': BROWSER_UA,
        },
      });
    } catch (err) {
      throw new RecipeImportError(
        'unreachable',
        err instanceof DOMException && err.name === 'AbortError'
          ? 'That page took too long to respond. Try again.'
          : FRIENDLY.unreachable,
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new RecipeImportError('unreachable');
      if (redirects >= RECIPE_IMPORT_MAX_REDIRECTS) {
        throw new RecipeImportError('too_many_redirects');
      }
      redirects += 1;
      try {
        current = new URL(location, current.toString());
      } catch {
        throw new RecipeImportError('unreachable');
      }
      continue;
    }

    if (!res.ok) {
      throw new RecipeImportError(
        'unreachable',
        `That page returned an error (HTTP ${res.status}). Check the URL and try again.`,
      );
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (
      !/text\/html|application\/xhtml\+xml/i.test(contentType) &&
      contentType.trim() !== ''
    ) {
      throw new RecipeImportError('not_html');
    }

    const html = await readBodyCapped(res);
    return { html, finalUrl: current.toString() };
  }
}

/* ------------------------------------------------------------------ */
/* HTML → readable text (lightweight, dependency-free)                  */
/* ------------------------------------------------------------------ */

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = Number(d);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000
        ? String.fromCodePoint(cp)
        : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000
        ? String.fromCodePoint(cp)
        : _;
    })
    .replace(/&([a-zA-Z]+);/g, (_, name) =>
      ENTITY_MAP[name.toLowerCase()] !== undefined
        ? ENTITY_MAP[name.toLowerCase()]
        : _,
    );
}

/**
 * Strip scripts/styles/noise and tags, returning the page's readable text.
 * DOM-free: regex-based, capped at RECIPE_IMPORT_TEXT_BUDGET chars.
 */
export function extractReadableText(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
  let t = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(header|footer|nav|aside)[\s>][\s\S]*?<\/\1\s*>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t).replace(/\s+/g, ' ').trim();
  const combined = title && !t.toLowerCase().startsWith(title.toLowerCase())
    ? `${title}. ${t}`
    : t;
  return combined.slice(0, RECIPE_IMPORT_TEXT_BUDGET);
}

/* ------------------------------------------------------------------ */
/* Full pipeline                                                       */
/* ------------------------------------------------------------------ */

export type ParseRecipe = (
  text: string,
  pageUrl: string,
) => Promise<RecipeImportParseResult>;

const defaultParse: ParseRecipe = (text, pageUrl) =>
  parseRecipePageAI(text, pageUrl);

/**
 * Import a recipe from a URL: safe-fetch → extract text → AI parse →
 * shape-validate. Returns {ok:true, recipe} or {ok:false, code, message}.
 * Never throws for expected failures; never fabricates recipe data.
 */
export async function importRecipeFromUrl(
  url: string,
  deps: {
    fetchImpl?: ImportFetch;
    resolveHost?: ResolveHost;
    parseImpl?: ParseRecipe;
    timeoutMs?: number;
  } = {},
): Promise<RecipeImportResult> {
  const parseImpl = deps.parseImpl ?? defaultParse;
  let html: string;
  let finalUrl: string;
  try {
    ({ html, finalUrl } = await fetchRecipeHtml(url, deps));
  } catch (err) {
    if (err instanceof RecipeImportError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, code: 'unreachable', message: FRIENDLY.unreachable };
  }

  const text = extractReadableText(html);
  if (text.replace(/\s/g, '').length < 50) {
    return { ok: false, code: 'empty_page', message: FRIENDLY.empty_page };
  }

  let parsed: RecipeImportParseResult;
  try {
    parsed = await parseImpl(text, finalUrl);
  } catch {
    return { ok: false, code: 'parse_failed', message: FRIENDLY.parse_failed };
  }

  if (parsed.status === 'not_configured') {
    return { ok: false, code: 'ai_unavailable', message: FRIENDLY.ai_unavailable };
  }
  if (parsed.status === 'error') {
    if (parsed.code === 'no_recipe') {
      return { ok: false, code: 'no_recipe', message: FRIENDLY.no_recipe };
    }
    return { ok: false, code: 'parse_failed', message: FRIENDLY.parse_failed };
  }

  // Re-validate the shape (belt-and-braces for injected/mocked parsers).
  const checked = RecipeImportResponseSchema.safeParse({
    found: true,
    title: parsed.recipe.title,
    ingredients: parsed.recipe.ingredients,
    servings: parsed.recipe.servings,
    instructions: parsed.recipe.instructions,
  });
  if (!checked.success || !checked.data.found) {
    return { ok: false, code: 'parse_failed', message: FRIENDLY.parse_failed };
  }
  return {
    ok: true,
    recipe: {
      title: checked.data.title,
      ingredients: checked.data.ingredients.map((i) => ({
        name: i.name,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
      })),
      servings: checked.data.servings,
      instructions: checked.data.instructions,
      sourceUrl: finalUrl,
    },
  };
}
