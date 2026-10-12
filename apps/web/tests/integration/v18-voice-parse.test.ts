/**
 * V18 Phase E: voice transcript parser — pure unit tests (no DB).
 */
import { describe, expect, it } from 'vitest';
import { parseVoiceTranscript } from '@/lib/voice-parse';

describe('parseVoiceTranscript', () => {
  it('parses number words + units ("two rotis")', () => {
    const r = parseVoiceTranscript('two rotis');
    expect(r.unparsed).toEqual([]);
    expect(r.parsed).toHaveLength(1);
    expect(r.parsed[0]).toMatchObject({
      text: 'roti',
      quantity: 2,
      unit: 'roti',
      quantityInferred: false,
    });
  });

  it('parses "one katori of daal"', () => {
    const r = parseVoiceTranscript('one katori of daal');
    expect(r.parsed).toHaveLength(1);
    expect(r.parsed[0]).toMatchObject({ text: 'daal', quantity: 1, unit: 'katori', quantityInferred: false });
  });

  it('parses "a glass of mango shake" (article = stated quantity 1)', () => {
    const r = parseVoiceTranscript('a glass of mango shake');
    expect(r.parsed).toHaveLength(1);
    expect(r.parsed[0]).toMatchObject({
      text: 'mango shake',
      quantity: 1,
      unit: 'glass',
      quantityInferred: false,
    });
  });

  it('parses trailing quantity ("chicken biryani one plate")', () => {
    const r = parseVoiceTranscript('chicken biryani one plate');
    expect(r.parsed).toHaveLength(1);
    expect(r.parsed[0]).toMatchObject({
      text: 'chicken biryani',
      quantity: 1,
      unit: 'plate',
      quantityInferred: false,
    });
  });

  it('parses digits and decimals ("1.5 cups of rice")', () => {
    const r = parseVoiceTranscript('1.5 cups of rice');
    expect(r.parsed[0]).toMatchObject({ text: 'rice', quantity: 1.5, unit: 'cup', quantityInferred: false });
  });

  it('splits on "and" and commas into separate items', () => {
    const r = parseVoiceTranscript('two rotis and one katori of daal, a glass of mango shake');
    expect(r.parsed).toHaveLength(3);
    expect(r.parsed.map((p) => p.text)).toEqual(['roti', 'daal', 'mango shake']);
  });

  it('NEVER invents quantities: missing quantity is flagged quantityInferred', () => {
    const r = parseVoiceTranscript('chicken biryani');
    expect(r.parsed).toHaveLength(1);
    expect(r.parsed[0].quantity).toBe(1);
    expect(r.parsed[0].quantityInferred).toBe(true);
    expect(r.parsed[0].needsReview).toBe(true);
  });

  it('flags unintelligible chunks as unparsed instead of guessing', () => {
    const r = parseVoiceTranscript('two rotis and um');
    expect(r.parsed).toHaveLength(1);
    expect(r.unparsed).toEqual(['um']);
  });

  it('wires findFood: matched items get foodId + no review flag', () => {
    const r = parseVoiceTranscript('two rotis and one katori of daal', (kw) =>
      kw === 'roti' ? 'food-roti-1' : undefined,
    );
    expect(r.parsed[0].foodId).toBe('food-roti-1');
    expect(r.parsed[0].needsReview).toBe(false);
    expect(r.parsed[1].foodId).toBeUndefined();
    expect(r.parsed[1].needsReview).toBe(true);
  });

  it('normalizes plural units and tbsp/tsp', () => {
    const r = parseVoiceTranscript('2 tablespoons of peanut butter and 3 slices of bread');
    expect(r.parsed[0]).toMatchObject({ unit: 'tbsp', quantity: 2, text: 'peanut butter' });
    expect(r.parsed[1]).toMatchObject({ unit: 'slice', quantity: 3, text: 'bread' });
  });

  it('handles empty transcript without crashing', () => {
    const r = parseVoiceTranscript('   ');
    expect(r.parsed).toEqual([]);
    expect(r.unparsed).toEqual([]);
  });
});
