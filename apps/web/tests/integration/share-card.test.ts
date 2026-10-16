/**
 * V20 Feature 7 — Shareable progress cards: contract tests.
 *
 * Pure-logic coverage for lib/share-card.ts (data selection never fabricates:
 * variants without backing records are unavailable, never zero-filled) plus
 * the canvas painter in components/ShareCard.tsx exercised against a stubbed
 * 2D context (no DOM in this node test environment).
 */
import { describe, expect, it } from "vitest";
import {
  buildMilestoneCardData,
  buildStreakCardData,
  buildWeightCardData,
  cardEyebrow,
  cardHeadline,
  cardSubline,
  describeCardAvailability,
  toDateOnlyLocal,
  variantLabel,
} from "@/lib/share-card";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  drawShareCard,
  paintCardToCanvas,
} from "@/components/ShareCard";
import { CARD_PALETTES, paletteForTheme } from "@/components/share-card-palette";

/* ------------------------------------------------------------------ */
/* Stubbed canvas                                                       */
/* ------------------------------------------------------------------ */

interface StubCall {
  method: string;
  args: unknown[];
}

function makeCtxStub(): { ctx: CanvasRenderingContext2D; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const gradient = { addColorStop: (..._a: unknown[]) => {} };
  const stub = new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        if (prop === "measureText") {
          return (text: string) => ({ width: String(text).length * 18 });
        }
        if (prop === "createRadialGradient" || prop === "createLinearGradient") {
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            return gradient;
          };
        }
        if (typeof prop === "string") {
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return undefined;
          };
        }
        return undefined;
      },
      set(_t, prop: string | symbol, value: unknown) {
        calls.push({ method: `set:${String(prop)}`, args: [value] });
        return true;
      },
    }
  );
  return { ctx: stub as unknown as CanvasRenderingContext2D, calls };
}

function makeCanvasLike() {
  const { ctx, calls } = makeCtxStub();
  return {
    calls,
    canvas: {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toDataURL: () => "data:image/png;base64,RkFLRQ==",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Weight journey                                                       */
/* ------------------------------------------------------------------ */

describe("buildWeightCardData", () => {
  it("builds a loss journey from real weigh-ins", () => {
    const data = buildWeightCardData([
      { date: "2026-08-31T08:00:00Z", kg: 88.4 },
      { date: "2026-10-12T08:00:00Z", kg: 84.2 },
    ]);
    expect(data).not.toBeNull();
    expect(data!.direction).toBe("lost");
    expect(data!.deltaKg).toBeCloseTo(-4.2, 5);
    expect(data!.weeks).toBe(6);
    expect(data!.points).toHaveLength(2);
    expect(cardHeadline(data!)).toBe("I lost 4.2 kg in 6 weeks");
  });

  it("detects a gain journey", () => {
    const data = buildWeightCardData([
      { date: "2026-09-01", kg: 70 },
      { date: "2026-09-15", kg: 71.5 },
    ]);
    expect(data!.direction).toBe("gained");
    expect(cardHeadline(data!)).toContain("I gained 1.5 kg");
  });

  it("detects a steady journey", () => {
    const data = buildWeightCardData([
      { date: "2026-09-01", kg: 80 },
      { date: "2026-09-08", kg: 80.03 },
    ]);
    expect(data!.direction).toBe("held");
    expect(cardHeadline(data!)).toContain("held steady");
  });

  it("returns null with fewer than 2 points — never zero-fills", () => {
    expect(buildWeightCardData([])).toBeNull();
    expect(buildWeightCardData([{ date: "2026-09-01", kg: 80 }])).toBeNull();
  });

  it("filters invalid points instead of fabricating", () => {
    const data = buildWeightCardData([
      { date: "2026-09-01", kg: 80 },
      { date: "not-a-date", kg: 79 },
      { date: "2026-09-10", kg: 0 },
      { date: "2026-09-20", kg: -5 },
      { date: "2026-09-15", kg: 79.2 },
    ]);
    expect(data).not.toBeNull();
    expect(data!.points.map((p) => p.date)).toEqual(["2026-09-01", "2026-09-15"]);
  });

  it("sorts unordered points chronologically", () => {
    const data = buildWeightCardData([
      { date: "2026-10-12", kg: 84.2 },
      { date: "2026-08-31", kg: 88.4 },
    ]);
    expect(data!.startKg).toBe(88.4);
    expect(data!.currentKg).toBe(84.2);
  });
});

/* ------------------------------------------------------------------ */
/* Streak                                                               */
/* ------------------------------------------------------------------ */

function isoDaysBack(today: Date, back: number[]): string[] {
  return back.map((b) => {
    const d = new Date(today);
    d.setDate(d.getDate() - b);
    return toDateOnlyLocal(d);
  });
}

describe("buildStreakCardData", () => {
  it("counts consecutive days ending today", () => {
    const today = new Date(2026, 9, 12, 12, 0, 0);
    const data = buildStreakCardData(
      isoDaysBack(today, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
      toDateOnlyLocal(today)
    );
    expect(data).not.toBeNull();
    expect(data!.days).toBe(12);
    expect(cardHeadline(data!)).toBe("12-day logging streak");
  });

  it("counts a streak ending yesterday (user may not have logged today yet)", () => {
    const today = new Date(2026, 9, 12, 12, 0, 0);
    const data = buildStreakCardData(
      isoDaysBack(today, [1, 2, 3]),
      toDateOnlyLocal(today)
    );
    expect(data!.days).toBe(3);
  });

  it("stops at a gap in the log", () => {
    const today = new Date(2026, 9, 12, 12, 0, 0);
    const data = buildStreakCardData(
      isoDaysBack(today, [0, 1, 3, 4, 5]),
      toDateOnlyLocal(today)
    );
    expect(data!.days).toBe(2);
  });

  it("returns null for a streak shorter than 2 days", () => {
    const today = new Date(2026, 9, 12, 12, 0, 0);
    expect(
      buildStreakCardData(isoDaysBack(today, [0]), toDateOnlyLocal(today))
    ).toBeNull();
    expect(
      buildStreakCardData(isoDaysBack(today, [5]), toDateOnlyLocal(today))
    ).toBeNull();
    expect(buildStreakCardData([], toDateOnlyLocal(today))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Milestone                                                            */
/* ------------------------------------------------------------------ */

describe("buildMilestoneCardData", () => {
  it("prefers workouts over other milestones", () => {
    const data = buildMilestoneCardData({
      workoutCount: 7,
      loggedDays: 20,
      totalKcal: 45000,
      timeframeLabel: "last 90 days",
    });
    expect(data!.kind).toBe("workouts");
    expect(cardHeadline(data!)).toBe("7 workouts completed");
  });

  it("falls back to days logged, then kcal tracked", () => {
    const days = buildMilestoneCardData({ workoutCount: 0, loggedDays: 20, totalKcal: 45000 });
    expect(days!.kind).toBe("days");
    expect(cardHeadline(days!)).toBe("20 days of meals logged");

    const kcal = buildMilestoneCardData({ workoutCount: 0, loggedDays: 0, totalKcal: 45200 });
    expect(kcal!.kind).toBe("kcal");
    expect(cardHeadline(kcal!)).toContain("kcal tracked");
  });

  it("returns null when nothing exists — never zero-fills", () => {
    expect(
      buildMilestoneCardData({ workoutCount: 0, loggedDays: 0, totalKcal: 0 })
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Availability                                                         */
/* ------------------------------------------------------------------ */

describe("describeCardAvailability", () => {
  it("marks every variant available when data exists", () => {
    const today = new Date(2026, 9, 12, 12, 0, 0);
    const list = describeCardAvailability({
      weights: [
        { date: "2026-08-31", kg: 88.4 },
        { date: "2026-10-12", kg: 84.2 },
      ],
      activeDays: isoDaysBack(today, [0, 1, 2]),
      workoutCount: 3,
      loggedDays: 5,
      totalKcal: 12000,
      // Pin "today" — the streak check otherwise uses the real current date
      // and this test rots as the calendar moves (date-bomb fixed 2026-10-15).
      todayIso: toDateOnlyLocal(today),
    });
    expect(list).toHaveLength(3);
    for (const entry of list) {
      expect(entry.data).not.toBeNull();
      expect(entry.needsNote).toBeNull();
    }
  });

  it("hides variants lacking data with an explanatory note", () => {
    const list = describeCardAvailability({
      weights: [],
      activeDays: [],
      workoutCount: 0,
      loggedDays: 0,
      totalKcal: 0,
    });
    expect(list).toHaveLength(3);
    for (const entry of list) {
      expect(entry.data).toBeNull();
      expect(entry.needsNote).toBeTruthy();
    }
    const weight = list.find((e) => e.variant === "weight")!;
    expect(weight.needsNote).toContain("weigh-ins");
  });

  it("labels and eyebrow/subline text is human, never placeholder", () => {
    expect(variantLabel("weight")).toBe("Weight journey");
    expect(cardEyebrow({ variant: "streak", days: 5 })).toBe("Consistency");
    const data = buildWeightCardData([
      { date: "2026-08-31", kg: 88.4 },
      { date: "2026-10-12", kg: 84.2 },
    ])!;
    expect(cardSubline(data)).toContain("88.4 kg");
    expect(cardSubline(data)).toContain("84.2 kg");
  });
});

/* ------------------------------------------------------------------ */
/* Palette                                                              */
/* ------------------------------------------------------------------ */

describe("card palettes", () => {
  const HEX = /^#[0-9a-f]{6}$/i;

  it("covers every concrete theme with valid hex tokens", () => {
    const keys = Object.keys(CARD_PALETTES);
    expect(keys).toHaveLength(7);
    for (const key of keys) {
      const p = CARD_PALETTES[key as keyof typeof CARD_PALETTES];
      for (const token of ["bg", "elevated", "accent", "accentMuted", "text", "textSecondary"] as const) {
        expect(p[token], `${key}.${token}`).toMatch(HEX);
      }
    }
  });

  it("dark and light variants differ in background", () => {
    expect(CARD_PALETTES["obsidian-gold"].bg).not.toBe(
      CARD_PALETTES["obsidian-gold-light"].bg
    );
    expect(CARD_PALETTES["midnight-emerald"].bg).not.toBe(
      CARD_PALETTES["midnight-emerald-light"].bg
    );
  });

  it("falls back to obsidian-gold for unknown themes", () => {
    expect(paletteForTheme("nope")).toEqual(CARD_PALETTES["obsidian-gold"]);
    expect(paletteForTheme("system")).toEqual(CARD_PALETTES["obsidian-gold"]);
  });
});

/* ------------------------------------------------------------------ */
/* Canvas painter                                                       */
/* ------------------------------------------------------------------ */

describe("drawShareCard", () => {
  const weightData = buildWeightCardData([
    { date: "2026-08-31", kg: 88.4 },
    { date: "2026-10-12", kg: 84.2 },
  ])!;
  const today = new Date(2026, 9, 12, 12, 0, 0);
  const streakData = buildStreakCardData(
    isoDaysBack(today, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    toDateOnlyLocal(today)
  )!;
  const milestoneData = buildMilestoneCardData({
    workoutCount: 7,
    loggedDays: 20,
    totalKcal: 45000,
  })!;

  it("paints the weight card without throwing and draws the headline", () => {
    const { ctx, calls } = makeCtxStub();
    expect(() =>
      drawShareCard(ctx, weightData, CARD_PALETTES["obsidian-gold"])
    ).not.toThrow();
    const texts = calls
      .filter((c) => c.method === "fillText")
      .map((c) => String(c.args[0]));
    expect(texts.some((t) => t.includes("I lost 4.2 kg"))).toBe(true);
    // The wordmark is drawn letter-tracked (one fillText per glyph), so
    // reconstruct the full string from single-character draws.
    const wordmark = texts.filter((t) => t.length === 1).join("");
    expect(wordmark).toContain("FitFusion AI");
    expect(texts.some((t) => t.includes("Rendered from my own logs"))).toBe(true);
  });

  it("paints the streak card without throwing", () => {
    const { ctx, calls } = makeCtxStub();
    expect(() =>
      drawShareCard(ctx, streakData, CARD_PALETTES["midnight-emerald"])
    ).not.toThrow();
    const texts = calls
      .filter((c) => c.method === "fillText")
      .map((c) => String(c.args[0]));
    expect(texts.some((t) => t.includes("12-day logging streak"))).toBe(true);
  });

  it("paints the milestone card without throwing", () => {
    const { ctx, calls } = makeCtxStub();
    expect(() =>
      drawShareCard(ctx, milestoneData, CARD_PALETTES["slate-silver-light"])
    ).not.toThrow();
    const texts = calls
      .filter((c) => c.method === "fillText")
      .map((c) => String(c.args[0]));
    expect(texts.some((t) => t.includes("7 workouts completed"))).toBe(true);
  });

  it("paints cleanly across every theme palette", () => {
    for (const key of Object.keys(CARD_PALETTES)) {
      const { ctx } = makeCtxStub();
      expect(() =>
        drawShareCard(
          ctx,
          weightData,
          CARD_PALETTES[key as keyof typeof CARD_PALETTES]
        )
      ).not.toThrow();
    }
  });

  it("has the Instagram-friendly 1080x1350 dimensions", () => {
    expect(CARD_WIDTH).toBe(1080);
    expect(CARD_HEIGHT).toBe(1350);
  });

  it("paintCardToCanvas sizes the canvas and produces a data URL", () => {
    const { canvas } = makeCanvasLike();
    const ok = paintCardToCanvas(canvas, streakData, CARD_PALETTES["light-luxe"]);
    expect(ok).toBe(true);
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1350);
    const url = canvas.toDataURL();
    expect(url.startsWith("data:image/png")).toBe(true);
  });
});
