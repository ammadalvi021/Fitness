/**
 * Voice-logging transcript parser (pure, no DOM).
 *
 * Turns a speech-to-text transcript like
 *   "two rotis and one katori of daal and a glass of mango shake"
 * into structured items the review screen can show back to the user.
 *
 * HONESTY RULES (binding):
 * - Quantities are NEVER invented. When the transcript does not state a
 *   quantity, `quantityInferred` is true and the review UI must show the
 *   "1 (assumed — please check)" flag so the user corrects it.
 * - Chunks we cannot make sense of land in `unparsed` so the user enters
 *   them manually instead of us guessing.
 * - Food matching is delegated to the caller's `findFood` (backed by
 *   /api/foods?q=). Without a match the item is flagged `needsReview`.
 */

export interface VoiceParsedItem {
  /** Food keywords exactly as parsed from the transcript (lowercased). */
  text: string;
  /** Stated quantity, or 1 when not stated (see quantityInferred). */
  quantity: number;
  /** Normalized unit word: roti|piece|katori|cup|glass|plate|bowl|tbsp|tsp|slice, or "" when none stated. */
  unit: string;
  /** True when the transcript did not state a quantity — review UI must flag. */
  quantityInferred: boolean;
  /** DB food id when matched via findFood; undefined otherwise. */
  foodId?: string;
  /** True when the item needs the user's attention before logging. */
  needsReview: boolean;
}

export interface VoiceParseResult {
  parsed: VoiceParsedItem[];
  /** Transcript chunks we could not interpret — user must enter manually. */
  unparsed: string[];
}

/** Resolve parsed food keywords to a food id (caller queries /api/foods?q=). */
export type FoodFinder = (keywords: string) => string | undefined;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Unit aliases -> canonical unit. Order matters: longer forms first. */
const UNIT_ALIASES: Array<[RegExp, string]> = [
  [/\b(tablespoons?|tbsp)\b/, 'tbsp'],
  [/\b(teaspoons?|tsp)\b/, 'tsp'],
  [/\b(chapatis?|chapathis?|rotis?)\b/, 'roti'],
  [/\b(katoris?)\b/, 'katori'],
  [/\b(bowls?)\b/, 'bowl'],
  [/\b(glass(es)?)\b/, 'glass'],
  [/\b(plates?)\b/, 'plate'],
  [/\b(cups?)\b/, 'cup'],
  [/\b(slices?)\b/, 'slice'],
  [/\b(pieces?)\b/, 'piece'],
];

const LEADING_QTY = new RegExp(
  `^(?:(${Object.keys(NUMBER_WORDS).join('|')})|(\\d+(?:\\.\\d+)?)|(a|an))(?:\\s+(.*))?$`,
);
const TRAILING_QTY = new RegExp(
  `^(.*?)\\s+(${Object.keys(NUMBER_WORDS).join('|')}|\\d+(?:\\.\\d+)?|a|an)\\s*$`,
);
const FILLER = /\b(of|some|with|and|the)\b/g;

/** Speech noise that carries no food meaning — treated as unparsed. */
const STOPWORDS = new Set(['um', 'uh', 'er', 'ah', 'hmm', 'mm', 'like']);

function qtyValue(word: string | undefined, digits: string | undefined, article: string | undefined): { qty: number; inferred: boolean } {
  if (word && NUMBER_WORDS[word] != null) return { qty: NUMBER_WORDS[word], inferred: false };
  if (digits) {
    const n = parseFloat(digits);
    if (Number.isFinite(n) && n > 0) return { qty: n, inferred: false };
  }
  if (article) return { qty: 1, inferred: false }; // "a"/"an" states one — not an invention
  return { qty: 1, inferred: true };
}

function extractUnit(s: string): { unit: string; rest: string } {
  for (const [re, canonical] of UNIT_ALIASES) {
    const m = s.match(re);
    if (m && m[0]) {
      const rest = (s.slice(0, m.index) + ' ' + s.slice((m.index ?? 0) + m[0].length))
        .replace(/\s+/g, ' ')
        .trim();
      return { unit: canonical, rest };
    }
  }
  return { unit: '', rest: s };
}

function cleanKeywords(s: string): string {
  return s
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse one chunk (already split on "and"/commas) into an item,
 * or return null when the chunk is unintelligible noise.
 *
 * Order: unit first ("chicken biryani one plate" -> plate), then a leading
 * ("two rotis") or trailing ("... one") quantity on what remains.
 */
function parseChunk(chunk: string, findFood?: FoodFinder): VoiceParsedItem | null {
  let s = chunk.toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 2) return null;

  const { unit, rest } = extractUnit(s);
  s = rest;

  let qty = 1;
  let inferred = true;

  // Leading quantity: "two rotis", "1.5 cups of rice", "a glass of mango shake"
  const m = s.match(LEADING_QTY);
  if (m) {
    const q = qtyValue(m[1], m[2], m[3]);
    qty = q.qty; inferred = q.inferred;
    s = (m[4] ?? '').trim();
  } else {
    // Trailing quantity: "chicken biryani one" (unit already stripped)
    const t = s.match(TRAILING_QTY);
    if (t && t[2]) {
      const word = t[2];
      const q = qtyValue(
        NUMBER_WORDS[word] != null ? word : undefined,
        /^\d/.test(word) ? word : undefined,
        /^(a|an)$/.test(word) ? word : undefined,
      );
      qty = q.qty; inferred = q.inferred;
      s = t[1].trim();
    }
  }

  let keywords = cleanKeywords(s);
  if (!keywords && unit) {
    // "two rotis" — the unit word itself is the food keyword.
    keywords = unit;
  }
  if (!keywords || STOPWORDS.has(keywords)) return null;

  const foodId = findFood?.(keywords);
  return {
    text: keywords,
    quantity: qty,
    unit,
    quantityInferred: inferred,
    ...(foodId ? { foodId } : {}),
    needsReview: !foodId || inferred,
  };
}

/**
 * Parse a full transcript. Splits on "and" / commas, then parses each chunk.
 */
export function parseVoiceTranscript(
  transcript: string,
  findFood?: FoodFinder,
): VoiceParseResult {
  const chunks = transcript
    .split(/\s+and\s+|,/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const parsed: VoiceParsedItem[] = [];
  const unparsed: string[] = [];
  for (const chunk of chunks) {
    const item = parseChunk(chunk, findFood);
    if (item) parsed.push(item);
    else unparsed.push(chunk.trim());
  }
  return { parsed, unparsed };
}

/** Browser feature detection for the Web Speech API. */
export function speechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w.SpeechRecognition === 'function' || typeof w.webkitSpeechRecognition === 'function';
}
