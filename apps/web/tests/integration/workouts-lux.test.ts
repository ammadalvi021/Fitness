/**
 * Unit tests for the luxury workout presentation helpers
 * (apps/web/app/(app)/workouts/_lux.ts).
 *
 * These helpers were extracted verbatim from the workout pages during the
 * Obsidian Gold presentation redesign; the tests pin their behavior so the
 * redesign can't silently change it.
 */
import { describe, expect, it } from "vitest";
import {
  formatClock,
  luxDifficultyTone,
  parseLeadingNumber,
} from "../../app/(app)/workouts/_lux";

describe("luxDifficultyTone", () => {
  it("maps known difficulties to LuxBadge tones", () => {
    expect(luxDifficultyTone("beginner")).toBe("success");
    expect(luxDifficultyTone("intermediate")).toBe("warning");
    expect(luxDifficultyTone("advanced")).toBe("error");
  });

  it("falls back to neutral for unknown or empty difficulties", () => {
    expect(luxDifficultyTone("expert")).toBe("neutral");
    expect(luxDifficultyTone("")).toBe("neutral");
  });
});

describe("formatClock", () => {
  it("formats sub-minute durations as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(65_000)).toBe("1:05");
  });

  it("formats minute-and-hour durations", () => {
    expect(formatClock(60_000)).toBe("1:00");
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(3_723_000)).toBe("1:02:03");
  });

  it("clamps negative input to zero", () => {
    expect(formatClock(-1_000)).toBe("0:00");
  });
});

describe("parseLeadingNumber", () => {
  it("parses plain and ranged reps/weight text", () => {
    expect(parseLeadingNumber("10")).toBe(10);
    expect(parseLeadingNumber("8-12")).toBe(8);
    expect(parseLeadingNumber("2.5")).toBe(2.5);
    expect(parseLeadingNumber("60 kg")).toBe(60);
  });

  it("returns 0 when no number is present", () => {
    expect(parseLeadingNumber("")).toBe(0);
    expect(parseLeadingNumber("bodyweight")).toBe(0);
  });
});
