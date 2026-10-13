/**
 * DailyWeighIn — once-per-day prompt logic.
 *
 * The component itself is client-side; these tests pin the date rules it
 * relies on: the dismissal key rolls over at local midnight, and a weight
 * recorded today suppresses the prompt.
 */
import { describe, expect, it } from "vitest";

function storageKeyFor(d: Date): string {
  return `ff-weighin-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isRecordedToday(iso: string, now = new Date()): boolean {
  const r = new Date(iso);
  return (
    r.getFullYear() === now.getFullYear() &&
    r.getMonth() === now.getMonth() &&
    r.getDate() === now.getDate()
  );
}

describe("daily weigh-in prompt logic", () => {
  it("key rolls over at local midnight", () => {
    const before = new Date(2026, 9, 13, 23, 59, 59);
    const after = new Date(2026, 9, 14, 0, 0, 1);
    expect(storageKeyFor(before)).not.toBe(storageKeyFor(after));
  });

  it("same-day key is stable across the day", () => {
    expect(storageKeyFor(new Date(2026, 9, 13, 6, 30))).toBe(
      storageKeyFor(new Date(2026, 9, 13, 22, 15)),
    );
  });

  it("weight recorded today suppresses the prompt", () => {
    const now = new Date(2026, 9, 13, 9, 0);
    const recorded = new Date(2026, 9, 13, 7, 12).toISOString();
    expect(isRecordedToday(recorded, now)).toBe(true);
  });

  it("weight recorded yesterday does not suppress", () => {
    const now = new Date(2026, 9, 13, 9, 0);
    const recorded = new Date(2026, 9, 12, 20, 0).toISOString();
    expect(isRecordedToday(recorded, now)).toBe(false);
  });

  it("rejects invalid weight input", () => {
    const valid = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 500;
    };
    expect(valid("72.5")).toBe(true);
    expect(valid("")).toBe(false);
    expect(valid("-5")).toBe(false);
    expect(valid("abc")).toBe(false);
    expect(valid("9999")).toBe(false);
  });
});
