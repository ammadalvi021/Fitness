import { describe, expect, it } from 'vitest';
import { cmFromFeetInches, cmFromIn, inFromCm, kgFromLb, lbFromKg } from './units.js';

describe('units', () => {
  it('converts lb to kg with the exact factor', () => {
    expect(kgFromLb(1)).toBeCloseTo(0.45359237, 8);
    expect(kgFromLb(150)).toBeCloseTo(68.0388555, 6);
  });

  it('round-trips kg <-> lb', () => {
    expect(kgFromLb(lbFromKg(70))).toBeCloseTo(70, 10);
    expect(lbFromKg(kgFromLb(150))).toBeCloseTo(150, 10);
  });

  it('converts in <-> cm with the exact factor', () => {
    expect(cmFromIn(1)).toBe(2.54);
    expect(inFromCm(2.54)).toBe(1);
    expect(inFromCm(cmFromIn(72))).toBeCloseTo(72, 10);
  });

  it('converts feet+inches to cm', () => {
    expect(cmFromFeetInches(5, 10)).toBeCloseTo(177.8, 6);
    expect(cmFromFeetInches(6, 0)).toBeCloseTo(182.88, 6);
  });
});
