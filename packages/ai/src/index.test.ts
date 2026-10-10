/**
 * Guards for the never-fabricate rule: with no AI_API_KEY, every AI function
 * must return { status: 'not_configured' } and make no network call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiStatus,
  analyzeFoodImage,
  coachReply,
  extractJsonObject,
  generateMealPlanAI,
  suggestRecipesAI,
} from "./index";

const BASE_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...BASE_ENV };
  delete process.env.AI_API_KEY;
  vi.restoreAllMocks();
});

describe("aiStatus", () => {
  it("reports chat=false/vision=false with no key", () => {
    process.env.AI_MODEL = "gpt-4o-mini";
    process.env.AI_VISION_MODEL = "gpt-4o-mini";
    const s = aiStatus();
    expect(s.chat).toBe(false);
    expect(s.vision).toBe(false);
    expect(s.provider).toBeNull();
    expect(s.models.chat).toBeNull();
    expect(s.models.vision).toBeNull();
  });

  it("reports capabilities when key + models are set", () => {
    process.env.AI_API_KEY = "sk-test";
    process.env.AI_MODEL = "gpt-4o-mini";
    process.env.AI_VISION_MODEL = "gpt-4o-vision";
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    const s = aiStatus();
    expect(s.chat).toBe(true);
    expect(s.vision).toBe(true);
    expect(s.provider).toBe("https://api.openai.com/v1");
    expect(s.models.chat).toBe("gpt-4o-mini");
    expect(s.models.vision).toBe("gpt-4o-vision");
  });
});

describe("not_configured gate", () => {
  it("never makes a network call without a key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const scan = await analyzeFoodImage("aGVsbG8=", "image/jpeg");
    const plan = await generateMealPlanAI({}, { calorieTarget: 2000 });
    const recipes = await suggestRecipesAI({});
    const coach = await coachReply([{ role: "user", content: "hi" }], "");
    expect(scan.status).toBe("not_configured");
    expect(scan.items).toEqual([]);
    expect(plan.status).toBe("not_configured");
    expect(recipes.status).toBe("not_configured");
    expect(coach.status).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("includes the disclaimer on scan results even when not configured", async () => {
    const scan = await analyzeFoodImage("aGVsbG8=", "image/jpeg");
    expect(scan.disclaimer).toContain("Estimates only");
  });
});

describe("extractJsonObject", () => {
  it("unwraps markdown fences", () => {
    const out = extractJsonObject('```json\n{"a":1}\n```') as { a: number };
    expect(out.a).toBe(1);
  });

  it("throws on non-JSON text so callers can return an honest error", () => {
    expect(() => extractJsonObject("sorry, no food here")).toThrow();
  });
});
