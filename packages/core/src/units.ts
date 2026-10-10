/**
 * Unit conversions. Pure functions.
 */

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export function kgFromLb(lb: number): number {
  return lb * KG_PER_LB;
}

export function lbFromKg(kg: number): number {
  return kg / KG_PER_LB;
}

export function cmFromIn(inches: number): number {
  return inches * CM_PER_IN;
}

export function inFromCm(cm: number): number {
  return cm / CM_PER_IN;
}

export function cmFromFeetInches(ft: number, inches: number): number {
  return (ft * 12 + inches) * CM_PER_IN;
}
