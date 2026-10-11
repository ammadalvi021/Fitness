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

describe("AIProviderError + friendlyAIMessage", () => {
  it("maps 503 to a friendly retryable busy message", async () => {
    const { AIProviderError, friendlyAIMessage, aiUserMessage } = await import("./index");
    const { userMessage, retryable } = friendlyAIMessage(503);
    expect(retryable).toBe(true);
    expect(userMessage).toMatch(/busy/i);
    expect(userMessage).not.toMatch(/\{.*"code"/);

    const err = new AIProviderError(503, userMessage, retryable, '{"code":503}');
    expect(aiUserMessage(err, "fallback")).toBe(userMessage);
    // Raw provider JSON never leaks through the user message.
    expect(aiUserMessage(err, "fallback")).not.toContain('"code"');
  });

  it("maps 429 as retryable and 401 as a key problem", async () => {
    const { friendlyAIMessage } = await import("./index");
    expect(friendlyAIMessage(429).retryable).toBe(true);
    const auth = friendlyAIMessage(401);
    expect(auth.retryable).toBe(false);
    expect(auth.userMessage).toMatch(/API key/i);
  });

  it("aiUserMessage falls back for non-provider errors", async () => {
    const { aiUserMessage } = await import("./index");
    expect(aiUserMessage(new Error("boom"), "fallback")).toBe("fallback");
    expect(aiUserMessage("nope", "fallback")).toBe("fallback");
  });

  it("retries once on a transient 503 then succeeds", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "test-model";
    const { generateMealPlanAI } = await import("./index");
    const okBody = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ days: [] }) } }],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response('{"error":"busy"}', { status: 503 }))
      .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
    const res = await generateMealPlanAI({}, { calorieTarget: 2000 });
    // Days fail schema validation (empty) but the point is the 503 was
    // retried instead of surfacing raw provider JSON.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    if (res.status === "error") {
      expect(res.error).not.toMatch(/AI provider HTTP/);
    }
  });

  it("surfaces a friendly message (not raw JSON) when the provider stays down", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "test-model";
    const { generateMealPlanAI } = await import("./index");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"error":{"code":503}}', { status: 503 }));
    const res = await generateMealPlanAI({}, { calorieTarget: 2000 });
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error).toMatch(/busy/i);
      expect(res.error).not.toContain('"code"');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2); // initial + one retry
  });
});
